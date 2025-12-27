const { GoogleGenerativeAI } = require('@google/generative-ai');
const formidable = require('formidable');
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
 * Add watermark to image buffer
 */
async function addWatermark(inputBuffer, watermarkText = 'TRUMPSWAP.LOL') {
  const metadata = await sharp(inputBuffer).metadata();
  const { width, height } = metadata;

  const fontSize = Math.floor(Math.min(width, height) / 8);
  const svgText = `
    <svg width="${width}" height="${height}">
      <style>
        .watermark {
          fill: rgba(255, 255, 255, 0.25);
          font-size: ${fontSize}px;
          font-family: Arial, sans-serif;
          font-weight: bold;
        }
      </style>
      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        dominant-baseline="middle"
        class="watermark"
        transform="rotate(-30, ${width/2}, ${height/2})"
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

    // Get trump photo selection
    const trumpPhoto = fields.trumpPhoto?.[0] || fields.trumpPhoto;
    if (!trumpPhoto) {
      return res.status(400).json({ error: 'Trump photo selection is required' });
    }

    const debug = fields.debug?.[0] || fields.debug;

    // Read user photo buffer
    const userPhotoBuffer = fs.readFileSync(userPhotoFile.filepath);
    const userPhotoMime = userPhotoFile.mimetype;

    // Read the Trump photo from public folder
    // In Vercel, static files are available at process.cwd()
    const trumpPhotoPath = path.join(process.cwd(), 'public', trumpPhoto);
    if (!fs.existsSync(trumpPhotoPath)) {
      return res.status(400).json({ error: 'Selected Trump photo not found' });
    }

    const trumpPhotoBuffer = fs.readFileSync(trumpPhotoPath);
    const trumpPhotoMime = trumpPhoto.endsWith('.png') ? 'image/png' : 'image/jpeg';

    console.log(`Generating Trump swap... Trump photo: ${trumpPhoto}`);

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });

    // Create the prompt
    const prompt = `PERSON REPLACEMENT TASK:

IMAGE 1: Photo of Donald Trump with another person
IMAGE 2: Photo of the person who should appear next to Trump instead

TASK: Replace the person standing with Trump (not Trump himself) with the person from IMAGE 2.

INSTRUCTIONS:
- Remove the other person from IMAGE 1 entirely
- Insert the person from IMAGE 2 in their place, standing next to Trump
- The person from IMAGE 2 should appear with their own body, clothes, and appearance
- Keep Trump exactly as he is
- Keep the same background and setting from IMAGE 1
- Make it look like a natural photo of Trump standing with the person from IMAGE 2
- Match the lighting and scale so it looks realistic

Generate the edited photo showing Trump with the new person.`;

    // Make API request with both images
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: trumpPhotoMime,
          data: trumpPhotoBuffer.toString('base64'),
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

          // Add watermark (skip in debug mode)
          const isDebug = debug === 'true' || debug === true;
          if (!isDebug) {
            imageBuffer = await addWatermark(imageBuffer);
          }

          // Return as base64 data URL (serverless has no persistent disk)
          const base64Image = imageBuffer.toString('base64');
          const dataUrl = `data:image/png;base64,${base64Image}`;

          console.log(`Generated image${isDebug ? ' (no watermark - debug)' : ''}`);

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
