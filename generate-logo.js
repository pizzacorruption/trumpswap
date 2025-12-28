#!/usr/bin/env node
/**
 * Generate "PIMP MY EPSTEIN" logo using Gemini API
 * Style: Million Dollar Extreme / World Peace aesthetic
 * VHS glitch, bold typography, ironic/satirical, raw look
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY not found in .env');
  process.exit(1);
}

async function generateLogo() {
  console.log('Initializing Gemini API...');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  // Use imagen-3.0-generate-001 for image generation
  const model = genAI.getGenerativeModel({
    model: 'imagen-3.0-generate-001'
  });

  const prompt = `Create a logo with the text "PIMP MY EPSTEIN" in the style of Million Dollar Extreme World Peace Adult Swim aesthetic:

- VHS glitch effects, scan lines, distortion artifacts
- Bold, aggressive typography - chunky block letters
- Ironic/satirical vibe, deliberately rough and raw
- Color palette: predominantly black and white with neon pink and electric blue accent glitches
- TV static texture, CRT monitor aesthetic
- Early 2000s cable access / public access TV look
- Text should be centered and readable as a website header logo
- Dimensions suitable for a horizontal website header banner
- Grainy, lo-fi quality but intentional and stylized
- Think Tim and Eric meets adult swim bumpers meets underground zine aesthetic`;

  console.log('Generating logo with Imagen 3...');
  console.log('Prompt:', prompt.substring(0, 100) + '...');

  try {
    const result = await model.generateImages({
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '16:9',
        outputMimeType: 'image/png'
      }
    });

    if (result.images && result.images.length > 0) {
      const imageData = result.images[0].image.imageBytes;
      const outputPath = path.join(__dirname, 'public', 'logo.png');

      // Ensure public directory exists
      const publicDir = path.join(__dirname, 'public');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      // Convert base64 to buffer and save
      const buffer = Buffer.from(imageData, 'base64');
      fs.writeFileSync(outputPath, buffer);

      console.log('SUCCESS! Logo saved to:', outputPath);
      console.log('File size:', (buffer.length / 1024).toFixed(2), 'KB');
    } else {
      console.error('No images returned from API');
    }
  } catch (error) {
    console.error('Error generating image:', error.message);

    // Try alternative approach with gemini-2.0-flash-exp
    console.log('\nTrying alternative approach with gemini-2.0-flash-exp...');
    await tryFlashModel(genAI);
  }
}

async function tryFlashModel(genAI) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    generationConfig: {
      responseModalities: ['image', 'text']
    }
  });

  const prompt = `Generate an image: A logo with the text "PIMP MY EPSTEIN" in Million Dollar Extreme World Peace Adult Swim aesthetic. VHS glitch effects, scan lines, bold aggressive block letter typography, black and white with neon pink and electric blue glitch accents. TV static texture, CRT monitor look, grainy lo-fi but intentional. Horizontal banner format for website header.`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;

    // Check for inline data (image)
    if (response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;

      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
          const imageData = part.inlineData.data;
          const outputPath = path.join(__dirname, 'public', 'logo.png');

          const publicDir = path.join(__dirname, 'public');
          if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
          }

          const buffer = Buffer.from(imageData, 'base64');
          fs.writeFileSync(outputPath, buffer);

          console.log('SUCCESS! Logo saved to:', outputPath);
          console.log('File size:', (buffer.length / 1024).toFixed(2), 'KB');
          return;
        }
      }
    }

    console.log('Response:', JSON.stringify(response, null, 2));
    console.error('No image data found in response');
  } catch (error) {
    console.error('Flash model error:', error.message);
    console.error('Full error:', error);
  }
}

generateLogo().catch(console.error);
