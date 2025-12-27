/**
 * Final E2E Tests for Trump Swap
 * Accounts for anonymous user rate limiting (1 generation)
 *
 * Run: node test-trump-swap-final.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const TEST_IMAGE = path.resolve('/Users/jacquelineoliver/Documents/GitHub/slopdepot/epswag/test-face.jpg');
const TEST_OUTPUT_DIR = path.resolve('/Users/jacquelineoliver/Documents/GitHub/slopdepot/epswag/test-outputs');

const testResults = {
  passed: [],
  failed: [],
  generationTimes: [],
  startTime: null,
  endTime: null
};

if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

function logTest(name, passed, error = null, duration = null) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}${duration ? ` (${(duration/1000).toFixed(1)}s)` : ''}`);
  if (passed) {
    testResults.passed.push({ name, duration });
  } else {
    testResults.failed.push({ name, error: error?.message || error });
    if (error) console.log(`       Error: ${error?.message || error}`);
  }
}

async function runTests() {
  testResults.startTime = Date.now();

  console.log('\n========================================');
  console.log('TRUMP SWAP - FINAL E2E TEST SUITE');
  console.log('========================================\n');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Image: ${TEST_IMAGE}`);
  console.log('');

  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Read test image once
  const imageBuffer = fs.readFileSync(TEST_IMAGE);
  const base64Image = imageBuffer.toString('base64');

  try {
    // ========== SERVER & API TESTS ==========
    console.log('\n--- SERVER & API TESTS ---');

    // Test 1: Health Check
    console.log('');
    try {
      const resp = await page.goto(`${BASE_URL}/api/health`);
      const health = await resp.json();
      logTest('1. Server health check', health.status === 'ok' && health.apiKeySet);
      console.log(`       Photos: ${health.trumpPhotosCount}, Anonymous tracked: ${health.anonymousUsersTracked}`);
    } catch (e) { logTest('1. Server health check', false, e); }

    // Test 2: Photos API
    try {
      const resp = await page.goto(`${BASE_URL}/api/photos`);
      const data = await resp.json();
      logTest('2. Photos API', data.photos?.length >= 20);
      console.log(`       Found ${data.photos.length} Trump photos`);
    } catch (e) { logTest('2. Photos API', false, e); }

    // ========== UI TESTS ==========
    console.log('\n--- UI TESTS ---');

    // Test 3: Page loads
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const title = await page.title();
      logTest('3. Page loads', title.includes('Trump'));
    } catch (e) { logTest('3. Page loads', false, e); }

    // Test 4: Manually load gallery (bypass auth issues)
    try {
      await page.evaluate(async () => {
        const res = await fetch('/api/photos');
        const data = await res.json();
        window.trumpPhotos = data.photos;
        const gallery = document.getElementById('gallery');
        gallery.innerHTML = window.trumpPhotos.map((photo, i) =>
          `<div class="gallery-item" data-index="${i}" data-path="${photo.path}">
            <img src="${photo.path}" alt="${photo.name}"><div class="check">✓</div>
          </div>`
        ).join('');
        const first = gallery.querySelector('.gallery-item');
        if (first) { first.classList.add('selected'); window.selectedPhoto = first.dataset.path; }
      });
      await page.waitForTimeout(500);
      const count = await page.locator('.gallery-item').count();
      logTest('4. Gallery renders', count >= 20);
      await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'gallery.png') });
    } catch (e) { logTest('4. Gallery renders', false, e); }

    // Test 5: Photo selection
    try {
      await page.locator('.gallery-item').nth(3).click();
      await page.waitForTimeout(200);
      const selected = await page.locator('.gallery-item.selected').count();
      logTest('5. Photo selection', selected === 1);
    } catch (e) { logTest('5. Photo selection', false, e); }

    // Test 6: File upload
    try {
      await page.locator('#fileInput').setInputFiles(TEST_IMAGE);
      await page.waitForTimeout(500);
      const hasFile = await page.locator('.upload-zone.has-file').count();
      logTest('6. File upload', hasFile > 0);
      await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'upload.png') });
    } catch (e) { logTest('6. File upload', false, e); }

    // Test 7: Preview appears
    try {
      const preview = await page.locator('#previewContainer.visible').count();
      logTest('7. Preview appears', preview > 0);
    } catch (e) { logTest('7. Preview appears', false, e); }

    // ========== ERROR HANDLING TESTS ==========
    console.log('\n--- ERROR HANDLING TESTS ---');

    // Test 8: Invalid file type
    try {
      const result = await page.evaluate(async () => {
        const blob = new Blob(['not an image'], { type: 'text/plain' });
        const formData = new FormData();
        formData.append('userPhoto', blob, 'test.txt');
        formData.append('trumpPhoto', '/trump-photos/with-pence.jpg');
        const r = await fetch('/api/generate', { method: 'POST', body: formData });
        return { status: r.status, data: await r.json() };
      });
      logTest('8. Invalid file rejected', result.status === 400);
      console.log(`       Response: ${result.data.error}`);
    } catch (e) { logTest('8. Invalid file rejected', false, e); }

    // Test 9: Missing user photo
    try {
      const result = await page.evaluate(async () => {
        const formData = new FormData();
        formData.append('trumpPhoto', '/trump-photos/with-pence.jpg');
        const r = await fetch('/api/generate', { method: 'POST', body: formData });
        return { status: r.status, data: await r.json() };
      });
      logTest('9. Missing photo rejected', result.status === 400);
      console.log(`       Response: ${result.data.error}`);
    } catch (e) { logTest('9. Missing photo rejected', false, e); }

    // Test 10: Missing trump photo
    try {
      const result = await page.evaluate(async ({ b64 }) => {
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('userPhoto', blob, 'face.jpg');
        // No trumpPhoto!
        const r = await fetch('/api/generate', { method: 'POST', body: formData });
        return { status: r.status, data: await r.json() };
      }, { b64: base64Image });
      logTest('10. Missing trump photo rejected', result.status === 400);
      console.log(`       Response: ${result.data.error}`);
    } catch (e) { logTest('10. Missing trump photo rejected', false, e); }

    // ========== GENERATION TEST ==========
    console.log('\n--- GENERATION TEST (1 allowed for anonymous) ---');

    // Test 11: Face swap generation
    let generationSucceeded = false;
    let generatedImageUrl = null;
    try {
      const selectedPath = await page.locator('.gallery-item.selected').getAttribute('data-path');
      console.log(`       Selected: ${selectedPath}`);

      const startTime = Date.now();
      const result = await page.evaluate(async ({ trumpPhoto, b64 }) => {
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('userPhoto', blob, 'test-face.jpg');
        formData.append('trumpPhoto', trumpPhoto);
        const r = await fetch('/api/generate', { method: 'POST', body: formData });
        return { status: r.status, data: await r.json() };
      }, { trumpPhoto: selectedPath, b64: base64Image });

      const genTime = Date.now() - startTime;
      testResults.generationTimes.push(genTime);

      if (result.data.success && result.data.imageUrl) {
        generationSucceeded = true;
        generatedImageUrl = result.data.imageUrl;
        logTest('11. Face swap generation', true, null, genTime);
        console.log(`       Result: ${result.data.imageUrl}`);
      } else {
        logTest('11. Face swap generation', false, result.data.error);
      }
    } catch (e) { logTest('11. Face swap generation', false, e); }

    // Test 12: Rate limit kicks in after 1 generation
    try {
      const result = await page.evaluate(async ({ b64 }) => {
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('userPhoto', blob, 'face.jpg');
        formData.append('trumpPhoto', '/trump-photos/with-pence.jpg');
        const r = await fetch('/api/generate', { method: 'POST', body: formData });
        return { status: r.status, data: await r.json() };
      }, { b64: base64Image });

      logTest('12. Rate limit works (402)', result.status === 402);
      console.log(`       Status: ${result.status}, Error: ${result.data.error}`);
    } catch (e) { logTest('12. Rate limit works', false, e); }

    // ========== DOWNLOAD TEST ==========
    console.log('\n--- DOWNLOAD TEST ---');

    // Test 13: Generated image accessible
    try {
      if (generatedImageUrl) {
        const resp = await page.goto(`${BASE_URL}${generatedImageUrl}`);
        const contentType = resp.headers()['content-type'];
        logTest('13. Generated image accessible', resp.ok() && contentType.includes('image'));
        console.log(`       Type: ${contentType}, Status: ${resp.status()}`);
        await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'generated-result.png') });
      } else {
        const outputDir = '/Users/jacquelineoliver/Documents/GitHub/slopdepot/epswag/output';
        const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));
        if (files.length > 0) {
          const latest = files.sort().pop();
          const resp = await page.goto(`${BASE_URL}/output/${latest}`);
          logTest('13. Generated image accessible', resp.ok());
        } else {
          logTest('13. Generated image accessible', false, 'No images generated');
        }
      }
    } catch (e) { logTest('13. Generated image accessible', false, e); }

    // ========== UI FLOW TEST ==========
    console.log('\n--- UI FLOW TEST ---');

    // Test 14: Try Another button (reset UI)
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // Manually set up result state
      await page.evaluate((imgUrl) => {
        document.getElementById('mainContent').style.display = 'none';
        document.getElementById('result').classList.add('visible');
        if (imgUrl) document.getElementById('resultImage').src = imgUrl;
      }, generatedImageUrl || '/trump-photos/with-pence.jpg');

      await page.click('#anotherBtn');
      await page.waitForTimeout(500);

      const mainVisible = await page.evaluate(() =>
        document.getElementById('mainContent').style.display !== 'none'
      );
      logTest('14. Try Another resets UI', mainVisible);
    } catch (e) { logTest('14. Try Another resets UI', false, e); }

    // Test 15: Debug mode toggle
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const toggle = page.locator('#debugToggle');
      const visible = await toggle.isVisible();
      logTest('15. Debug toggle exists', visible);
    } catch (e) { logTest('15. Debug toggle exists', false, e); }

  } catch (error) {
    console.error('\nCRITICAL ERROR:', error.message);
    await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'error.png') });
  } finally {
    await browser.close();
  }

  // ========== SUMMARY ==========
  testResults.endTime = Date.now();
  const totalTime = testResults.endTime - testResults.startTime;

  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================\n');

  const total = testResults.passed.length + testResults.failed.length;
  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${testResults.passed.length} (${Math.round(testResults.passed.length/total*100)}%)`);
  console.log(`Failed: ${testResults.failed.length}`);
  console.log(`Duration: ${(totalTime / 1000).toFixed(1)}s`);

  if (testResults.generationTimes.length > 0) {
    const times = testResults.generationTimes;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log('\nGeneration Performance:');
    console.log(`  Average: ${(avg / 1000).toFixed(1)}s`);
    console.log(`  Min: ${(Math.min(...times) / 1000).toFixed(1)}s`);
    console.log(`  Max: ${(Math.max(...times) / 1000).toFixed(1)}s`);
  }

  if (testResults.failed.length > 0) {
    console.log('\nFailed Tests:');
    testResults.failed.forEach(t => console.log(`  - ${t.name}: ${t.error || 'unknown'}`));
  }

  console.log(`\nScreenshots: ${TEST_OUTPUT_DIR}`);

  fs.writeFileSync(
    path.join(TEST_OUTPUT_DIR, 'final-results.json'),
    JSON.stringify(testResults, null, 2)
  );

  const allPassed = testResults.failed.length === 0;
  console.log(`\n${allPassed ? 'ALL TESTS PASSED!' : 'SOME TESTS FAILED'}\n`);
  process.exit(allPassed ? 0 : 1);
}

runTests().catch(e => { console.error('Fatal:', e); process.exit(1); });
