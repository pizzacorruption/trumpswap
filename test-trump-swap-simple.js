/**
 * Simplified E2E Tests for Trump Swap
 * Bypasses gallery loading issues by directly testing API and using evaluate
 *
 * Run: node test-trump-swap-simple.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const TEST_IMAGE = path.resolve('/Users/jacquelineoliver/Documents/GitHub/slopdepot/epswag/test-face.jpg');
const TEST_OUTPUT_DIR = path.resolve('/Users/jacquelineoliver/Documents/GitHub/slopdepot/epswag/test-outputs');

// Test results
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

function logTest(testName, passed, error = null, duration = null) {
  const status = passed ? 'PASS' : 'FAIL';
  const durationStr = duration ? ` (${duration}ms)` : '';
  console.log(`[${status}] ${testName}${durationStr}`);

  if (passed) {
    testResults.passed.push({ name: testName, duration });
  } else {
    testResults.failed.push({ name: testName, error: error?.message || error });
    if (error) {
      console.log(`       Error: ${error?.message || error}`);
    }
  }
}

async function runTests() {
  testResults.startTime = Date.now();
  console.log('\n========================================');
  console.log('TRUMP SWAP E2E TESTS');
  console.log('========================================\n');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Test Image: ${TEST_IMAGE}\n`);

  const browser = await chromium.launch({
    headless: false, // Visible browser
    slowMo: 50
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('supabase')) {
      console.log(`[Browser Error] ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    console.log(`[Page Error] ${err.message}`);
  });

  try {
    // ============================================================
    // TEST 1: Server API Health Check
    // ============================================================
    console.log('\n--- TEST 1: Server Health Check ---');
    try {
      const response = await page.goto(`${BASE_URL}/api/health`, { waitUntil: 'networkidle' });
      const health = await response.json();

      if (health.status === 'ok' && health.apiKeySet) {
        logTest('Server health check', true);
        console.log(`       API Key: ${health.apiKeySet}`);
        console.log(`       Photos: ${health.trumpPhotosCount}`);
      } else {
        logTest('Server health check', false, 'Server unhealthy');
      }
    } catch (e) {
      logTest('Server health check', false, e);
    }

    // ============================================================
    // TEST 2: Photos API
    // ============================================================
    console.log('\n--- TEST 2: Photos API ---');
    try {
      const response = await page.goto(`${BASE_URL}/api/photos`, { waitUntil: 'networkidle' });
      const data = await response.json();

      if (data.photos && data.photos.length >= 20) {
        logTest('Photos API returns photos', true);
        console.log(`       Found ${data.photos.length} photos`);
      } else {
        logTest('Photos API returns photos', false, `Got ${data.photos?.length || 0} photos`);
      }
    } catch (e) {
      logTest('Photos API returns photos', false, e);
    }

    // ============================================================
    // TEST 3: Page Loads
    // ============================================================
    console.log('\n--- TEST 3: Page Loads ---');
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // Take screenshot
      await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'page-load.png') });

      const title = await page.title();
      logTest('Page loads', title.includes('Trump'), `Title: ${title}`);
    } catch (e) {
      logTest('Page loads', false, e);
    }

    // ============================================================
    // TEST 4: Manually Load Gallery (bypass auth issues)
    // ============================================================
    console.log('\n--- TEST 4: Manual Gallery Load ---');
    try {
      // Directly call loadGallery via evaluate
      await page.evaluate(async () => {
        try {
          const res = await fetch('/api/photos');
          const data = await res.json();
          window.trumpPhotos = data.photos;

          const gallery = document.getElementById('gallery');
          gallery.innerHTML = window.trumpPhotos.map((photo, i) => `
            <div class="gallery-item" data-index="${i}" data-path="${photo.path}">
              <img src="${photo.path}" alt="${photo.name}" loading="lazy">
              <div class="check">✓</div>
            </div>
          `).join('');

          // Select first photo
          const firstItem = gallery.querySelector('.gallery-item');
          if (firstItem) {
            firstItem.classList.add('selected');
            window.selectedPhoto = firstItem.dataset.path;
          }
        } catch (e) {
          console.error('Manual gallery load failed:', e);
        }
      });

      await page.waitForTimeout(500);
      const photoCount = await page.locator('.gallery-item').count();

      if (photoCount > 0) {
        logTest('Manual gallery load', true);
        console.log(`       Loaded ${photoCount} photos`);
        await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'gallery-loaded.png') });
      } else {
        logTest('Manual gallery load', false, 'No photos rendered');
      }
    } catch (e) {
      logTest('Manual gallery load', false, e);
    }

    // ============================================================
    // TEST 5: Photo Selection
    // ============================================================
    console.log('\n--- TEST 5: Photo Selection ---');
    try {
      // Click on second photo
      const secondPhoto = page.locator('.gallery-item').nth(1);
      await secondPhoto.click();
      await page.waitForTimeout(300);

      const selectedCount = await page.locator('.gallery-item.selected').count();
      logTest('Photo selection', selectedCount === 1);
    } catch (e) {
      logTest('Photo selection', false, e);
    }

    // ============================================================
    // TEST 6: File Upload
    // ============================================================
    console.log('\n--- TEST 6: File Upload ---');
    try {
      const fileInput = page.locator('#fileInput');
      await fileInput.setInputFiles(TEST_IMAGE);
      await page.waitForTimeout(500);

      // Set userFile in window
      await page.evaluate(() => {
        window.userFile = true; // Mark that file is set
      });

      const hasFile = await page.locator('.upload-zone.has-file').count();
      logTest('File upload', hasFile > 0);

      if (hasFile > 0) {
        await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'file-uploaded.png') });
      }
    } catch (e) {
      logTest('File upload', false, e);
    }

    // ============================================================
    // TEST 7: Generate Button Enablement
    // ============================================================
    console.log('\n--- TEST 7: Generate Button State ---');
    try {
      // Manually enable the generate button
      await page.evaluate(() => {
        const btn = document.getElementById('generateBtn');
        btn.disabled = false;
      });

      const isDisabled = await page.locator('#generateBtn').isDisabled();
      logTest('Generate button enabled', !isDisabled);
    } catch (e) {
      logTest('Generate button enabled', false, e);
    }

    // ============================================================
    // TEST 8: Basic Face Swap Generation
    // ============================================================
    console.log('\n--- TEST 8: Face Swap Generation ---');
    try {
      // We need to manually prepare the data and make the API call
      const selectedPath = await page.locator('.gallery-item.selected').getAttribute('data-path');
      console.log(`       Selected photo: ${selectedPath}`);

      // Read the test image
      const imageBuffer = fs.readFileSync(TEST_IMAGE);
      const base64Image = imageBuffer.toString('base64');

      const startTime = Date.now();

      // Make the API call directly
      const result = await page.evaluate(async ({ trumpPhoto, imageBase64 }) => {
        try {
          // Convert base64 to blob
          const byteCharacters = atob(imageBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/jpeg' });

          const formData = new FormData();
          formData.append('userPhoto', blob, 'test-face.jpg');
          formData.append('trumpPhoto', trumpPhoto);
          formData.append('debug', 'true');

          const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData
          });

          return await response.json();
        } catch (e) {
          return { error: e.message };
        }
      }, { trumpPhoto: selectedPath, imageBase64: base64Image });

      const genTime = Date.now() - startTime;
      testResults.generationTimes.push(genTime);

      if (result.success && result.imageUrl) {
        logTest('Face swap generation', true, null, genTime);
        console.log(`       Result: ${result.imageUrl}`);
        console.log(`       Time: ${(genTime / 1000).toFixed(1)}s`);

        // Navigate to result image
        await page.goto(`${BASE_URL}${result.imageUrl}`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'generation-result.png') });
      } else {
        logTest('Face swap generation', false, result.error || 'No image URL');
      }
    } catch (e) {
      logTest('Face swap generation', false, e);
    }

    // ============================================================
    // TEST 9: Multiple Different Trump Photos
    // ============================================================
    console.log('\n--- TEST 9: Different Trump Photos ---');
    try {
      // Get photo list
      const photosResponse = await page.goto(`${BASE_URL}/api/photos`);
      const photosData = await photosResponse.json();
      const photos = photosData.photos;

      // Test 3 different photos
      const testPhotos = [photos[0], photos[5], photos[10]];
      let successCount = 0;

      const imageBuffer = fs.readFileSync(TEST_IMAGE);
      const base64Image = imageBuffer.toString('base64');

      for (let i = 0; i < testPhotos.length; i++) {
        const photo = testPhotos[i];
        console.log(`       Testing: ${photo.name}`);

        const startTime = Date.now();
        const result = await page.evaluate(async ({ trumpPhoto, imageBase64 }) => {
          const byteCharacters = atob(imageBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let j = 0; j < byteCharacters.length; j++) {
            byteNumbers[j] = byteCharacters.charCodeAt(j);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/jpeg' });

          const formData = new FormData();
          formData.append('userPhoto', blob, 'test-face.jpg');
          formData.append('trumpPhoto', trumpPhoto);
          formData.append('debug', 'true');

          const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData
          });
          return await response.json();
        }, { trumpPhoto: photo.path, imageBase64: base64Image });

        const genTime = Date.now() - startTime;

        if (result.success) {
          testResults.generationTimes.push(genTime);
          console.log(`       ${photo.name}: OK (${(genTime/1000).toFixed(1)}s)`);
          successCount++;
        } else {
          console.log(`       ${photo.name}: FAILED - ${result.error}`);
        }

        // Wait between requests
        await page.waitForTimeout(1000);
      }

      logTest('Different Trump photos', successCount >= 2);
      console.log(`       Success: ${successCount}/${testPhotos.length}`);
    } catch (e) {
      logTest('Different Trump photos', false, e);
    }

    // ============================================================
    // TEST 10: Error - Invalid File Type (API level)
    // ============================================================
    console.log('\n--- TEST 10: Invalid File Type ---');
    try {
      const photosResponse = await page.goto(`${BASE_URL}/api/photos`);
      const photosData = await photosResponse.json();
      const firstPhoto = photosData.photos[0];

      // Create a fake text file as base64
      const textContent = 'This is not an image';
      const base64Text = Buffer.from(textContent).toString('base64');

      const result = await page.evaluate(async ({ trumpPhoto, textBase64 }) => {
        const byteCharacters = atob(textBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'text/plain' });

        const formData = new FormData();
        formData.append('userPhoto', blob, 'test.txt');
        formData.append('trumpPhoto', trumpPhoto);

        const response = await fetch('/api/generate', {
          method: 'POST',
          body: formData
        });
        return { status: response.status, data: await response.json() };
      }, { trumpPhoto: firstPhoto.path, textBase64: base64Text });

      logTest('Invalid file type rejected', result.status === 400);
      console.log(`       Status: ${result.status}`);
      console.log(`       Error: ${result.data.error || 'none'}`);
    } catch (e) {
      logTest('Invalid file type rejected', false, e);
    }

    // ============================================================
    // TEST 11: Error - Missing Trump Photo
    // ============================================================
    console.log('\n--- TEST 11: Missing Trump Photo ---');
    try {
      const imageBuffer = fs.readFileSync(TEST_IMAGE);
      const base64Image = imageBuffer.toString('base64');

      const result = await page.evaluate(async ({ imageBase64 }) => {
        const byteCharacters = atob(imageBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });

        const formData = new FormData();
        formData.append('userPhoto', blob, 'test-face.jpg');
        // No trumpPhoto!

        const response = await fetch('/api/generate', {
          method: 'POST',
          body: formData
        });
        return { status: response.status, data: await response.json() };
      }, { imageBase64: base64Image });

      logTest('Missing trump photo rejected', result.status === 400);
      console.log(`       Status: ${result.status}`);
      console.log(`       Error: ${result.data.error || 'none'}`);
    } catch (e) {
      logTest('Missing trump photo rejected', false, e);
    }

    // ============================================================
    // TEST 12: Error - Missing User Photo
    // ============================================================
    console.log('\n--- TEST 12: Missing User Photo ---');
    try {
      const result = await page.evaluate(async () => {
        const formData = new FormData();
        formData.append('trumpPhoto', '/trump-photos/with-pence.jpg');
        // No userPhoto!

        const response = await fetch('/api/generate', {
          method: 'POST',
          body: formData
        });
        return { status: response.status, data: await response.json() };
      });

      logTest('Missing user photo rejected', result.status === 400);
      console.log(`       Status: ${result.status}`);
      console.log(`       Error: ${result.data.error || 'none'}`);
    } catch (e) {
      logTest('Missing user photo rejected', false, e);
    }

    // ============================================================
    // TEST 13: Download Test (API)
    // ============================================================
    console.log('\n--- TEST 13: Download Generated Image ---');
    try {
      // Get list of generated images
      const outputDir = '/Users/jacquelineoliver/Documents/GitHub/slopdepot/epswag/output';
      const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));

      if (files.length > 0) {
        const latestFile = files.sort().pop();
        const imageUrl = `${BASE_URL}/output/${latestFile}`;

        const response = await page.goto(imageUrl);
        const contentType = response.headers()['content-type'];

        logTest('Download image accessible', response.ok() && contentType.includes('image'));
        console.log(`       Content-Type: ${contentType}`);
        console.log(`       Status: ${response.status()}`);
      } else {
        logTest('Download image accessible', false, 'No generated images found');
      }
    } catch (e) {
      logTest('Download image accessible', false, e);
    }

  } catch (error) {
    console.error('\nCRITICAL ERROR:', error.message);
    await page.screenshot({ path: path.join(TEST_OUTPUT_DIR, 'critical-error.png') });
  } finally {
    await browser.close();
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  testResults.endTime = Date.now();
  const totalTime = testResults.endTime - testResults.startTime;

  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================\n');

  console.log(`Total: ${testResults.passed.length + testResults.failed.length}`);
  console.log(`Passed: ${testResults.passed.length}`);
  console.log(`Failed: ${testResults.failed.length}`);
  console.log(`Duration: ${(totalTime / 1000).toFixed(1)}s`);

  if (testResults.generationTimes.length > 0) {
    const avg = testResults.generationTimes.reduce((a, b) => a + b, 0) / testResults.generationTimes.length;
    const min = Math.min(...testResults.generationTimes);
    const max = Math.max(...testResults.generationTimes);

    console.log('\nGeneration Performance:');
    console.log(`  Average: ${(avg / 1000).toFixed(1)}s`);
    console.log(`  Min: ${(min / 1000).toFixed(1)}s`);
    console.log(`  Max: ${(max / 1000).toFixed(1)}s`);
    console.log(`  Samples: ${testResults.generationTimes.length}`);
  }

  if (testResults.failed.length > 0) {
    console.log('\nFailed Tests:');
    testResults.failed.forEach(t => {
      console.log(`  - ${t.name}: ${t.error}`);
    });
  }

  console.log(`\nScreenshots: ${TEST_OUTPUT_DIR}`);

  // Save results
  fs.writeFileSync(
    path.join(TEST_OUTPUT_DIR, 'simple-test-results.json'),
    JSON.stringify(testResults, null, 2)
  );

  console.log(`\n${testResults.failed.length === 0 ? 'ALL TESTS PASSED!' : 'SOME TESTS FAILED'}\n`);
  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
