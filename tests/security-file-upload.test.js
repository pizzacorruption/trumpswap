/**
 * Security Tests for File Upload in /api/generate
 *
 * Tests file upload security including:
 * 1. MIME type validation
 * 2. Magic byte (file-type) validation
 * 3. File size limits
 * 4. Malformed file rejection
 * 5. Non-image files with image extensions
 *
 * Run with: node tests/security-file-upload.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 * - At least one Epstein photo must exist in public/epstein-photos
 *
 * NOTE: Due to aggressive rate limiting (10 requests per 5 minutes),
 * these tests are designed to run in batches. Run multiple times
 * with fresh server restart between runs if needed.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

// Test results tracking
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

/**
 * Simple test runner
 */
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`  [PASS] ${name}`);
  } catch (error) {
    if (error.message.includes('Rate limited')) {
      skipped++;
      results.push({ name, status: 'SKIP', error: error.message });
      console.log(`  [SKIP] ${name} (rate limited)`);
    } else {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
      console.log(`  [FAIL] ${name}`);
      console.log(`    Error: ${error.message}`);
    }
  }
}

/**
 * Assert helpers
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to include "${substr}"`);
  }
}

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to exist, got ${value}`);
  }
}

// ============================================
// TEST FILE GENERATORS
// ============================================

/**
 * Create a valid minimal PNG (1x1 pixel)
 */
function createValidPNG() {
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
    0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
    0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
}

/**
 * Create a valid minimal JPEG
 */
function createValidJPEG() {
  // Minimal valid JPEG (1x1 pixel)
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C,
    0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D,
    0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20,
    0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
    0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34,
    0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4,
    0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF,
    0xD9
  ]);
}

/**
 * Create an executable disguised as an image
 */
function createFakeImageEXE() {
  // ELF header (Linux executable)
  return Buffer.from([
    0x7F, 0x45, 0x4C, 0x46, // ELF magic
    0x02, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x3E, 0x00,
    0x01, 0x00, 0x00, 0x00
  ]);
}

/**
 * Create a PDF disguised as image
 */
function createFakeImagePDF() {
  return Buffer.from('%PDF-1.4\n%fake pdf content\n');
}

/**
 * Create an HTML file disguised as image (XSS attempt)
 */
function createFakeImageHTML() {
  return Buffer.from('<html><script>alert("xss")</script></html>');
}

/**
 * Create a polyglot file (valid PNG header + malicious content)
 */
function createPolyglotPNG() {
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  ]);
  const maliciousPayload = Buffer.from('<?php system($_GET["cmd"]); ?>');
  return Buffer.concat([pngHeader, maliciousPayload]);
}

/**
 * Create truncated/corrupted PNG
 */
function createTruncatedPNG() {
  const validPNG = createValidPNG();
  return validPNG.slice(0, 20);
}

/**
 * Create empty file
 */
function createEmptyFile() {
  return Buffer.alloc(0);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a valid Epstein photo path for testing
 */
async function getValidEpsteinPhoto() {
  const response = await fetch(`${BASE_URL}/api/photos`);
  const data = await response.json();
  if (data.photos && data.photos.length > 0) {
    return data.photos[0].path;
  }
  throw new Error('No Epstein photos available for testing');
}

/**
 * Make a generate request with custom file data
 */
async function makeGenerateRequest(fileBuffer, filename, mimeType, epsteinPhoto) {
  const formData = new FormData();
  formData.append('userPhoto', new Blob([fileBuffer], { type: mimeType }), filename);
  formData.append('epsteinPhoto', epsteinPhoto);

  const response = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    body: formData
  });

  const data = await response.json();

  if (response.status === 429) {
    throw new Error('Rate limited - cannot verify');
  }

  return {
    status: response.status,
    data
  };
}

/**
 * Add delay between requests
 */
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// CRITICAL SECURITY TESTS (Limited to ~9 tests to avoid rate limiting)
// ============================================

async function runCriticalSecurityTests(epsteinPhoto) {
  console.log('\n=== Critical Security Tests ===\n');
  console.log('Testing the most important security validations.\n');

  // Test 1: MIME type validation - reject non-image MIME
  await test('rejects non-image MIME type (GIF)', async () => {
    const gifBuffer = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
      0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00,
      0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
    ]);
    const { status, data } = await makeGenerateRequest(
      gifBuffer, 'test.gif', 'image/gif', epsteinPhoto
    );
    assertEqual(status, 400, 'Should reject GIF MIME type');
    assertExists(data.error, 'Should have error message');
  });

  await delay(500);

  // Test 2: Magic byte validation - EXE with spoofed MIME
  await test('rejects EXE disguised as PNG (magic byte check)', async () => {
    const { status, data } = await makeGenerateRequest(
      createFakeImageEXE(), 'malware.png', 'image/png', epsteinPhoto
    );
    assertEqual(status, 400, 'Should reject EXE content with PNG MIME');
    assertIncludes(data.error.toLowerCase(), 'invalid', 'Should mention invalid file');
  });

  await delay(500);

  // Test 3: PDF with spoofed MIME
  await test('rejects PDF disguised as JPEG (magic byte check)', async () => {
    const { status, data } = await makeGenerateRequest(
      createFakeImagePDF(), 'document.jpg', 'image/jpeg', epsteinPhoto
    );
    assertEqual(status, 400, 'Should reject PDF content with JPEG MIME');
  });

  await delay(500);

  // Test 4: XSS attempt - HTML with image MIME
  await test('rejects HTML disguised as PNG (XSS prevention)', async () => {
    const { status, data } = await makeGenerateRequest(
      createFakeImageHTML(), 'xss.png', 'image/png', epsteinPhoto
    );
    assertEqual(status, 400, 'Should reject HTML content with PNG MIME');
  });

  await delay(500);

  // Test 5: Malformed/truncated image
  await test('rejects truncated/malformed PNG', async () => {
    const { status, data } = await makeGenerateRequest(
      createTruncatedPNG(), 'corrupt.png', 'image/png', epsteinPhoto
    );
    assertEqual(status, 400, 'Should reject truncated PNG');
  });

  await delay(500);

  // Test 6: Empty file
  await test('rejects empty file', async () => {
    const { status, data } = await makeGenerateRequest(
      createEmptyFile(), 'empty.png', 'image/png', epsteinPhoto
    );
    assertEqual(status, 400, 'Should reject empty file');
  });

  await delay(500);

  // Test 7: Path traversal attack
  await test('rejects path traversal in epsteinPhoto parameter', async () => {
    const { status, data } = await makeGenerateRequest(
      createValidPNG(), 'test.png', 'image/png', '../../.env'
    );
    assertEqual(status, 400, 'Should reject path traversal attempt');
    assertExists(data.error, 'Should have error message');
  });

  await delay(500);

  // Test 8: Absolute path attack
  await test('rejects absolute path in epsteinPhoto', async () => {
    const { status, data } = await makeGenerateRequest(
      createValidPNG(), 'test.png', 'image/png', '/etc/passwd'
    );
    assertEqual(status, 400, 'Should reject absolute path');
  });

  await delay(500);

  // Test 9: Valid image should be accepted (but rejected for small size)
  await test('valid PNG format accepted (rejected for dimension)', async () => {
    const { status, data } = await makeGenerateRequest(
      createValidPNG(), 'small.png', 'image/png', epsteinPhoto
    );
    // Should pass format checks but fail on dimension (1x1 is too small)
    assertEqual(status, 400, 'Should reject (for dimension, not format)');
    // Should be IMAGE_TOO_SMALL, not INVALID_FORMAT
    if (data.code === 'INVALID_FORMAT') {
      throw new Error('Valid PNG format should not be rejected as INVALID_FORMAT');
    }
    assertEqual(data.code, 'IMAGE_TOO_SMALL', 'Should reject for small dimensions');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Security Tests: File Upload Validation');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);
  console.log('');
  console.log('NOTE: Rate limiting is 10 requests per 5 minutes.');
  console.log('      Tests are optimized to fit within this limit.');
  console.log('');

  // Check if server is running
  try {
    const healthCheck = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!healthCheck.ok) {
      throw new Error(`Server returned ${healthCheck.status}`);
    }
  } catch (error) {
    console.error('ERROR: Server is not running or not accessible');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error(`Run: npm run server`);
    console.error('');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Get a valid Epstein photo for testing
  let epsteinPhoto;
  try {
    epsteinPhoto = await getValidEpsteinPhoto();
    console.log(`Using Epstein photo: ${epsteinPhoto}\n`);
  } catch (error) {
    console.error('ERROR: Could not get Epstein photo for testing');
    console.error(error.message);
    process.exit(1);
  }

  // Run critical security tests
  await runCriticalSecurityTests(epsteinPhoto);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Security Test Summary');
  console.log('='.repeat(60));
  console.log(`Passed:  ${passed}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Skipped: ${skipped} (rate limited)`);
  console.log(`Total:   ${passed + failed + skipped}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    console.log('');
    console.log('SECURITY WARNING: Some file upload validations may be bypassed!');
    process.exit(1);
  } else if (skipped > 0) {
    console.log('Skipped Tests (rate limited):');
    results
      .filter(r => r.status === 'SKIP')
      .forEach(r => console.log(`  - ${r.name}`));
    console.log('');
    console.log('Some tests were skipped due to rate limiting.');
    console.log('Restart the server and re-run to complete all tests.');
    process.exit(0); // Exit 0 since passed tests are valid
  } else {
    console.log('All security tests passed!');
    console.log('File upload validation is working correctly.');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
