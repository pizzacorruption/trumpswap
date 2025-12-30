/**
 * Pimp My Epstein Server
 * Face swap with pre-loaded Epstein photos
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Services
const generations = require('./services/generations');
const stripeService = require('./services/stripe');
const { checkUsage, incrementUsage, getAnonymousStats, updateAnonCache } = require('./services/usage');

// Middleware
const { authMiddleware, requireAuth } = require('./middleware/auth');
const { createRateLimitMiddleware, getClientIP } = require('./middleware/rateLimit');

// Lib & Config
const { supabase, supabaseAdmin, getClientConfig } = require('./lib/supabase');
const tiers = require('./config/tiers');
const { getPromptForPhoto, photoPrompts } = require('./config/photoPrompts');
const { getOrCreateAnonId, getAnonUsage } = require('./lib/anon');

const app = express();
const PORT = process.env.PORT || 3000;

// SECURITY: Trust proxy setting for Vercel deployment
// This ensures req.ip uses the real client IP from x-forwarded-for header
// Only trust the first proxy (Vercel's edge) to prevent IP spoofing attacks
// Value of 1 means: trust only the first hop (immediate proxy)
// This is critical for rate limiting to work correctly
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  app.set('trust proxy', 1);
}

// API timeout for Gemini requests (in milliseconds)
const GEMINI_TIMEOUT = 120000; // 2 minutes

// Minimum image dimensions
const MIN_IMAGE_SIZE = 256;

// Error codes for client handling
const ERROR_CODES = {
  NO_FACE: 'NO_FACE',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  IMAGE_TOO_SMALL: 'IMAGE_TOO_SMALL',
  SAFETY_BLOCK: 'SAFETY_BLOCK',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  INVALID_FORMAT: 'INVALID_FORMAT',
  GENERATION_FAILED: 'GENERATION_FAILED',
};

// Admin password for debug mode
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const DEV_DEBUG_COOKIE = 'dev_debug';

// In-memory admin sessions (token -> expiry timestamp)
const adminSessions = new Map();

function isLocalRequest(req) {
  const ip = req.ip || '';
  const host = (req.hostname || '').toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.');
  return isLocalHost || isLoopback;
}

/**
 * Create structured error response
 */
function createErrorResponse(code, message, details = null) {
  const response = {
    error: message,
    code: code,
  };
  if (details) {
    response.details = details;
  }
  return response;
}

/**
 * Log error with full details server-side
 */
function logError(code, message, error = null) {
  console.error(`\n❌ [${code}] ${message}`);
  if (error) {
    console.error(`   Details: ${error.message || error}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }
  }
}

/**
 * Validate image dimensions and quality
 */
async function validateImageDimensions(buffer, filename = 'image') {
  try {
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      return {
        valid: false,
        code: ERROR_CODES.INVALID_FORMAT,
        message: 'Could not read image dimensions. The file may be corrupted.',
      };
    }

    if (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) {
      return {
        valid: false,
        code: ERROR_CODES.IMAGE_TOO_SMALL,
        message: `Image is too small (${width}x${height}). Minimum size is ${MIN_IMAGE_SIZE}x${MIN_IMAGE_SIZE} pixels.`,
        details: `Your image: ${width}x${height}px. Required: at least ${MIN_IMAGE_SIZE}x${MIN_IMAGE_SIZE}px for good results.`,
      };
    }

    return { valid: true, width, height };
  } catch (error) {
    return {
      valid: false,
      code: ERROR_CODES.INVALID_FORMAT,
      message: 'Could not process image. Please use a valid JPG, PNG, or WebP file.',
      details: error.message,
    };
  }
}

/**
 * Parse Gemini API error and return appropriate error response
 */
function parseGeminiError(error) {
  const errorMessage = error.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();

  // Rate limiting
  if (errorMessage.includes('rate') || errorMessage.includes('quota') ||
    errorMessage.includes('429') || errorString.includes('resource exhausted')) {
    return {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests. Please wait a moment and try again.',
      details: 'The AI service is temporarily rate limited. Try again in 30-60 seconds.',
    };
  }

  // Timeout
  if (errorMessage.includes('timeout') || errorMessage.includes('deadline') ||
    errorMessage.includes('econnreset') || errorMessage.includes('socket hang up')) {
    return {
      code: ERROR_CODES.TIMEOUT,
      message: 'Request timed out. The AI is busy - please try again.',
      details: 'Image generation took too long. This can happen during high traffic.',
    };
  }

  // Safety/content filters
  if (errorMessage.includes('safety') || errorMessage.includes('blocked') ||
    errorMessage.includes('harmful') || errorMessage.includes('policy')) {
    return {
      code: ERROR_CODES.SAFETY_BLOCK,
      message: 'Content blocked by safety filters. Please try a different photo.',
      details: 'The AI detected potentially problematic content in the request.',
    };
  }

  // Invalid image/format
  if (errorMessage.includes('invalid') && (errorMessage.includes('image') || errorMessage.includes('format'))) {
    return {
      code: ERROR_CODES.INVALID_FORMAT,
      message: 'Invalid image format. Please use a JPG, PNG, or WebP file.',
      details: error.message,
    };
  }

  // Default to generation failed
  return {
    code: ERROR_CODES.GENERATION_FAILED,
    message: 'Image generation failed. Please try again.',
    details: error.message,
  };
}

/**
 * Analyze response for face detection issues
 */
function analyzeResponseForFaceIssues(response) {
  const textContent = [];

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text) {
        textContent.push(part.text.toLowerCase());
      }
    }
  }

  const fullText = textContent.join(' ');

  // Check for no face detected
  if (fullText.includes('no face') || fullText.includes('cannot detect') ||
    fullText.includes('unable to detect') || fullText.includes('no person') ||
    fullText.includes("couldn't find") || fullText.includes('face not found')) {
    return {
      hasFaceIssue: true,
      code: ERROR_CODES.NO_FACE,
      message: 'No face detected in your photo. Please upload a clear photo of your face.',
      details: 'Make sure your face is clearly visible, well-lit, and facing the camera.',
    };
  }

  // Check for multiple faces
  if (fullText.includes('multiple faces') || fullText.includes('more than one face') ||
    fullText.includes('several faces') || fullText.includes('multiple people')) {
    return {
      hasFaceIssue: true,
      code: ERROR_CODES.MULTIPLE_FACES,
      message: 'Multiple faces detected. Please upload a photo with only your face.',
      details: 'Crop your photo to show just one person for best results.',
    };
  }

  return { hasFaceIssue: false };
}

// ===== ADMIN DEBUG MODE HELPERS =====

/**
 * Generate a random admin session token
 */
function generateAdminToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

/**
 * Validate admin password and create session
 * @param {string} password - The password to validate
 * @returns {object} Session info or error
 */
function validateAdminPassword(password) {
  if (!ADMIN_PASSWORD) {
    return { valid: false, error: 'Admin mode not configured' };
  }

  if (password !== ADMIN_PASSWORD) {
    return { valid: false, error: 'Invalid password' };
  }

  // Create session token (valid for 24 hours)
  const token = generateAdminToken();
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
  adminSessions.set(token, expiresAt);

  // Clean up expired sessions periodically
  for (const [t, expiry] of adminSessions.entries()) {
    if (expiry < Date.now()) {
      adminSessions.delete(t);
    }
  }

  return { valid: true, token, expiresAt };
}

/**
 * Check if admin token is valid
 * @param {string} token - The admin session token
 * @returns {boolean} Whether the token is valid
 */
function isValidAdminToken(token) {
  if (!token || !adminSessions.has(token)) {
    return false;
  }

  const expiresAt = adminSessions.get(token);
  if (expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }

  return true;
}

/**
 * Middleware to check admin status from httpOnly cookie or header
 * SECURITY: Only accepts token from httpOnly cookie (XSS-proof) or header
 * Query params are NOT accepted to prevent token leakage via referrer/logs
 */
function checkAdminMiddleware(req, res, next) {
  // Check for admin token in order of security preference:
  // 1. httpOnly cookie (most secure - cannot be stolen via XSS)
  // 2. Header (for API/programmatic access)
  // NOTE: Query params intentionally NOT supported - tokens in URLs leak via referrer headers and server logs
  const token = req.cookies?.adminToken || req.headers['x-admin-token'];
  req.isAdmin = isValidAdminToken(token);

  // Check for X-Test-Mode header (for agent/automated testing)
  // Requires TEST_MODE_SECRET env var to be set
  const testModeHeader = req.headers['x-test-mode'];
  const testModeSecret = process.env.TEST_MODE_SECRET;
  req.isTestMode = !!(testModeSecret && testModeHeader === testModeSecret);

  next();
}

/**
 * Get debug info for admin responses
 */
function getAdminDebugInfo() {
  const anonymousStats = getAnonymousStats();
  const photos = getEpsteinPhotos();

  return {
    server: {
      uptime: process.uptime(),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      platform: process.platform
    },
    config: {
      apiKeySet: !!process.env.GEMINI_API_KEY,
      stripeConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_BASE),
      supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      adminConfigured: !!ADMIN_PASSWORD,
      model: 'gemini-3-pro-image-preview',
      timeout: GEMINI_TIMEOUT,
      minImageSize: MIN_IMAGE_SIZE
    },
    stats: {
      epsteinPhotosCount: photos.length,
      anonymousUsersTracked: anonymousStats.totalTracked,
      activeAdminSessions: adminSessions.size
    },
    supabase: {
      connected: !!supabase,
      url: process.env.SUPABASE_URL ? 'configured' : 'not set'
    }
  };
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===== SUPABASE PROFILE HELPERS =====

/**
 * Get user profile from Supabase
 * Uses supabaseAdmin (service role key) to bypass RLS policies
 * @param {string} userId - User ID
 * @returns {object|null} User profile or null
 */
async function getProfile(userId) {
  if (!supabaseAdmin || !userId) return null;

  try {
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
  } catch (err) {
    console.error('Profile fetch error:', err.message);
    return null;
  }
}

/**
 * Update user profile in Supabase
 * Uses supabaseAdmin (service role key) to bypass RLS policies
 * @param {string} userId - User ID
 * @param {object} updates - Fields to update
 * @returns {boolean} Success status
 */
async function updateProfile(userId, updates) {
  if (!supabaseAdmin || !userId) return false;

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Error updating profile:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Profile update error:', err.message);
    return false;
  }
}

// Create rate limit middleware with Supabase integration
const rateLimitMiddleware = createRateLimitMiddleware({
  upgradeUrl: '/pricing',
  getProfile,
  updateProfile
});

// ===== GLOBAL RATE LIMITING & ABUSE DETECTION =====

// Global rate limiter for /api/generate - prevents API key abuse
// SECURITY: keyGenerator uses req.ip which respects 'trust proxy' setting
const globalGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 100 total generations per hour across ALL users
  message: { error: 'Service temporarily at capacity. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// Suspicious IP tracking for abuse detection
const suspiciousIPs = new Map(); // IP -> { count, firstSeen, lastSeen }

/**
 * Track suspicious activity and determine if IP should be blocked
 * @param {string} ip - Client IP address
 * @returns {boolean} True if IP should be blocked
 */
function trackSuspiciousActivity(ip) {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  const fiveMinutesAgo = now - fiveMinutes;

  let record = suspiciousIPs.get(ip);

  // Reset the window if it's been more than 5 minutes since firstSeen
  if (record && record.firstSeen < fiveMinutesAgo) {
    // Window expired - reset the record
    record = null;
  }

  if (!record) {
    record = { count: 0, firstSeen: now };
  }

  record.count++;
  record.lastSeen = now;
  suspiciousIPs.set(ip, record);

  // Block if more than 10 requests in 5 minutes
  if (record.count > 10) {
    const timespan = Math.round((now - record.firstSeen) / 1000);
    console.log(`[ABUSE] IP ${ip} attempted ${record.count} generations in ${timespan}s - BLOCKED`);
    return true; // Block this IP
  }

  // Clean up old entries (older than 1 hour)
  const oneHourAgo = now - (60 * 60 * 1000);
  for (const [trackedIP, data] of suspiciousIPs.entries()) {
    if (data.lastSeen < oneHourAgo) {
      suspiciousIPs.delete(trackedIP);
    }
  }

  return false;
}

/**
 * Middleware to check for suspicious IP activity before processing generate requests
 */
function suspiciousActivityMiddleware(req, res, next) {
  const clientIP = getClientIP(req);

  if (trackSuspiciousActivity(clientIP)) {
    return res.status(429).json({
      error: 'Too many requests from your IP. Please try again later.',
      code: ERROR_CODES.RATE_LIMITED
    });
  }

  next();
}

// Rate limiter for admin login - prevent brute force attacks
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// Rate limiter for checkout creation - prevent abuse
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 checkout attempts per 15 minutes
  message: { error: 'Too many checkout attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// Rate limiter for output images - prevent enumeration attacks
const outputLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// SECURITY: Restrict CORS to allowed origins only
// This prevents malicious sites from making authenticated requests on behalf of users
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  'https://pimpmyepstein.lol',
  'https://www.pimpmyepstein.lol',
  !isProduction ? 'http://localhost:3000' : null,
  !isProduction ? 'http://127.0.0.1:3000' : null,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    // but only in non-production mode
    if (!origin) {
      if (!isProduction) {
        return callback(null, true);
      }
      // In production, require origin header
      return callback(null, false);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
};

// ===== STRIPE WEBHOOK ROUTE (MUST BE BEFORE express.json()) =====
// Stripe webhook signature verification requires the raw request body.
// express.json() middleware consumes and parses the body, making it unavailable
// for signature verification. This route MUST be defined before express.json().
app.post('/api/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    try {
      // Verify and construct the webhook event
      const event = stripeService.constructWebhookEvent(req.body, signature);

      console.log(`Stripe webhook received: ${event.type}`);

      // Handle the event
      const result = await stripeService.handleWebhook(event);

      // If we have a userId, update Supabase profile
      // Use supabaseAdmin to bypass RLS since webhooks have no user context
      if (result.userId && supabaseAdmin) {
        try {
          // Build update object with tier, Stripe IDs, and billing fields
          const updateData = {};

          if (result.tier) {
            updateData.tier = result.tier;
          }

          // Include stripe_customer_id if present in result
          if (result.stripe_customer_id) {
            updateData.stripe_customer_id = result.stripe_customer_id;
          }

          // Include stripe_subscription_id (can be null to clear it on cancel)
          if ('stripe_subscription_id' in result) {
            updateData.stripe_subscription_id = result.stripe_subscription_id;
          }

          if ('monthly_generation_count' in result) {
            updateData.monthly_generation_count = result.monthly_generation_count;
          }

          if (result.monthly_reset_at) {
            updateData.monthly_reset_at = result.monthly_reset_at;
          }

          const creditsAdded = Number(result.creditsAdded);
          if (Number.isFinite(creditsAdded) && creditsAdded > 0) {
            const profile = await getProfile(result.userId);
            const currentCredits = profile?.credit_balance || 0;
            updateData.credit_balance = currentCredits + creditsAdded;
          }

          if (Object.keys(updateData).length > 0) {
            updateData.updated_at = new Date().toISOString();

            const { error } = await supabaseAdmin
              .from('profiles')
              .update(updateData)
              .eq('id', result.userId);

            if (error) {
              console.error('Failed to update Supabase profile:', error.message);
            } else {
              console.log(`Updated Supabase profile for user ${result.userId}:`, updateData);
            }
          }
        } catch (dbError) {
          console.error('Supabase profile update error:', dbError.message);
        }
      }

      res.json({ received: true, ...result });
    } catch (error) {
      console.error('Webhook error:', error.message);
      res.status(400).json({
        error: 'Webhook signature verification failed',
        details: error.message
      });
    }
  }
);

// Middleware
app.use(cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://api.stripe.com"],
      frameAncestors: ["'none'"], // Prevent clickjacking
    },
  },
  crossOriginEmbedderPolicy: false,
  // SECURITY: Prevent clickjacking by not allowing this site to be framed
  frameguard: { action: 'deny' },
  // SECURITY: Force HTTPS in production (HSTS)
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  } : false,
  // SECURITY: Hide X-Powered-By header to reduce fingerprinting
  hidePoweredBy: true,
  // SECURITY: Prevent MIME type sniffing
  noSniff: true,
  // SECURITY: XSS filter
  xssFilter: true,
}));
app.use(express.json({ limit: '10mb' })); // Match multer's 10MB limit
app.use(cookieParser()); // SECURITY: Required for httpOnly admin token cookies
app.use((req, res, next) => {
  const allowLocalDebug = !isProduction && isLocalRequest(req);
  req.isDevDebug = allowLocalDebug && req.cookies?.[DEV_DEBUG_COOKIE] === '1';
  next();
});
app.use(express.static('public'));
// SECURITY: Don't serve /output statically - use authenticated endpoint instead
// app.use('/output', express.static('output'));
app.use('/epstein-photos', express.static('public/epstein-photos'));

// Apply auth middleware globally (non-blocking, just attaches user info)
app.use(authMiddleware);

// Apply admin check middleware globally
app.use(checkAdminMiddleware);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1 // Only allow 1 file per request
  },
  fileFilter: (req, file, cb) => {
    // Allow common mobile photo formats including HEIC/HEIF from iPhone/Samsung
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(file.mimetype)) {
      const error = new Error('Invalid file type. Only JPEG, PNG, WebP, and HEIC are allowed.');
      error.code = ERROR_CODES.INVALID_FORMAT;
      error.details = `Received: ${file.mimetype}. Accepted: JPEG, PNG, WebP, HEIC/HEIF`;
      return cb(error);
    }
    cb(null, true);
  }
});

// Multer error handling middleware
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      logError(ERROR_CODES.INVALID_FORMAT, 'File too large', err);
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.INVALID_FORMAT,
        'File is too large. Maximum size is 10MB.',
        'Try compressing your image or using a smaller resolution.'
      ));
    }
    logError(ERROR_CODES.INVALID_FORMAT, 'Upload error', err);
    return res.status(400).json(createErrorResponse(
      ERROR_CODES.INVALID_FORMAT,
      'File upload error. Please try again.',
      err.message
    ));
  }
  if (err?.code === ERROR_CODES.INVALID_FORMAT) {
    logError(ERROR_CODES.INVALID_FORMAT, err.message, err);
    return res.status(400).json(createErrorResponse(
      ERROR_CODES.INVALID_FORMAT,
      err.message,
      err.details
    ));
  }
  next(err);
}

// Ensure directories exist
['output', 'public/epstein-photos'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

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
 * Get list of Epstein photos for gallery
 */
function getEpsteinPhotos() {
  const photosDir = path.join(__dirname, 'public', 'epstein-photos');

  if (!fs.existsSync(photosDir)) {
    return [];
  }

  const files = fs.readdirSync(photosDir)
    .filter(f => /\.(jpg|jpeg|png|webp|avif)$/i.test(f))
    .map(f => ({
      name: f.replace(/\.[^.]+$/, '').replace(/-/g, ' '),
      path: `/epstein-photos/${f}`,
      filename: f
    }));

  return files;
}

// API: Get Epstein photos for gallery
app.get('/api/photos', (req, res) => {
  const photos = getEpsteinPhotos();
  res.json({ photos });
});

// API: Generate face swap
// SECURITY: Multiple layers of rate limiting to prevent API key abuse:
// 1. globalGenerateLimiter - 100 total generations/hour across ALL users (prevents API exhaustion)
// 2. suspiciousActivityMiddleware - Blocks IPs with >10 requests in 5 minutes
// 3. rateLimitMiddleware - Per-user rate limits based on tier
// Order: global limit -> suspicious IP check -> per-user limit -> upload -> multer error handler -> handler
app.post('/api/generate', globalGenerateLimiter, suspiciousActivityMiddleware, rateLimitMiddleware, upload.single('userPhoto'), handleMulterError, async (req, res) => {
  // Track generation for authenticated users
  let generationRecord = null;
  const userId = req.user?.id || null;
  const clientIP = getClientIP(req);

  try {
    const userPhoto = req.file;
    const { epsteinPhoto, modelType = 'quick' } = req.body;

    // Validate modelType - only allow 'quick' or 'premium'
    const validModelType = ['quick', 'premium'].includes(modelType) ? modelType : 'quick';

    if (!userPhoto) {
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.INVALID_FORMAT,
        'Your photo is required',
        'Please upload a photo of yourself.'
      ));
    }

    // Validate file content using magic bytes (not just MIME type from header)
    const fileType = await import('file-type');
    const detectedType = await fileType.fileTypeFromBuffer(userPhoto.buffer);
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!detectedType || !allowedMimes.includes(detectedType.mime)) {
      logError(ERROR_CODES.INVALID_FORMAT, 'File content validation failed');
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.INVALID_FORMAT,
        'Invalid file content. Only JPEG, PNG, WebP, and HEIC images are allowed.',
        `Detected type: ${detectedType?.mime || 'unknown'}. The file may be corrupted or disguised.`
      ));
    }

    if (!epsteinPhoto) {
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.INVALID_FORMAT,
        'Epstein photo selection is required',
        'Please select an Epstein photo from the gallery.'
      ));
    }

    // Validate user photo dimensions
    const userValidation = await validateImageDimensions(userPhoto.buffer, 'User photo');
    if (!userValidation.valid) {
      logError(userValidation.code, userValidation.message);
      return res.status(400).json(createErrorResponse(
        userValidation.code,
        userValidation.message,
        userValidation.details
      ));
    }

    // Create generation record for tracking (for ALL users, including anonymous)
    // This enables secure image access via viewToken for anonymous users
    generationRecord = generations.createGeneration(userId, epsteinPhoto);
    console.log(`   Generation ID: ${generationRecord.id}${userId ? '' : ' (anonymous)'}`)

    // SECURITY: Validate epsteinPhoto against whitelist to prevent path traversal attacks
    // An attacker could send "../../.env" to read server secrets
    const allowedPhotos = getEpsteinPhotos();
    const normalizedPath = epsteinPhoto.startsWith('/') ? epsteinPhoto : `/${epsteinPhoto}`;
    const isValidPhoto = allowedPhotos.some(p => p.path === normalizedPath || p.path === epsteinPhoto);

    if (!isValidPhoto) {
      logError(ERROR_CODES.GENERATION_FAILED, `Invalid epstein photo path (possible attack): ${epsteinPhoto}`);
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.GENERATION_FAILED,
        'Invalid photo selection.',
        'Please select a valid photo from the gallery.'
      ));
    }

    // Read the Epstein photo from disk
    // SECURITY: Strip leading slash to prevent path.join treating it as absolute path
    // Then use path.resolve and verify the result is within the allowed directory
    const sanitizedPath = epsteinPhoto.replace(/^\/+/, ''); // Strip leading slashes
    const epsteinPhotosDir = path.resolve(__dirname, 'public', 'epstein-photos');
    const epsteinPhotoPath = path.resolve(__dirname, 'public', sanitizedPath);

    // SECURITY: Verify the resolved path is within the epstein-photos directory
    if (!epsteinPhotoPath.startsWith(epsteinPhotosDir + path.sep) && epsteinPhotoPath !== epsteinPhotosDir) {
      logError(ERROR_CODES.GENERATION_FAILED, `Path traversal attempt blocked: ${epsteinPhoto} resolved to ${epsteinPhotoPath}`);
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.GENERATION_FAILED,
        'Invalid photo selection.',
        'Please select a valid photo from the gallery.'
      ));
    }

    if (!fs.existsSync(epsteinPhotoPath)) {
      logError(ERROR_CODES.GENERATION_FAILED, `Epstein photo not found: ${epsteinPhoto}`);
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.GENERATION_FAILED,
        'Selected Epstein photo not found.',
        'Please refresh the page and try again.'
      ));
    }

    const epsteinPhotoBuffer = await fsPromises.readFile(epsteinPhotoPath);

    // Detect actual MIME type from file extension
    const ext = path.extname(sanitizedPath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    const epsteinPhotoMime = mimeTypes[ext] || 'image/jpeg';

    console.log(`\n🎬 Generating Epstein swap...`);
    console.log(`   Epstein photo: ${epsteinPhoto}`);
    console.log(`   User photo: ${userValidation.width}x${userValidation.height}px`);

    // Select model based on modelType:
    // - Quick: Nano Banana (gemini-2.5-flash-image-preview) - fast, good quality
    // - Premium: Nano Banana Pro (gemini-3-pro-image-preview) - best quality, high fidelity
    const modelName = validModelType === 'premium'
      ? 'gemini-3-pro-image-preview'      // Nano Banana Pro (Gemini 3 Pro Image)
      : 'gemini-2.5-flash-image-preview'; // Nano Banana (Gemini 2.5 Flash Image)

    console.log(`   Model: ${modelName} (${validModelType})`);

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });

    // Get per-photo custom prompt (or default if none exists)
    const prompt = getPromptForPhoto(epsteinPhoto);
    console.log(`   Using ${photoPrompts[epsteinPhoto.split('/').pop()] ? 'custom' : 'default'} prompt for: ${epsteinPhoto.split('/').pop()}`);

    // Make API request with both images (with timeout protection)
    let result;
    const startTime = Date.now();
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Request timed out');
          error.isTimeout = true;
          reject(error);
        }, GEMINI_TIMEOUT);
      });

      const generatePromise = model.generateContent([
        {
          inlineData: {
            mimeType: epsteinPhotoMime,
            data: epsteinPhotoBuffer.toString('base64'),
          },
        },
        {
          inlineData: {
            mimeType: userPhoto.mimetype,
            data: userPhoto.buffer.toString('base64'),
          },
        },
        prompt,
      ]);

      result = await Promise.race([generatePromise, timeoutPromise]);
    } catch (apiError) {
      // Handle timeout specifically
      if (apiError.isTimeout) {
        logError(ERROR_CODES.TIMEOUT, 'Gemini API timed out', apiError);
        if (generationRecord) {
          generations.failGeneration(generationRecord.id, ERROR_CODES.TIMEOUT, 'Request timed out');
        }
        return res.status(504).json(createErrorResponse(
          ERROR_CODES.TIMEOUT,
          'Request timed out. The AI is taking too long - please try again.',
          `Generation exceeded ${GEMINI_TIMEOUT / 1000} second limit. This can happen during high traffic.`
        ));
      }
      // Re-throw to be caught by outer catch
      throw apiError;
    }

    const response = await result.response;
    const elapsedTime = Date.now() - startTime;

    // Check for prompt feedback blocks (happens before generation)
    if (response.promptFeedback?.blockReason) {
      logError(ERROR_CODES.SAFETY_BLOCK, `Prompt blocked: ${response.promptFeedback.blockReason}`);
      if (generationRecord) {
        generations.failGeneration(generationRecord.id, ERROR_CODES.SAFETY_BLOCK, `Prompt blocked: ${response.promptFeedback.blockReason}`);
      }
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.SAFETY_BLOCK,
        'Request blocked by content filters. Please try a different photo.',
        `Block reason: ${response.promptFeedback.blockReason}`
      ));
    }

    // Extract generated image
    if (response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content?.parts || [];

      for (const part of parts) {
        if (part.inlineData) {
          let imageBuffer = Buffer.from(part.inlineData.data, 'base64');

          // Add watermark (skip only for authenticated admin users)
          // SECURITY: Only trust req.isAdmin - never trust client-side debug parameter
          const skipWatermark = req.isAdmin;
          if (!skipWatermark) {
            imageBuffer = await addWatermark(imageBuffer);
          }

          // Save the image with UUID filename (prevents enumeration attacks)
          const filename = `epstein_${require('crypto').randomUUID()}.png`;
          const outputPath = path.join('output', filename);
          await fsPromises.writeFile(outputPath, imageBuffer);

          console.log(`✅ Generated: ${filename}${req.isAdmin ? ' [ADMIN - no watermark]' : ''} (${elapsedTime}ms)`);

          // Mark generation as completed for authenticated users
          if (generationRecord) {
            generations.completeGeneration(generationRecord.id, `/output/${filename}`);
          }

          // Build response
          const response = {
            success: true,
            imageUrl: `/output/${filename}`,
            generationId: generationRecord?.id || null,
            // Include viewToken for anonymous users so they can access their images
            viewToken: generationRecord?.viewToken || null
          };

          // Add debug info for admin users
          if (req.isAdmin) {
            const outputMetadata = await sharp(imageBuffer).metadata();
            response.debug = {
              generationTime: elapsedTime,
              model: modelName,
              outputDimensions: {
                width: outputMetadata.width,
                height: outputMetadata.height
              },
              inputDimensions: {
                width: userValidation.width,
                height: userValidation.height
              },
              watermarkApplied: !skipWatermark,
              epsteinPhoto: epsteinPhoto,
              timestamp: new Date().toISOString()
            };
          }

          return res.json(response);
        }
      }
    }

    // Check for safety blocks
    if (response.candidates?.[0]?.finishReason === 'SAFETY') {
      logError(ERROR_CODES.SAFETY_BLOCK, 'Safety filter blocked request');
      if (generationRecord) {
        generations.failGeneration(generationRecord.id, ERROR_CODES.SAFETY_BLOCK, 'Content blocked by safety filters');
      }
      return res.status(400).json(createErrorResponse(
        ERROR_CODES.SAFETY_BLOCK,
        'Request blocked by safety filters. Try a different photo.',
        'The AI detected potentially problematic content.'
      ));
    }

    // Check for face detection issues in text response
    const faceIssue = analyzeResponseForFaceIssues(response);
    if (faceIssue.hasFaceIssue) {
      logError(faceIssue.code, faceIssue.message);
      if (generationRecord) {
        generations.failGeneration(generationRecord.id, faceIssue.code, faceIssue.message);
      }
      return res.status(400).json(createErrorResponse(
        faceIssue.code,
        faceIssue.message,
        faceIssue.details
      ));
    }

    // No image generated
    logError(ERROR_CODES.GENERATION_FAILED, 'No image in response');
    if (generationRecord) {
      generations.failGeneration(generationRecord.id, ERROR_CODES.GENERATION_FAILED, 'No image generated');
    }
    res.status(500).json(createErrorResponse(
      ERROR_CODES.GENERATION_FAILED,
      'No image generated. Please try again.',
      'The AI did not return an image. This can happen occasionally.'
    ));

  } catch (error) {
    // Parse Gemini-specific errors
    const parsedError = parseGeminiError(error);
    logError(parsedError.code, parsedError.message, error);

    // Mark generation as failed
    if (generationRecord) {
      generations.failGeneration(generationRecord.id, parsedError.code, parsedError.message);
    }

    // Return appropriate HTTP status based on error type
    const statusCode = parsedError.code === ERROR_CODES.RATE_LIMITED ? 429 :
      parsedError.code === ERROR_CODES.TIMEOUT ? 504 :
        parsedError.code === ERROR_CODES.SAFETY_BLOCK ? 400 : 500;

    res.status(statusCode).json(createErrorResponse(
      parsedError.code,
      parsedError.message,
      parsedError.details
    ));
  }
});

// ===== STRIPE PAYMENT ROUTES =====

/**
 * POST /api/create-checkout
 * Creates a Stripe checkout session for $14.99/mo Base subscription
 * SECURITY: Requires authentication and verifies userId matches authenticated user
 */
app.post('/api/create-checkout', checkoutLimiter, requireAuth, async (req, res) => {
  try {
    // SECURITY: Use authenticated user's ID and email, not from request body
    // This prevents attackers from creating checkout sessions for other users
    const userId = req.user.id;
    const email = req.user.email;

    if (!email) {
      return res.status(400).json({
        error: 'User email not found. Please sign in again.'
      });
    }

    const { url, sessionId } = await stripeService.createCheckoutSession(userId, email);

    res.json({
      success: true,
      checkoutUrl: url,
      sessionId
    });
  } catch (error) {
    console.error('Checkout creation error:', error.message);
    res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
});

/**
 * GET /api/subscription
 * Returns the current user's subscription status
 * SECURITY: Requires authentication - uses authenticated user's ID
 */
app.get('/api/subscription', requireAuth, async (req, res) => {
  try {
    // SECURITY: Use authenticated user's ID, not from query parameter
    // This prevents users from viewing other users' subscription status
    const userId = req.user.id;

    const status = await stripeService.getSubscriptionStatus(userId);

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Subscription status error:', error.message);
    res.status(500).json({
      error: 'Failed to get subscription status',
      details: error.message
    });
  }
});

/**
 * POST /api/cancel-subscription
 * Cancels a user's subscription (at period end)
 * SECURITY: Requires authentication and verifies user owns the subscription
 */
app.post('/api/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's profile to find their Stripe customer ID
    const profile = await getProfile(userId);
    if (!profile?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No subscription found for this user'
      });
    }

    // SECURITY: Use customerId from user's profile, not from request body
    // This prevents attackers from cancelling other users' subscriptions
    const result = await stripeService.cancelSubscription(profile.stripe_customer_id);

    res.json(result);
  } catch (error) {
    console.error('Subscription cancellation error:', error.message);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      details: error.message
    });
  }
});

/**
 * POST /api/buy-credits
 * Creates a Stripe checkout session for credit purchase ($3/credit)
 * SECURITY: Requires authentication
 */
app.post('/api/buy-credits', checkoutLimiter, requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;
    const quantity = Math.min(Math.max(parseInt(req.body.quantity) || 1, 1), 100); // 1-100 credits

    if (!email) {
      return res.status(400).json({
        error: 'User email not found. Please sign in again.'
      });
    }

    const { url, sessionId } = await stripeService.createCreditCheckoutSession(userId, email, quantity);

    res.json({
      success: true,
      checkoutUrl: url,
      sessionId,
      quantity
    });
  } catch (error) {
    console.error('Credit checkout creation error:', error.message);
    res.status(500).json({
      error: 'Failed to create credit checkout session',
      details: error.message
    });
  }
});

/**
 * POST /api/buy-watermark-removal
 * Creates a Stripe checkout session for watermark removal + premium generation ($2.99)
 * SECURITY: Requires authentication
 */
app.post('/api/buy-watermark-removal', checkoutLimiter, requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;

    if (!email) {
      return res.status(400).json({
        error: 'User email not found. Please sign in again.'
      });
    }

    const { url, sessionId } = await stripeService.createWatermarkRemovalSession(userId, email);

    res.json({
      success: true,
      url,
      sessionId
    });
  } catch (error) {
    console.error('Watermark removal checkout error:', error.message);
    res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
});

/**
 * POST /api/customer-portal
 * Creates a Stripe Customer Portal session for subscription management
 * SECURITY: Requires authentication
 */
app.post('/api/customer-portal', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's profile to find their Stripe customer ID
    const profile = await getProfile(userId);
    if (!profile?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No Stripe customer found. You need an active subscription to access the portal.'
      });
    }

    const { url } = await stripeService.createCustomerPortalSession(profile.stripe_customer_id);

    res.json({
      success: true,
      portalUrl: url
    });
  } catch (error) {
    console.error('Customer portal creation error:', error.message);
    res.status(500).json({
      error: 'Failed to create customer portal session',
      details: error.message
    });
  }
});

/**
 * POST /api/verify-session
 * Verify a completed Stripe checkout session and update user profile
 * Used as fallback when webhooks don't work (e.g., local development)
 * Body: { sessionId: string }
 */
app.post('/api/verify-session', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.id;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Verify the session with Stripe
    const result = await stripeService.verifyCheckoutSession(sessionId);

    if (!result.success) {
      return res.status(400).json({ error: result.message || 'Payment not completed' });
    }

    // Verify the session belongs to this user
    if (result.userId && result.userId !== userId) {
      console.warn(`Session user mismatch: expected ${userId}, got ${result.userId}`);
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    // Update user profile in Supabase
    const updateData = {
      stripe_customer_id: result.customerId,
      updated_at: new Date().toISOString()
    };

    if (result.type === 'subscription') {
      updateData.tier = 'base';
      updateData.stripe_subscription_id = result.subscriptionId;
      updateData.subscription_status = 'active';
      updateData.monthly_generation_count = 0;
      updateData.monthly_reset_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (result.type === 'credit') {
      // For credits, increment the balance
      const { data: profile } = await supabase
        .from('profiles')
        .select('credit_balance')
        .eq('id', userId)
        .single();

      updateData.credit_balance = (profile?.credit_balance || 0) + result.creditsAdded;
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update profile:', updateError);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    console.log(`Verified session ${sessionId} for user ${userId}: ${result.type}`);

    res.json({
      success: true,
      type: result.type,
      tier: result.type === 'subscription' ? 'base' : undefined,
      creditsAdded: result.creditsAdded
    });

  } catch (error) {
    console.error('Verify session error:', error);
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

// ===== USER & USAGE ROUTES =====

/**
 * GET /api/me
 * Returns current user info and usage stats
 * Works for both authenticated and anonymous users
 */
app.get('/api/me', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const clientIP = getClientIP(req);
    let anonId = null;

    // Get user profile if authenticated
    let profile = null;
    if (userId) {
      profile = await getProfile(userId);
    }

    if (!userId) {
      const anonSession = getOrCreateAnonId(req, res);
      anonId = anonSession.anonId;
      const anonUsage = await getAnonUsage(anonId);
      updateAnonCache(anonId, anonUsage.quickCount, anonUsage.premiumCount);
    }

    // Get usage info
    const usage = checkUsage(userId, profile, clientIP, 'quick', anonId);

    // Build response
    const response = {
      authenticated: req.isAuthenticated,
      user: req.user ? {
        id: req.user.id,
        email: req.user.email,
        created_at: req.user.created_at
      } : null,
      profile: profile ? {
        generation_count: profile.generation_count || 0,
        monthly_generation_count: profile.monthly_generation_count || 0,
        monthly_reset_at: profile.monthly_reset_at || null,
        credit_balance: profile.credit_balance || 0,
        tier: profile.tier || 'free',
        stripe_customer_id: profile.stripe_customer_id || null
      } : null,
      usage: {
        tier: usage.tier,
        tierName: usage.tierName,
        used: usage.used,
        limit: usage.limit,
        remaining: usage.remaining,
        canGenerate: usage.canGenerate,
        // Quick/Premium model-specific usage
        quickUsed: usage.quickUsed || 0,
        quickRemaining: usage.quickRemaining || 0,
        quickLimit: usage.quickLimit || 0,
        premiumUsed: usage.premiumUsed || 0,
        premiumRemaining: usage.premiumRemaining || 0,
        premiumLimit: usage.premiumLimit || 0,
        // Monthly and credit fields
        monthlyUsed: usage.monthlyUsed,
        monthlyLimit: usage.monthlyLimit,
        monthlyRemaining: usage.monthlyRemaining,
        credits: usage.credits,
        watermarkFree: usage.watermarkFree,
        watermarkFreeReason: usage.watermarkFreeReason
      },
      tiers: Object.entries(tiers)
        .filter(([key]) => key !== 'credit')  // Don't include credit as a tier
        .map(([key, value]) => ({
          id: key,
          name: value.name,
          limit: value.limit === Infinity ? 'unlimited' : value.limit,
          monthlyLimit: value.monthlyLimit === Infinity ? 'unlimited' : value.monthlyLimit,
          description: value.description,
          watermarkFree: value.watermarkFree || false,
          priceMonthly: value.priceMonthly || null
        })),
      pricing: {
        subscription: {
          name: tiers.base.name,
          priceMonthly: tiers.base.priceMonthly,
          monthlyLimit: tiers.base.monthlyLimit,
          description: tiers.base.description
        },
        credit: {
          pricePerCredit: tiers.credit.pricePerCredit,
          description: tiers.credit.description
        }
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error in /api/me:', error.message);
    res.status(500).json({
      error: 'Failed to get user info',
      details: error.message
    });
  }
});

/**
 * GET /api/generations
 * Returns generation history for authenticated users
 * Query: ?limit=10
 */
app.get('/api/generations', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const history = generations.getGenerations(userId, limit);

    res.json({
      success: true,
      generations: history,
      count: history.length
    });
  } catch (error) {
    console.error('Error in /api/generations:', error.message);
    res.status(500).json({
      error: 'Failed to get generation history',
      details: error.message
    });
  }
});

/**
 * GET /api/generation/:id
 * Returns a specific generation by ID
 * Query: ?viewToken=xxx (required for anonymous generations)
 */
app.get('/api/generation/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { viewToken } = req.query;
    const userId = req.user?.id || null;

    // Use secure validation that handles both authenticated and anonymous generations
    const { authorized, generation, error } = generations.validateGenerationAccess(id, userId, viewToken);

    if (!authorized) {
      const statusCode = error === 'Generation not found' ? 404 : 403;
      return res.status(statusCode).json({
        error: error
      });
    }

    // Don't expose the viewToken in the response
    const safeGeneration = { ...generation };
    delete safeGeneration.viewToken;

    res.json({
      success: true,
      generation: safeGeneration
    });
  } catch (error) {
    console.error('Error in /api/generation/:id:', error.message);
    res.status(500).json({
      error: 'Failed to get generation',
      details: error.message
    });
  }
});

/**
 * GET /output/:filename
 * SECURITY: Serve generated images only to authorized users
 * - Admin users can access any image
 * - Authenticated users can access their own generations
 * - Anonymous users need a valid viewToken
 */
app.get('/output/:filename', outputLimiter, async (req, res) => {
  try {
    const { filename } = req.params;
    const { viewToken } = req.query;
    const userId = req.user?.id || null;

    // Sanitize filename to prevent path traversal
    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const resultUrl = `/output/${sanitizedFilename}`;
    const filePath = path.join(__dirname, 'output', sanitizedFilename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Admin users can access any image
    if (req.isAdmin) {
      return res.sendFile(filePath);
    }

    // In non-production mode, serve files without strict auth (for testing)
    // This is safe because dev server is localhost only
    if (!isProduction) {
      return res.sendFile(filePath);
    }

    // Find the generation record for this image
    const generation = generations.findByResultUrl(resultUrl);

    if (!generation) {
      // If no generation record, deny access (legacy images or direct file access attempt)
      return res.status(403).json({
        error: 'Access denied',
        details: 'This image is not accessible without proper authorization'
      });
    }

    // Validate access using the generation access rules
    const { authorized, error } = generations.validateGenerationAccess(
      generation.id,
      userId,
      viewToken
    );

    if (!authorized) {
      return res.status(403).json({ error: error || 'Access denied' });
    }

    // Serve the file
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving output file:', error.message);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

/**
 * GET /api/config
 * Returns public client configuration (Supabase URL, pricing, etc.)
 */
app.get('/api/config', (req, res) => {
  const supabaseConfig = getClientConfig();

  res.json({
    supabase: {
      url: supabaseConfig.url,
      anonKey: supabaseConfig.anonKey
    },
    tiers: Object.entries(tiers)
      .filter(([key]) => key !== 'credit')  // Don't include credit as a tier
      .map(([key, value]) => ({
        id: key,
        name: value.name,
        limit: value.limit === Infinity ? 'unlimited' : value.limit,
        monthlyLimit: value.monthlyLimit === Infinity ? 'unlimited' : value.monthlyLimit,
        description: value.description,
        watermarkFree: value.watermarkFree || false,
        priceMonthly: value.priceMonthly || null
      })),
    pricing: {
      subscription: {
        name: tiers.base.name,
        priceMonthly: tiers.base.priceMonthly,
        monthlyLimit: tiers.base.monthlyLimit,
        description: tiers.base.description
      },
      credit: {
        pricePerCredit: tiers.credit.pricePerCredit,
        description: tiers.credit.description
      }
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  const photos = getEpsteinPhotos();
  const anonymousStats = getAnonymousStats();

  res.json({
    status: 'ok',
    apiKeySet: !!process.env.GEMINI_API_KEY,
    stripeConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_BASE),
    supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    epsteinPhotosCount: photos.length,
    anonymousUsersTracked: anonymousStats.totalTracked
  });
});

// ===== LOCAL DEV DEBUG ROUTES =====

app.get('/api/dev/debug', (req, res) => {
  if (isProduction || !isLocalRequest(req)) {
    return res.status(404).json({ allowed: false });
  }

  res.json({
    allowed: true,
    enabled: req.isDevDebug === true
  });
});

app.post('/api/dev/debug', (req, res) => {
  if (isProduction || !isLocalRequest(req)) {
    return res.status(403).json({ allowed: false });
  }

  const enabled = req.body?.enabled === true;
  if (enabled) {
    res.cookie(DEV_DEBUG_COOKIE, '1', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/'
    });
  } else {
    res.clearCookie(DEV_DEBUG_COOKIE, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/'
    });
  }

  res.json({ allowed: true, enabled });
});

// ===== ADMIN DEBUG MODE ROUTES =====

/**
 * POST /api/admin/login
 * Authenticate with admin password and set httpOnly session cookie
 * SECURITY: Uses httpOnly cookie instead of returning token to JavaScript
 * Body: { password: string }
 */
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      error: 'Password is required'
    });
  }

  const result = validateAdminPassword(password);

  if (!result.valid) {
    console.log('[ADMIN] Failed login attempt');
    return res.status(401).json({
      error: result.error
    });
  }

  console.log('[ADMIN] Successful login, setting httpOnly cookie');

  // SECURITY: Set admin token as httpOnly cookie (cannot be read by JavaScript)
  // This prevents XSS attacks from stealing the admin token
  res.cookie('adminToken', result.token, {
    httpOnly: true, // Cannot be accessed by JavaScript
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict', // Prevents CSRF
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/'
  });

  res.json({
    success: true,
    expiresAt: result.expiresAt
    // NOTE: Token is NOT returned - it's only in the httpOnly cookie
  });
});

/**
 * POST /api/admin/logout
 * Invalidate admin session and clear cookie
 */
app.post('/api/admin/logout', (req, res) => {
  // Get token from cookie or header for backwards compatibility
  const token = req.cookies?.adminToken || req.headers['x-admin-token'];

  if (token && adminSessions.has(token)) {
    adminSessions.delete(token);
    console.log('[ADMIN] Session invalidated');
  }

  // Clear the httpOnly cookie
  res.clearCookie('adminToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });

  res.json({ success: true });
});

/**
 * GET /api/admin/debug
 * Get full debug info (requires valid admin token)
 * Header: X-Admin-Token
 */
app.get('/api/admin/debug', (req, res) => {
  if (!req.isAdmin) {
    return res.status(401).json({
      error: 'Admin authentication required'
    });
  }

  const debugInfo = getAdminDebugInfo();

  // Add rate limit info
  const clientIP = getClientIP(req);
  const userId = req.user?.id || null;
  let profile = null;

  // Async wrapper for profile fetch
  (async () => {
    if (userId) {
      profile = await getProfile(userId);
    }

    const usage = checkUsage(userId, profile, clientIP);

    res.json({
      admin: true,
      timestamp: new Date().toISOString(),
      ...debugInfo,
      currentRequest: {
        clientIP,
        userId,
        userTier: usage.tier,
        usageStats: {
          used: usage.used,
          limit: usage.limit,
          remaining: usage.remaining,
          canGenerate: usage.canGenerate
        }
      }
    });
  })();
});

/**
 * GET /api/admin/status
 * Quick check if admin token is valid
 * Header: X-Admin-Token
 */
app.get('/api/admin/status', (req, res) => {
  res.json({
    isAdmin: req.isAdmin,
    adminConfigured: !!ADMIN_PASSWORD
  });
});

// Global error handler - catches all unhandled errors and returns JSON
// MUST be after all routes and middleware
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR'
  });
});

// Start server
app.listen(PORT, () => {
  const photos = getEpsteinPhotos();
  console.log(`\n🎺 Pimp My Epstein Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   ${photos.length} Epstein photos loaded\n`);
});
