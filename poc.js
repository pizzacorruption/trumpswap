/**
 * Nano Banana Pro PoC - Celebrity Selfie Generator
 * Uses Gemini 3 Pro Image (Nano Banana Pro)
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Initialize the Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Convert a local image file to base64 for the API
 */
function fileToBase64(filePath) {
  const absolutePath = path.resolve(filePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const base64 = imageBuffer.toString('base64');
  const mimeType = getMimeType(filePath);
  return { base64, mimeType };
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Generate a celebrity selfie using Gemini
 * @param {string} userImagePath - Path to user's selfie
 * @param {string} celebrityName - Name of the celebrity
 * @param {string} scenario - Optional scenario/setting description
 */
async function generateCelebritySelfie(userImagePath, celebrityName, scenario = 'casual selfie') {
  try {
    // Use Nano Banana Pro (Gemini 3 Pro Image)
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    });

    // Read and encode the user's image
    const userImage = fileToBase64(userImagePath);

    // Craft the prompt for celebrity selfie generation
    const prompt = `Create a realistic photo that looks like a genuine selfie of the person in this uploaded photo together with ${celebrityName}.

The setting should be: ${scenario}

Make it look like an authentic smartphone selfie - natural lighting, casual pose, realistic proportions. The person from the uploaded photo should look exactly like themselves, just placed naturally next to ${celebrityName} in a believable way.

Generate the combined image.`;

    console.log(`\n🎬 Generating selfie with ${celebrityName}...`);
    console.log(`📸 Scenario: ${scenario}\n`);

    // Make the API request with the image
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: userImage.mimeType,
          data: userImage.base64,
        },
      },
      prompt,
    ]);

    const response = await result.response;

    // Check for image in response
    if (response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;

      for (const part of parts) {
        if (part.inlineData) {
          // Save the generated image
          const outputFileName = `output_${celebrityName.replace(/\s+/g, '_')}_${Date.now()}.png`;
          const outputPath = path.join(__dirname, 'output', outputFileName);

          // Ensure output directory exists
          if (!fs.existsSync(path.join(__dirname, 'output'))) {
            fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
          }

          // Decode and save the image
          const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
          fs.writeFileSync(outputPath, imageBuffer);

          console.log(`✅ Image saved to: ${outputPath}`);
          return outputPath;
        }

        if (part.text) {
          console.log(`📝 Response: ${part.text}`);
        }
      }
    }

    console.log('❌ No image was generated in the response');
    return null;

  } catch (error) {
    console.error('❌ Error generating image:', error.message);
    if (error.message.includes('API key')) {
      console.error('   Check that your GEMINI_API_KEY is valid in .env');
    }
    throw error;
  }
}

/**
 * List of trending celebrities for the curated gallery
 */
const TRENDING_CELEBS = [
  'Taylor Swift',
  'Timothée Chalamet',
  'Zendaya',
  'Bad Bunny',
  'Margot Robbie',
  'Ryan Gosling',
  'Sydney Sweeney',
  'Pedro Pascal',
  'Jenna Ortega',
  'Jacob Elordi',
];

/**
 * Demo scenarios for variety
 */
const SCENARIOS = [
  'at a coffee shop, casual morning vibe',
  'backstage at a concert',
  'at a movie premiere red carpet',
  'hanging out at a house party',
  'at a fancy restaurant dinner',
  'courtside at a basketball game',
];

// CLI interface for testing
async function main() {
  console.log('🍌 Nano Banana Pro - Celebrity Selfie Generator PoC\n');
  console.log('=' .repeat(50));

  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('\nUsage: node poc.js <your-photo.jpg> <celebrity-name> [scenario]');
    console.log('\nExample:');
    console.log('  node poc.js selfie.jpg "Taylor Swift" "at a coffee shop"');
    console.log('\n📋 Trending celebrities:');
    TRENDING_CELEBS.forEach((celeb, i) => console.log(`   ${i + 1}. ${celeb}`));
    console.log('\n🎬 Example scenarios:');
    SCENARIOS.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
    return;
  }

  const [imagePath, celebrity, ...scenarioParts] = args;
  const scenario = scenarioParts.join(' ') || 'casual selfie together';

  // Check if image exists
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Image not found: ${imagePath}`);
    return;
  }

  await generateCelebritySelfie(imagePath, celebrity, scenario);
}

// Export for use as a module
module.exports = {
  generateCelebritySelfie,
  TRENDING_CELEBS,
  SCENARIOS,
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
