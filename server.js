/**
 * Trump Swap Server
 * Face swap with pre-loaded Trump photos
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/trump-photos', express.static('public/trump-photos'));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Use JPG, PNG, or WebP.'));
    }
  }
});

// Ensure directories exist
['output', 'public/trump-photos'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Add watermark to image buffer
 */
async function addWatermark(inputBuffer, watermarkText = 'TRUMPSWAP.LOL') {
  const metadata = await sharp(inputBuffer).metadata();
  const { width, height } = metadata;

  // Create SVG text overlay (diagonal, semi-transparent)
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
 * Get list of Trump photos for gallery
 */
function getTrumpPhotos() {
  const photosDir = path.join(__dirname, 'public', 'trump-photos');

  if (!fs.existsSync(photosDir)) {
    return [];
  }

  const files = fs.readdirSync(photosDir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => ({
      name: f.replace(/\.[^.]+$/, '').replace(/-/g, ' '),
      path: `/trump-photos/${f}`,
      filename: f
    }));

  return files;
}

// API: Get Trump photos for gallery
app.get('/api/photos', (req, res) => {
  const photos = getTrumpPhotos();
  res.json({ photos });
});

// API: Generate face swap
app.post('/api/generate', upload.single('userPhoto'), async (req, res) => {
  try {
    const userPhoto = req.file;
    const { trumpPhoto, debug } = req.body;

    if (!userPhoto) {
      return res.status(400).json({ error: 'Your photo is required' });
    }

    if (!trumpPhoto) {
      return res.status(400).json({ error: 'Trump photo selection is required' });
    }

    // Read the Trump photo from disk
    const trumpPhotoPath = path.join(__dirname, 'public', trumpPhoto);
    if (!fs.existsSync(trumpPhotoPath)) {
      return res.status(400).json({ error: 'Selected Trump photo not found' });
    }

    const trumpPhotoBuffer = fs.readFileSync(trumpPhotoPath);
    const trumpPhotoMime = trumpPhoto.endsWith('.png') ? 'image/png' : 'image/jpeg';

    console.log(`\n🎬 Generating Trump swap...`);
    console.log(`   Trump photo: ${trumpPhoto}`);

    // Get the model - Nano Banana Pro (Gemini 3 Pro Image)
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });

    // Create the prompt - replace the WHOLE PERSON next to Trump
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
          mimeType: userPhoto.mimetype,
          data: userPhoto.buffer.toString('base64'),
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

          // Save the image
          const filename = `trump_${Date.now()}.png`;
          const outputPath = path.join('output', filename);
          fs.writeFileSync(outputPath, imageBuffer);

          console.log(`✅ Generated: ${filename}${isDebug ? ' (no watermark - debug)' : ''}`);

          return res.json({
            success: true,
            imageUrl: `/output/${filename}`
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
    console.error('❌ Generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const photos = getTrumpPhotos();
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.GEMINI_API_KEY,
    trumpPhotosCount: photos.length
  });
});

// Start server
app.listen(PORT, () => {
  const photos = getTrumpPhotos();
  console.log(`\n🎺 Trump Swap Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   ${photos.length} Trump photos loaded\n`);
});
