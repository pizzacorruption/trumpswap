const { GoogleGenerativeAI } = require('@google/generative-ai');
const { formidable } = require('formidable');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Disable body parser for formidable (Vercel/Next.js API config)
const config = {
  api: {
    bodyParser: false,
  },
};

// Export config for Vercel/Next.js serverless functions
module.exports.config = config;

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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fields, files } = await parseForm(req);

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

    // Read the Epstein photo (path already validated above)
    if (!fs.existsSync(epsteinPhotoPath)) {
      return res.status(400).json({ error: 'Selected Epstein photo not found' });
    }

    const epsteinPhotoBuffer = fs.readFileSync(epsteinPhotoPath);
    const epsteinPhotoExt = path.extname(epsteinPhotoPath).toLowerCase();
    const epsteinPhotoMime = epsteinPhotoExt === '.png' ? 'image/png' :
                             epsteinPhotoExt === '.webp' ? 'image/webp' : 'image/jpeg';

    console.log(`Generating Epstein swap... Epstein photo: ${epsteinPhoto}`);

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
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

          // SECURITY: Always add watermark in serverless function
          // Only the Express server (server.js) can verify admin/paid status
          // Debug flag is NOT trusted to bypass watermark
          imageBuffer = await addWatermark(imageBuffer);

          // Return as base64 data URL (serverless has no persistent disk)
          const base64Image = imageBuffer.toString('base64');
          const dataUrl = `data:image/png;base64,${base64Image}`;

          console.log('Generated image with watermark');

          return res.json({
            success: true,
            imageUrl: dataUrl
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
