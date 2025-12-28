/**
 * Test Script: Verify Nano Banana Pro (gemini-3-pro-image-preview) Image Quality
 *
 * This script tests the Gemini API with the Nano Banana Pro model
 * to verify image generation quality and resolution.
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const sharp = require('sharp');

// Initialize the Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testNanoBananaPro() {
  console.log('='.repeat(60));
  console.log('Nano Banana Pro (gemini-3-pro-image-preview) Test');
  console.log('='.repeat(60));
  console.log();

  // Verify API key is set
  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not found in .env file');
    process.exit(1);
  }
  console.log('[OK] GEMINI_API_KEY is set');

  // Model configuration
  const MODEL_ID = 'gemini-3-pro-image-preview';
  console.log(`[INFO] Using model: ${MODEL_ID}`);
  console.log();

  try {
    // Initialize the model with image generation capabilities
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });

    // Test prompt - designed to test quality features
    const prompt = `Generate a photorealistic portrait of a professional businessman in a tailored navy suit, standing in a modern office with floor-to-ceiling windows overlooking a city skyline. The lighting should be natural daylight coming through the windows. The image should be high quality and detailed, showing clear facial features, fabric texture on the suit, and depth of field.`;

    console.log('[INFO] Sending generation request...');
    console.log(`[INFO] Prompt: "${prompt.substring(0, 80)}..."`);
    console.log();

    const startTime = Date.now();

    // Make the API request
    const result = await model.generateContent(prompt);
    const response = await result.response;

    const elapsedTime = Date.now() - startTime;
    console.log(`[INFO] Response received in ${elapsedTime}ms`);

    // Check for image in response
    if (response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;

      for (const part of parts) {
        if (part.inlineData) {
          // Decode the image
          const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
          const outputPath = '/tmp/gemini-test-output.png';

          // Save the image
          fs.writeFileSync(outputPath, imageBuffer);
          console.log(`[OK] Image saved to: ${outputPath}`);

          // Analyze image metadata using sharp
          const metadata = await sharp(imageBuffer).metadata();

          console.log();
          console.log('='.repeat(60));
          console.log('IMAGE ANALYSIS RESULTS');
          console.log('='.repeat(60));
          console.log();
          console.log(`Resolution: ${metadata.width} x ${metadata.height} pixels`);
          console.log(`Total pixels: ${(metadata.width * metadata.height / 1000000).toFixed(2)} megapixels`);
          console.log(`Format: ${metadata.format}`);
          console.log(`Channels: ${metadata.channels}`);
          console.log(`Color space: ${metadata.space}`);
          console.log(`Has alpha: ${metadata.hasAlpha}`);
          console.log(`File size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
          console.log();

          // Quality assessment
          console.log('QUALITY ASSESSMENT:');
          console.log('-'.repeat(40));

          const totalPixels = metadata.width * metadata.height;

          if (totalPixels >= 4000000) {
            console.log('[HIGH QUALITY] 4K+ resolution (4MP+) - Nano Banana Pro quality');
          } else if (totalPixels >= 2000000) {
            console.log('[GOOD QUALITY] 2K resolution (2MP+) - Nano Banana Pro standard');
          } else if (totalPixels >= 1000000) {
            console.log('[STANDARD] 1K resolution (~1MP) - Nano Banana (non-Pro) level');
          } else {
            console.log('[LOW QUALITY] Sub-1K resolution - This is slop tier!');
          }

          // Check aspect ratio
          const aspectRatio = metadata.width / metadata.height;
          if (Math.abs(aspectRatio - 1) < 0.01) {
            console.log(`Aspect ratio: 1:1 (square)`);
          } else if (Math.abs(aspectRatio - 1.5) < 0.1) {
            console.log(`Aspect ratio: 3:2 (standard photo)`);
          } else if (Math.abs(aspectRatio - 1.78) < 0.1) {
            console.log(`Aspect ratio: 16:9 (widescreen)`);
          } else {
            console.log(`Aspect ratio: ${aspectRatio.toFixed(2)}:1`);
          }

          console.log();
          console.log('='.repeat(60));
          console.log('TEST COMPLETED SUCCESSFULLY');
          console.log('='.repeat(60));
          console.log();
          console.log(`View the generated image at: ${outputPath}`);
          console.log('Open it to visually assess quality (text rendering, details, etc.)');

          return { success: true, path: outputPath, metadata };
        }

        if (part.text) {
          console.log(`[TEXT RESPONSE]: ${part.text}`);
        }
      }
    }

    // Check for safety blocks
    if (response.candidates?.[0]?.finishReason === 'SAFETY') {
      console.error('[ERROR] Request blocked by safety filters');
      return { success: false, error: 'Safety block' };
    }

    console.error('[ERROR] No image was generated in the response');
    return { success: false, error: 'No image generated' };

  } catch (error) {
    console.error();
    console.error('[ERROR] Generation failed:', error.message);

    if (error.message.includes('API key')) {
      console.error('       Check that your GEMINI_API_KEY is valid');
    } else if (error.message.includes('model')) {
      console.error('       The model ID may be incorrect or unavailable');
      console.error('       Try: gemini-2.5-flash-image (Nano Banana)');
      console.error('       Or:  gemini-3-pro-image-preview (Nano Banana Pro)');
    } else if (error.message.includes('quota') || error.message.includes('rate')) {
      console.error('       API quota exceeded or rate limited');
    }

    return { success: false, error: error.message };
  }
}

// Run the test
testNanoBananaPro();
