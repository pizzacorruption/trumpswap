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
async function addWatermark(inputBuffer, watermarkText = 'PIMPMYEPSTEIN.LOL') {
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
        transform="rotate(-30, ${width / 2}, ${height / 2})"
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

    // Validate file type by MIME and extension
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(userPhotoFile.mimetype)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed' });
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

    // Create the prompt
    const prompt = `PERSON REPLACEMENT TASK:

IMAGE 1: Photo of Jeffrey Epstein with another person
IMAGE 2: Photo of the person who should appear next to Jeffrey Epstein instead

TASK: Replace the person standing with Jeffrey Epstein (not Epstein himself) with the person from IMAGE 2.

INSTRUCTIONS:
- Remove the other person from IMAGE 1 entirely
- Insert the person from IMAGE 2 in their place, standing next to Jeffrey Epstein
- The person from IMAGE 2 should appear with their own body, clothes, and appearance
- Keep Jeffrey Epstein exactly as he is
- Keep the same background and setting from IMAGE 1
- Make it look like a natural photo of Jeffrey Epstein standing with the person from IMAGE 2
- Match the lighting and scale so it looks realistic

Generate the edited photo showing Jeffrey Epstein with the new person.`;

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
