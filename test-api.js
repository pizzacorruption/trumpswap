/**
 * Quick API key validation test
 * Run: npm run test-api
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testApiKey() {
  console.log('🔑 Testing Gemini API key...\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not found in .env file');
    process.exit(1);
  }

  console.log(`   Key prefix: ${process.env.GEMINI_API_KEY.substring(0, 10)}...`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Test with a simple text request first
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    console.log('\n📡 Sending test request to Gemini 2.0 Flash...');

    const result = await model.generateContent('Say "API working!" in exactly 2 words.');
    const response = await result.response;
    const text = response.text();

    console.log(`\n✅ API Response: "${text.trim()}"`);
    console.log('\n🎉 API key is valid and working!');
    console.log('\n📸 Next steps:');
    console.log('   1. Add a selfie photo to this directory');
    console.log('   2. Run: node poc.js your-selfie.jpg "Taylor Swift"');

  } catch (error) {
    console.error('\n❌ API test failed:', error.message);

    if (error.message.includes('API_KEY_INVALID')) {
      console.error('\n   Your API key appears to be invalid.');
      console.error('   Get a valid key at: https://makersuite.google.com/app/apikey');
    } else if (error.message.includes('quota')) {
      console.error('\n   You may have exceeded your API quota.');
    }

    process.exit(1);
  }
}

testApiKey();
