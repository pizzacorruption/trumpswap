/**
 * E2E Test for Trump Swap
 * Run: npx playwright test test-e2e.js --headed
 * Or: node test-e2e.js (for quick test)
 */

const { chromium } = require('playwright');
const path = require('path');

const TEST_IMAGE = process.argv[2] || './test-face.jpg';

async function runTest() {
  console.log('🧪 Starting Trump Swap E2E Test');
  console.log(`   Using test image: ${TEST_IMAGE}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // 1. Navigate to app
    console.log('\n1. Opening app...');
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.gallery-item', { timeout: 10000 });
    console.log('   ✅ Gallery loaded');

    // 2. Check gallery has photos
    const photoCount = await page.locator('.gallery-item').count();
    console.log(`   Found ${photoCount} Trump photos`);

    // 3. Select a random photo (or it auto-selects)
    const selectedPhoto = await page.locator('.gallery-item.selected').count();
    console.log(`   ${selectedPhoto > 0 ? '✅ Photo auto-selected' : '⚠️ No photo selected'}`);

    // 4. Upload test face image
    console.log('\n2. Uploading test face...');
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(path.resolve(TEST_IMAGE));
    await page.waitForSelector('.upload-zone.has-file', { timeout: 5000 });
    console.log('   ✅ Image uploaded');

    // 5. Click generate
    console.log('\n3. Generating face swap...');
    const generateBtn = page.locator('#generateBtn');
    await generateBtn.click();

    // 6. Wait for result (can take 30+ seconds)
    console.log('   Waiting for AI generation (up to 60s)...');
    await page.waitForSelector('.result.visible', { timeout: 60000 });
    console.log('   ✅ Result received!');

    // 7. Check result image
    const resultImg = page.locator('#resultImage');
    const imgSrc = await resultImg.getAttribute('src');
    console.log(`   Image URL: ${imgSrc}`);

    // 8. Screenshot the result
    await page.screenshot({ path: 'test-result-screenshot.png', fullPage: true });
    console.log('\n📸 Screenshot saved: test-result-screenshot.png');

    // Keep browser open to view result
    console.log('\n✅ TEST PASSED! Browser will stay open for 30s...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    await page.screenshot({ path: 'test-error-screenshot.png' });
    console.log('   Error screenshot saved');
  } finally {
    await browser.close();
  }
}

runTest();
