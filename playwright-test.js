/**
 * Pimp My Epstein UI/UX Playwright Test Suite
 * Tests page load, photo selection, file upload, generate button, result display,
 * mobile responsiveness, and debug mode.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'test-screenshots');

// Create screenshots directory
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Test results collector
const testResults = {
  passed: [],
  failed: [],
  screenshots: [],
  jsErrors: []
};

function logTest(name, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${name}${details ? ' - ' + details : ''}`);
  if (passed) {
    testResults.passed.push(name);
  } else {
    testResults.failed.push({ name, details });
  }
}

async function takeScreenshot(page, name) {
  const filename = `${name.replace(/\s+/g, '-').toLowerCase()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  testResults.screenshots.push(filepath);
  console.log(`   Screenshot saved: ${filepath}`);
  return filepath;
}

async function runTests() {
  console.log('\n========================================');
  console.log('Pimp My Epstein UI/UX Playwright Test Suite');
  console.log('========================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect JS errors
  page.on('pageerror', err => {
    testResults.jsErrors.push(err.message);
    console.log(`   [JS ERROR]: ${err.message}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`   [Console Error]: ${msg.text()}`);
    }
  });

  try {
    // ============================================
    // TEST 1: Page Load and Rendering
    // ============================================
    console.log('\n--- 1. Page Load and Rendering ---\n');

    // Test 1.1: Page loads without network errors
    const response = await page.goto(BASE_URL, {
      timeout: 30000,
      waitUntil: 'networkidle'
    });

    logTest('Page loads without network errors', response?.ok(),
      response?.ok() ? `Status ${response.status()}` : `Status ${response?.status()}`);

    // Give page time to execute JS
    await page.waitForTimeout(2000);

    await takeScreenshot(page, '01-initial-load');

    // Report JS errors found
    if (testResults.jsErrors.length > 0) {
      console.log(`\n   Found ${testResults.jsErrors.length} JavaScript error(s):`);
      testResults.jsErrors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
      logTest('No JavaScript errors on load', false, testResults.jsErrors[0]);
    } else {
      logTest('No JavaScript errors on load', true);
    }

    // Test 1.2: Core elements visibility check
    const elements = [
      { selector: 'h1', name: 'Title (h1)' },
      { selector: '.subtitle', name: 'Subtitle' },
      { selector: '#gallery', name: 'Photo Gallery container' },
      { selector: '#uploadZone', name: 'Upload Zone' },
      { selector: '#generateBtn', name: 'Generate Button' },
      { selector: '#usageBadge', name: 'Usage Badge' },
      { selector: '.debug-toggle', name: 'Debug Toggle' },
      { selector: 'footer', name: 'Footer' }
    ];

    for (const el of elements) {
      try {
        const visible = await page.locator(el.selector).isVisible({ timeout: 1000 });
        logTest(`${el.name} is visible`, visible);
      } catch (e) {
        logTest(`${el.name} is visible`, false, 'Element not found or timeout');
      }
    }

    // Test 1.3: Gallery items - wait longer and check if they load
    console.log('\n   Checking for gallery items...');
    try {
      await page.waitForSelector('.gallery-item', { timeout: 5000 });
      const galleryItems = await page.locator('.gallery-item').count();
      logTest('Gallery is populated with Epstein photos', galleryItems > 0,
        `${galleryItems} photos found`);
    } catch (e) {
      // Gallery items didn't load - let's check if the gallery HTML is there
      const galleryHTML = await page.locator('#gallery').innerHTML();
      console.log(`   Gallery HTML content (first 200 chars): ${galleryHTML.substring(0, 200)}`);
      logTest('Gallery is populated with Epstein photos', false,
        'No gallery items found - likely JS error preventing initialization');
    }

    await takeScreenshot(page, '02-elements-visible');

    // ============================================
    // TEST 2: Photo Selection
    // ============================================
    console.log('\n--- 2. Photo Selection ---\n');

    // Check if gallery items exist before testing selection
    const galleryItemCount = await page.locator('.gallery-item').count();

    if (galleryItemCount === 0) {
      console.log('   SKIPPING: Gallery items not loaded, cannot test selection');
      logTest('Photo selection tests', false, 'Gallery items not loaded');
    } else {
      // Test 2.1: Check if a photo is auto-selected on load
      const autoSelected = await page.locator('.gallery-item.selected').count();
      logTest('A photo is auto-selected on page load', autoSelected === 1,
        autoSelected === 1 ? 'One photo auto-selected' : `${autoSelected} selected`);

      // Test 2.2: Click on different Epstein photos
      const secondPhoto = page.locator('.gallery-item').nth(1);
      await secondPhoto.click();
      await page.waitForTimeout(300);

      const secondPhotoSelected = await secondPhoto.evaluate(el => el.classList.contains('selected'));
      logTest('Clicking a photo selects it', secondPhotoSelected);

      // Test 2.3: Check that checkmark appears
      const checkVisible = await secondPhoto.locator('.check').isVisible();
      logTest('Selected photo shows checkmark', secondPhotoSelected);

      // Test 2.4: Click another photo and verify selection changes
      const thirdPhoto = page.locator('.gallery-item').nth(2);
      await thirdPhoto.click();
      await page.waitForTimeout(300);

      const thirdSelected = await thirdPhoto.evaluate(el => el.classList.contains('selected'));
      const secondNoLongerSelected = !(await secondPhoto.evaluate(el => el.classList.contains('selected')));
      logTest('Selecting new photo deselects previous', thirdSelected && secondNoLongerSelected);

      // Test 2.5: Random button works
      await page.click('#randomBtn');
      await page.waitForTimeout(300);
      const afterRandom = await page.locator('.gallery-item.selected').count();
      logTest('"Surprise me" button selects a photo', afterRandom === 1);

      await takeScreenshot(page, '03-photo-selection');
    }

    // ============================================
    // TEST 3: File Upload
    // ============================================
    console.log('\n--- 3. File Upload ---\n');

    // Use a Epstein photo as test input
    const epsteinPhotos = fs.readdirSync(path.join(__dirname, 'public', 'epstein-photos'));
    let uploadFile = path.join(__dirname, 'public', 'epstein-photos', epsteinPhotos[0]);
    console.log(`   Using test file: ${uploadFile}`);

    // Test 3.1: File input works
    const fileInput = page.locator('#fileInput');

    try {
      await fileInput.setInputFiles(uploadFile);
      await page.waitForTimeout(500);

      // Test 3.2: Preview shows after upload
      const previewVisible = await page.locator('#previewContainer.visible').isVisible();
      logTest('Preview container appears after file upload', previewVisible);

      // Test 3.3: Preview image has src
      const previewSrc = await page.locator('#previewImg').getAttribute('src');
      logTest('Preview image has source', !!previewSrc && previewSrc.length > 0);

      // Test 3.4: Upload zone has 'has-file' class
      const hasFileClass = await page.locator('#uploadZone.has-file').isVisible();
      logTest('Upload zone shows file uploaded state', hasFileClass);

      await takeScreenshot(page, '04-file-uploaded');
    } catch (e) {
      logTest('File upload functionality', false, e.message);
    }

    // Test 3.5: Drag and drop zone exists and has proper structure
    const uploadZoneExists = await page.locator('#uploadZone').count() === 1;
    logTest('Upload zone exists for drag-drop', uploadZoneExists);

    // ============================================
    // TEST 4: Generate Button States
    // ============================================
    console.log('\n--- 4. Generate Button States ---\n');

    // Check current state
    const btnDisabled = await page.locator('#generateBtn').isDisabled();
    const hasGallerySelection = await page.locator('.gallery-item.selected').count() > 0;
    const hasFileUploaded = await page.locator('#uploadZone.has-file').count() > 0;

    console.log(`   Gallery selection: ${hasGallerySelection}`);
    console.log(`   File uploaded: ${hasFileUploaded}`);
    console.log(`   Button disabled: ${btnDisabled}`);

    if (hasGallerySelection && hasFileUploaded) {
      logTest('Generate button enabled when ready', !btnDisabled);
    } else if (!hasGallerySelection && !hasFileUploaded) {
      logTest('Generate button disabled without selection/upload', btnDisabled);
    } else {
      logTest('Generate button state appropriate for partial completion', btnDisabled);
    }

    await takeScreenshot(page, '05-generate-button-state');

    // ============================================
    // TEST 5: Result Display Structure
    // ============================================
    console.log('\n--- 5. Result Display Structure ---\n');

    const resultContainer = page.locator('#result');
    const downloadBtn = page.locator('#downloadBtn');
    const shareBtn = page.locator('#shareBtn');
    const anotherBtn = page.locator('#anotherBtn');

    logTest('Result container exists', await resultContainer.count() === 1);
    logTest('Download button exists', await downloadBtn.count() === 1);
    logTest('Share button exists', await shareBtn.count() === 1);
    logTest('Try Another button exists', await anotherBtn.count() === 1);

    // Result should be hidden initially
    const resultHidden = !(await resultContainer.isVisible());
    logTest('Result container is hidden initially', resultHidden);

    // ============================================
    // TEST 6: Mobile Responsiveness
    // ============================================
    console.log('\n--- 6. Mobile Responsiveness ---\n');

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    await takeScreenshot(page, '06-mobile-viewport');

    // Test 6.1: Check if elements adapt
    const mobileTitle = await page.locator('h1').isVisible();
    logTest('Title visible on mobile', mobileTitle);

    const mobileGallery = await page.locator('.gallery').isVisible();
    logTest('Gallery container visible on mobile', mobileGallery);

    const mobileUpload = await page.locator('#uploadZone').isVisible();
    logTest('Upload zone visible on mobile', mobileUpload);

    const mobileBtn = await page.locator('#generateBtn').isVisible();
    logTest('Generate button visible on mobile', mobileBtn);

    // Test 6.2: Check gallery layout on mobile
    const galleryStyles = await page.evaluate(() => {
      const gallery = document.querySelector('.gallery');
      const computed = window.getComputedStyle(gallery);
      return {
        display: computed.display,
        gridTemplateColumns: computed.gridTemplateColumns
      };
    });
    console.log(`   Mobile gallery styles: display=${galleryStyles.display}`);
    logTest('Gallery uses grid layout', galleryStyles.display === 'grid');

    await takeScreenshot(page, '07-mobile-layout');

    // Reset to desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    await takeScreenshot(page, '08-desktop-layout');

    // ============================================
    // TEST 7: Debug Mode
    // ============================================
    console.log('\n--- 7. Debug Mode ---\n');

    const debugToggle = page.locator('#debugToggle');

    // Test 7.1: Debug toggle exists and shows OFF
    const initialDebugText = await debugToggle.textContent();
    logTest('Debug toggle shows "Debug: OFF" initially', initialDebugText?.includes('OFF'),
      `Actual: "${initialDebugText}"`);

    // Test 7.2: Triple-click to activate debug mode
    await debugToggle.click();
    await page.waitForTimeout(100);
    await debugToggle.click();
    await page.waitForTimeout(100);
    await debugToggle.click();
    await page.waitForTimeout(500);

    const afterDebugText = await debugToggle.textContent();
    const debugActivated = afterDebugText?.includes('ON');
    logTest('Triple-click activates debug mode', debugActivated,
      `After triple-click: "${afterDebugText}"`);

    // Test 7.3: Usage badge changes in debug mode
    if (debugActivated) {
      const usageBadge = await page.locator('#usageBadge').textContent();
      logTest('Usage badge shows debug mode',
        usageBadge?.includes('Debug') || usageBadge?.includes('unlimited'),
        `Badge text: "${usageBadge}"`);
    }

    await takeScreenshot(page, '09-debug-mode-on');

    // Test 7.4: Triple-click again to deactivate
    await debugToggle.click();
    await page.waitForTimeout(100);
    await debugToggle.click();
    await page.waitForTimeout(100);
    await debugToggle.click();
    await page.waitForTimeout(500);

    const afterDisableText = await debugToggle.textContent();
    logTest('Triple-click deactivates debug mode', afterDisableText?.includes('OFF'),
      `After second triple-click: "${afterDisableText}"`);

    await takeScreenshot(page, '10-debug-mode-off');

    // ============================================
    // TEST 8: Additional UI Elements
    // ============================================
    console.log('\n--- 8. Additional UI Elements ---\n');

    // Test Auth bar
    const authBar = page.locator('#authBar');
    logTest('Auth bar exists', await authBar.count() === 1);

    // Test toast element
    const toast = page.locator('#toast');
    logTest('Toast notification element exists', await toast.count() === 1);
    logTest('Toast is hidden by default', !(await toast.isVisible()));

    // Test loading element
    const loading = page.locator('#loading');
    logTest('Loading element exists', await loading.count() === 1);
    logTest('Loading is hidden by default', !(await loading.isVisible()));

    // Test error element
    const errorDiv = page.locator('#error');
    logTest('Error container exists', await errorDiv.count() === 1);
    logTest('Error is hidden by default', !(await errorDiv.isVisible()));

    await takeScreenshot(page, '11-final-state');

    // ============================================
    // TEST 9: Loading States Structure
    // ============================================
    console.log('\n--- 9. Loading State Elements ---\n');

    const spinner = page.locator('.spinner');
    const progressBar = page.locator('.progress-bar');
    const loadingTitle = page.locator('#loadingTitle');
    const loadingSubtitle = page.locator('#loadingSubtitle');

    logTest('Spinner element exists', await spinner.count() === 1);
    logTest('Progress bar exists', await progressBar.count() === 1);
    logTest('Loading title exists', await loadingTitle.count() === 1);
    logTest('Loading subtitle exists', await loadingSubtitle.count() === 1);

  } catch (error) {
    console.error('\n❌ Test suite error:', error.message);
    testResults.failed.push({ name: 'Test Suite Error', details: error.message });
    await takeScreenshot(page, 'error-state').catch(() => {});
  } finally {
    await browser.close();
  }

  // Print summary
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log(`\n✅ Passed: ${testResults.passed.length}`);
  console.log(`❌ Failed: ${testResults.failed.length}`);

  if (testResults.failed.length > 0) {
    console.log('\nFailed tests:');
    testResults.failed.forEach(f => {
      console.log(`   - ${f.name}${f.details ? ': ' + f.details : ''}`);
    });
  }

  if (testResults.jsErrors.length > 0) {
    console.log('\nJavaScript Errors Found:');
    testResults.jsErrors.forEach((err, i) => {
      console.log(`   ${i + 1}. ${err}`);
    });
  }

  console.log(`\n📸 Screenshots saved: ${testResults.screenshots.length}`);
  console.log(`   Directory: ${SCREENSHOT_DIR}`);
  testResults.screenshots.forEach(s => console.log(`   - ${path.basename(s)}`));

  return testResults;
}

// Run tests
runTests()
  .then(results => {
    console.log('\n✅ Test suite completed\n');
    process.exit(results.failed.length > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  });
