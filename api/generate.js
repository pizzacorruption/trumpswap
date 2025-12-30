const { GoogleGenerativeAI } = require('@google/generative-ai');
const { formidable } = require('formidable');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { verifyToken, createAdminClient } = require('../lib/supabase');
const { checkUsage, incrementUsage, getNextResetDate, updateAnonCache } = require('../services/usage');
const { getAnonUsage, incrementAnonUsage } = require('../lib/anon');
const crypto = require('crypto');
const tiers = require('../config/tiers');

// Model configurations from tiers
const { models } = tiers;

// Disable body parser for formidable (Vercel/Next.js API config)
const config = {
  api: {
    bodyParser: false,
  },
};

// Export config for Vercel/Next.js serverless functions
module.exports.config = config;

// SECURITY: Allowed origins for CORS (matches server.js)
const ALLOWED_ORIGINS = [
  'https://pimpmyepstein.lol',
  'https://www.pimpmyepstein.lol',
];

// Allow localhost in development
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

// In-memory rate limit store for serverless (per-IP, resets on cold start)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per IP

// Max image dimensions to prevent memory exhaustion
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024; // 16 megapixels

/**
 * Get CORS origin - returns origin if allowed, null otherwise
 */
function getCorsOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return null;
}

/**
 * Simple IP-based rate limiting for serverless
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

/**
 * Get client IP from request
 */
function getClientIP(req) {
  // Vercel provides the real IP in x-forwarded-for
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const pairs = header.split(';').map((c) => c.trim()).filter(Boolean);
  const cookies = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function getOrCreateAnonId(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies.anon_id;
  if (existing && isValidUUID(existing)) {
    return existing;
  }

  const anonId = crypto.randomUUID();
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `anon_id=${anonId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`);
  return anonId;
}

/**
 * Verify auth token and return user info
 */
async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, isAuthenticated: false };
  }

  const token = authHeader.substring(7);
  const { user, error } = await verifyToken(token);

  if (error || !user) {
    return { user: null, isAuthenticated: false };
  }

  return { user, isAuthenticated: true };
}

/**
 * Get user profile from Supabase
 */
async function getUserProfile(userId) {
  const supabaseAdmin = createAdminClient();
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error fetching profile:', error.message);
    return null;
  }

  return data;
}

/**
 * Update user profile in Supabase
 */
async function updateUserProfile(userId, updates) {
  const supabaseAdmin = createAdminClient();
  if (!supabaseAdmin) return { error: new Error('Supabase not configured') };

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  return { error };
}

/**
 * Validate image dimensions to prevent memory exhaustion
 */
async function validateImageDimensions(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      return { valid: false, error: 'Could not determine image dimensions' };
    }

    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      return { valid: false, error: `Image too large. Max dimension is ${MAX_IMAGE_DIMENSION}px` };
    }

    if (width * height > MAX_IMAGE_PIXELS) {
      return { valid: false, error: `Image has too many pixels. Max is ${MAX_IMAGE_PIXELS / 1000000}MP` };
    }

    return { valid: true, width, height };
  } catch (err) {
    return { valid: false, error: 'Could not read image metadata' };
  }
}

/**
 * Add watermark to image buffer - visible but not obnoxious
 */
async function addWatermark(inputBuffer, watermarkText = 'pimpmyepstein.lol') {
  try {
    const metadata = await sharp(inputBuffer).metadata();
    const { width, height } = metadata;

    const fontSize = Math.floor(Math.min(width, height) / 18);
    const smallFontSize = Math.floor(fontSize * 0.7);

    // Calculate diagonal pattern spacing (no patternTransform - libvips doesn't support it)
    const patternWidth = Math.floor(width * 0.4);
    const patternHeight = Math.floor(height * 0.2);

    // SVG without unsupported features (no drop-shadow filter, no patternTransform)
    // libvips has limited SVG support - keep it simple
    const svgText = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="watermarkPattern" width="${patternWidth}" height="${patternHeight}" patternUnits="userSpaceOnUse">
            <text x="10" y="${smallFontSize + 10}" font-size="${smallFontSize}px" font-family="sans-serif" font-weight="600" fill="rgba(255,255,255,0.12)">${watermarkText}</text>
            <text x="${patternWidth / 2}" y="${patternHeight - 10}" font-size="${smallFontSize}px" font-family="sans-serif" font-weight="600" fill="rgba(255,255,255,0.12)">${watermarkText}</text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#watermarkPattern)" />
        <text x="50%" y="48%" text-anchor="middle" font-size="${fontSize}px" font-family="sans-serif" font-weight="bold" fill="rgba(0,0,0,0.3)">${watermarkText}</text>
        <text x="50%" y="50%" text-anchor="middle" font-size="${fontSize}px" font-family="sans-serif" font-weight="bold" fill="rgba(255,255,255,0.4)">${watermarkText}</text>
      </svg>
    `;

    // Convert SVG to PNG buffer first (Sharp handles SVG better this way)
    const svgBuffer = Buffer.from(svgText);
    const watermarkPng = await sharp(svgBuffer, { density: 150 })
      .resize(width, height, { fit: 'fill' })
      .png()
      .toBuffer();

    // Composite the watermark PNG over the original image
    const watermarkedBuffer = await sharp(inputBuffer)
      .composite([{
        input: watermarkPng,
        blend: 'over'
      }])
      .png()
      .toBuffer();

    return watermarkedBuffer;
  } catch (watermarkError) {
    console.error('Watermark application failed:', watermarkError.message);
    // Return original image if watermarking fails rather than crashing
    return inputBuffer;
  }
}

/**
 * Parse multipart form data
 */
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

module.exports = async function handler(req, res) {
  // SECURITY: Restrict CORS to allowed origins only
  const origin = req.headers.origin;
  const corsOrigin = getCorsOrigin(origin);

  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Check IP-based rate limit FIRST (before any expensive operations)
  const clientIP = getClientIP(req);
  const rateLimit = checkRateLimit(clientIP);

  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    });
  }

  try {
    // Authenticate user (optional - allows anonymous with watermark)
    const { user, isAuthenticated } = await authenticateRequest(req);
    const userId = user?.id || null;

    // Get profile for authenticated users
    let profile = null;
    if (userId) {
      profile = await getUserProfile(userId);
    }

    // Anonymous session tracking (persistent)
    let anonId = null;
    if (!userId) {
      anonId = getOrCreateAnonId(req, res);
      const anonUsage = await getAnonUsage(anonId);
      updateAnonCache(anonId, anonUsage.quickCount, anonUsage.premiumCount);
    }

    const { fields, files } = await parseForm(req);

    // Get model type from request (default to 'quick')
    const modelType = (fields.modelType?.[0] || fields.modelType || 'quick').toLowerCase();

    // Validate model type
    if (!['quick', 'premium'].includes(modelType)) {
      return res.status(400).json({ error: 'Invalid model type. Use "quick" or "premium".' });
    }

    // Check usage limits for the specified model
    const usage = checkUsage(userId, profile, clientIP, modelType, anonId);

    if (!usage.canGenerate) {
      return res.status(429).json({
        error: 'Usage limit exceeded',
        code: 'USAGE_LIMIT',
        tier: usage.tier,
        modelType,
        reason: usage.reason,
        quickRemaining: usage.quickRemaining,
        premiumRemaining: usage.premiumRemaining,
        credits: usage.credits,
        message: usage.tier === 'anonymous'
          ? 'Sign up for more generations!'
          : usage.reason
      });
    }

    // Get user photo file
    const userPhotoFile = files.userPhoto?.[0] || files.userPhoto;
    if (!userPhotoFile) {
      return res.status(400).json({ error: 'Your photo is required' });
    }

    // Validate file type by MIME and extension (including HEIC/HEIF from iPhone/Samsung)
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowedMimes.includes(userPhotoFile.mimetype)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, WebP, and HEIC images are allowed' });
    }

    // Get Epstein photo selection
    const epsteinPhoto = fields.epsteinPhoto?.[0] || fields.epsteinPhoto;
    if (!epsteinPhoto) {
      return res.status(400).json({ error: 'Epstein photo selection is required' });
    }

    // SECURITY: Validate epsteinPhoto path to prevent path traversal attacks
    // 1. Strip leading slash first (UI sends paths like "/epstein-photos/file.jpg")
    const sanitizedPhoto = epsteinPhoto.replace(/^\/+/, '');

    // 2. Reject any path containing ".." or absolute paths (after stripping leading slash)
    if (sanitizedPhoto.includes('..') || path.isAbsolute(sanitizedPhoto)) {
      return res.status(400).json({ error: 'Invalid photo path' });
    }

    // 3. Build allowed base directory and resolve the requested path
    const publicDir = path.join(process.cwd(), 'public');
    const epsteinPhotosDir = path.join(publicDir, 'epstein-photos');
    const epsteinPhotoPath = path.resolve(publicDir, sanitizedPhoto);

    // 4. Verify resolved path is within the epstein-photos directory (not just public)
    if (!epsteinPhotoPath.startsWith(epsteinPhotosDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid photo path' });
    }

    // 5. Whitelist check: verify the filename exists in the allowed photos directory
    const requestedFilename = path.basename(epsteinPhotoPath);
    const allowedPhotos = fs.existsSync(epsteinPhotosDir)
      ? fs.readdirSync(epsteinPhotosDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      : [];
    if (!allowedPhotos.includes(requestedFilename)) {
      return res.status(400).json({ error: 'Selected Epstein photo not found' });
    }

    // Read user photo buffer
    const userPhotoBuffer = fs.readFileSync(userPhotoFile.filepath);
    const userPhotoMime = userPhotoFile.mimetype;

    // SECURITY: Validate image dimensions to prevent memory exhaustion
    const userImageValidation = await validateImageDimensions(userPhotoBuffer);
    if (!userImageValidation.valid) {
      return res.status(400).json({ error: userImageValidation.error });
    }

    // Read the Epstein photo (path already validated above)
    if (!fs.existsSync(epsteinPhotoPath)) {
      return res.status(400).json({ error: 'Selected Epstein photo not found' });
    }

    const epsteinPhotoBuffer = fs.readFileSync(epsteinPhotoPath);

    // Validate Epstein photo dimensions too
    const epsteinImageValidation = await validateImageDimensions(epsteinPhotoBuffer);
    if (!epsteinImageValidation.valid) {
      return res.status(400).json({ error: 'Gallery photo is corrupted. Please try another.' });
    }
    const epsteinPhotoExt = path.extname(epsteinPhotoPath).toLowerCase();
    const epsteinPhotoMime = epsteinPhotoExt === '.png' ? 'image/png' :
                             epsteinPhotoExt === '.webp' ? 'image/webp' : 'image/jpeg';

    // Get model configuration based on modelType
    const modelConfig = models[modelType];
    console.log(`Generating Epstein swap with ${modelType} model (${modelConfig.modelId})... Epstein photo: ${epsteinPhoto}`);

    // Initialize Gemini with the selected model
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: modelConfig.modelId,
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });

    // Create the prompt - optimized for Nano Banana Pro based on Google's prompting guidance
    const prompt = `Create a seamless photo composite where the person from the second image replaces another person (not Epstein) in the first image.

IDENTITY PRESERVATION (CRITICAL):
Keep all facial features from the second image exactly unchanged - preserve face shape, eye spacing, nose structure, skin tone, and all distinctive features. Do not alter facial proportions, do not age or smooth the skin. Maintain natural skin texture with pores visible.

STYLE MATCHING:
Study the first image carefully. Apply the exact same color temperature, saturation, and tonal range to the composited person. If the original has warm, faded tones, the new person must have warm, faded tones. Match the film grain structure - add luminance-weighted grain, not color speckling. The composited person should not look "too clean" compared to the rest of the photograph.

LIGHTING:
Match the direction and softness of light exactly as it falls on other subjects in the scene. Preserve the same shadow depth and highlight roll-off.

COMPOSITION:
Position at correct scale and perspective relative to Epstein. Natural, relaxed pose that fits the scene context. Seamless edge integration with no haloing or obvious compositing artifacts.

The final result should look like an authentic photograph taken in that moment - as if both people were actually standing together when the camera clicked. Not a digital edit, but a real photo.

Generate the composited photograph.`;

    // Make API request with both images
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: epsteinPhotoMime,
          data: epsteinPhotoBuffer.toString('base64'),
        },
      },
      {
        inlineData: {
          mimeType: userPhotoMime,
          data: userPhotoBuffer.toString('base64'),
        },
      },
      prompt,
    ]);

    const response = await result.response;

    // Extract generated image
    if (response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;

      for (const part of parts) {
        if (part.inlineData) {
          let imageBuffer = Buffer.from(part.inlineData.data, 'base64');

          // Determine if user gets watermark-free based on tier
          const shouldWatermark = !usage.watermarkFree;

          if (shouldWatermark) {
            imageBuffer = await addWatermark(imageBuffer);
            console.log('Generated image with watermark');
          } else {
            console.log('Generated watermark-free image for paid user');
          }

          // INCREMENT USAGE on successful generation
          const usageResult = incrementUsage(userId, profile, clientIP, modelType, usage.useCredit, usage.creditCost, anonId);

          if (usageResult.shouldUpdateDb && userId) {
            // Build the update object
            const dbUpdate = {
              generation_count: usageResult.newCount
            };

            // Update monthly count for base/paid users (shared pool)
            if (usage.tier === 'base' || usage.tier === 'paid') {
              dbUpdate.monthly_generation_count = usageResult.newMonthlyCount;

              // Set monthly reset date if needed
              if (usageResult.resetMonthly) {
                dbUpdate.monthly_reset_at = getNextResetDate().toISOString();
              }
            } else {
              // Free tier: update quick/premium specific counters
              dbUpdate.quick_count = usageResult.newQuickCount;
              dbUpdate.premium_count = usageResult.newPremiumCount;
            }

            // Update credits if used
            if (usage.useCredit) {
              dbUpdate.credit_balance = usageResult.newCredits;
            }

            // Update profile in database
            await updateUserProfile(userId, dbUpdate);
          }

          if (!userId && anonId) {
            const persist = await incrementAnonUsage(anonId, modelType, {
              ipAddress: clientIP,
              userAgent: req.headers['user-agent']
            });
            if (persist.success) {
              updateAnonCache(anonId, persist.quickCount, persist.premiumCount);
            }
          }

          // Return as base64 data URL (serverless has no persistent disk)
          const base64Image = imageBuffer.toString('base64');
          const dataUrl = `data:image/png;base64,${base64Image}`;

          return res.json({
            success: true,
            imageUrl: dataUrl,
            modelType,
            usage: {
              tier: usage.tier,
              used: usageResult.newCount,
              remaining: usage.limit === 'unlimited' ? 'unlimited' : Math.max(0, usage.limit - usageResult.newCount),
              watermarkFree: !shouldWatermark,
              // Quick/Premium specific (for free/anonymous)
              quickUsed: usageResult.newQuickCount,
              quickRemaining: usage.quickLimit - usageResult.newQuickCount,
              premiumUsed: usageResult.newPremiumCount,
              premiumRemaining: usage.premiumLimit - usageResult.newPremiumCount,
              // Credits (if used)
              credits: usageResult.newCredits,
              creditsUsed: usage.useCredit ? usage.creditCost : 0
            }
          });
        }
      }
    }

    // Check for safety blocks
    if (response.candidates?.[0]?.finishReason === 'SAFETY') {
      return res.status(400).json({
        error: 'Request blocked by safety filters. Try a different photo.'
      });
    }

    res.status(500).json({ error: 'No image generated. Try again.' });

  } catch (error) {
    console.error('Generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
