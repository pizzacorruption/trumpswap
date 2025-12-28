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
  const metadata = await sharp(inputBuffer).metadata();
  const { width, height } = metadata;

  const fontSize = Math.floor(Math.min(width, height) / 18);
  const smallFontSize = Math.floor(fontSize * 0.7);

  const svgText = `
    <svg width="${width}" height="${height}">
      <defs>
        <!-- Diagonal repeating pattern -->
        <pattern id="watermarkPattern" width="${width * 0.45}" height="${height * 0.25}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <text x="0" y="${smallFontSize}" font-size="${smallFontSize}px" font-family="Arial, sans-serif" font-weight="600" fill="rgba(255,255,255,0.15)">${watermarkText}</text>
        </pattern>
      </defs>

      <!-- Background pattern covering entire image -->
      <rect width="100%" height="100%" fill="url(#watermarkPattern)" />

      <!-- Center watermark with subtle shadow -->
      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="${fontSize}px"
        font-family="Arial, sans-serif"
        font-weight="bold"
        fill="rgba(255,255,255,0.35)"
        filter="drop-shadow(2px 2px 4px rgba(0,0,0,0.5))"
      >${watermarkText}</text>
    </svg>
  `;

  const watermarkedBuffer = await sharp(inputBuffer)
    .composite([{
      input: Buffer.from(svgText),
      gravity: 'center'
    }])
    .png()
    .toBuffer();

  return watermarkedBuffer;
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

    // Read user photo buffer
    const userPhotoBuffer = fs.readFileSync(userPhotoFile.filepath);
    const userPhotoMime = userPhotoFile.mimetype;

    // Read the Epstein photo from public folder
    // In Vercel, static files are available at process.cwd()
    const epsteinPhotoPath = path.join(process.cwd(), 'public', epsteinPhoto);
    if (!fs.existsSync(epsteinPhotoPath)) {
      return res.status(400).json({ error: 'Selected Epstein photo not found' });
    }

    const epsteinPhotoBuffer = fs.readFileSync(epsteinPhotoPath);
    const epsteinPhotoMime = epsteinPhoto.endsWith('.png') ? 'image/png' : 'image/jpeg';

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
