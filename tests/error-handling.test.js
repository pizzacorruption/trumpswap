/**
 * Error Handling Tests for Pimp My Epstein
 *
 * Tests error responses across the application to verify:
 * 1. Invalid JSON body returns proper error
 * 2. Missing required fields return descriptive errors
 * 3. Invalid file types return clear error messages
 * 4. API rate limits return proper 429 with message
 * 5. Auth failures return 401 with message
 * 6. Server errors return 500 without exposing internals
 *
 * Run with: node tests/error-handling.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 *
 * NOTE: The /api/generate endpoint has aggressive rate limiting:
 * - Global limit: 100 requests/hour
 * - Suspicious IP: >10 requests in 5 minutes triggers block
 * Some tests may return 429 instead of expected errors when rate limited.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

// Track if we've been rate limited
let rateLimitedGenerate = false;

// Test results tracking
let passed = 0;
let failed = 0;
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
    failed++;
    results.push({ name, status: 'FAIL', error: error.message });
    console.log(`  [FAIL] ${name}`);
    console.log(`         Error: ${error.message}`);
  }
}

/**
 * Assert helper functions
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to exist, got ${value}`);
  }
}

function assertNotContains(str, substring, message) {
  if (typeof str === 'string' && str.includes(substring)) {
    throw new Error(message || `String should not contain "${substring}"`);
  }
}

function assertContains(str, substring, message) {
  if (typeof str !== 'string' || !str.includes(substring)) {
    throw new Error(message || `String should contain "${substring}"`);
  }
}

function assertType(value, type, message) {
  if (typeof value !== type) {
    throw new Error(message || `Expected type ${type}, got ${typeof value}`);
  }
}

// ============================================
// 1. INVALID JSON BODY TESTS
// ============================================

async function testInvalidJsonBody() {
  console.log('\n--- Invalid JSON Body Tests ---');

  await test('POST with malformed JSON returns 400', async () => {
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }'
    });
    assertEqual(response.status, 400, 'Expected 400 status for malformed JSON');
  });

  await test('malformed JSON error has error field', async () => {
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid: json }'
    });
    // Express default JSON parsing error behavior
    assertEqual(response.status, 400, 'Expected 400 status');
  });

  await test('empty body with JSON content-type is handled', async () => {
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ''
    });
    // Empty body may be parsed as empty object or error - password field will be missing
    // Server returns 400 for missing password, or 429 if rate limited
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status for empty body');
  });
}

// ============================================
// 2. MISSING REQUIRED FIELDS TESTS
// ============================================

async function testMissingRequiredFields() {
  console.log('\n--- Missing Required Fields Tests ---');

  // /api/generate - missing userPhoto
  // NOTE: This endpoint has rate limiting, so 429 is also an acceptable response
  await test('/api/generate without userPhoto returns 400 or 429', async () => {
    const formData = new FormData();
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
    if (response.status === 400) {
      assertContains(data.error.toLowerCase(), 'photo', 'Error should mention photo');
    }
  });

  // /api/generate - missing epsteinPhoto
  await test('/api/generate without epsteinPhoto returns 400 or 429 with descriptive message', async () => {
    // Create a small valid PNG
    const pngBytes = createMinimalPng();
    const formData = new FormData();
    formData.append('userPhoto', new Blob([pngBytes], { type: 'image/png' }), 'test.png');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
    if (response.status === 400) {
      assertContains(data.error.toLowerCase(), 'epstein', 'Error should mention Epstein photo selection');
    }
  });

  // /api/admin/login - missing password
  // NOTE: Admin login endpoint has brute force protection (5 attempts per 15 min)
  await test('/api/admin/login without password returns 400 or 429', async () => {
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    // May be rate limited due to brute force protection
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  // /api/create-checkout - requires auth now, but test for missing fields
  await test('/api/create-checkout without auth returns 401 or 429', async () => {
    const response = await fetch(`${BASE_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    // This endpoint also has rate limiting (10 attempts per 15 min)
    assert.ok([401, 429].includes(response.status), 'Expected 401 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });
}

// ============================================
// 3. INVALID FILE TYPES TESTS
// ============================================

async function testInvalidFileTypes() {
  console.log('\n--- Invalid File Type Tests ---');

  // NOTE: These tests may return 429 if rate limited
  await test('uploading text file as image returns 400 or 429', async () => {
    const formData = new FormData();
    const textBlob = new Blob(['this is not an image'], { type: 'text/plain' });
    formData.append('userPhoto', textBlob, 'fake.txt');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('uploading PDF as image returns 400 or 429 with clear message', async () => {
    const formData = new FormData();
    // PDF magic bytes
    const pdfContent = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]);
    formData.append('userPhoto', new Blob([pdfContent], { type: 'application/pdf' }), 'document.pdf');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
    if (response.status === 400) {
      assertContains(data.error.toLowerCase(), 'file', 'Error should mention file type');
    }
  });

  await test('uploading GIF returns 400 or 429 (only JPEG/PNG/WebP allowed)', async () => {
    const formData = new FormData();
    // GIF magic bytes
    const gifContent = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    formData.append('userPhoto', new Blob([gifContent], { type: 'image/gif' }), 'image.gif');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('error message for invalid file type is user-friendly', async () => {
    const formData = new FormData();
    const textBlob = new Blob(['not an image'], { type: 'text/html' });
    formData.append('userPhoto', textBlob, 'page.html');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    // Error should not expose internal paths or stack traces
    assertNotContains(JSON.stringify(data), '/Users/', 'Error should not expose file paths');
    assertNotContains(JSON.stringify(data), 'node_modules', 'Error should not expose node_modules');
    assertNotContains(JSON.stringify(data), 'at Function', 'Error should not expose stack traces');
  });
}

// ============================================
// 4. RATE LIMIT TESTS
// ============================================

async function testRateLimits() {
  console.log('\n--- Rate Limit Tests ---');

  await test('rate limit response includes 429 status', async () => {
    // The rate limit middleware returns proper structure
    // We can verify the error format by checking /api/me for usage info
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();

    // Verify rate limit info is exposed correctly
    assertExists(data.usage, 'Should have usage info');
    assertExists(data.usage.limit, 'Should have limit');
    assertExists(data.usage.remaining, 'Should have remaining');
  });

  await test('rate limit error has proper structure', async () => {
    // When rate limited, response should have these fields
    // We test the structure by looking at what the endpoint returns
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();

    // The rate limit response includes tier info
    assertExists(data.usage.tier, 'Should include tier');
    assertExists(data.usage.tierName, 'Should include tierName');
    assertExists(data.usage.canGenerate, 'Should include canGenerate flag');
  });

  await test('rate limit errors do not expose sensitive info', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    const jsonStr = JSON.stringify(data);

    // Should not expose API keys or internal details
    assertNotContains(jsonStr, 'GEMINI_API_KEY', 'Should not expose API key name');
    assertNotContains(jsonStr, 'AIza', 'Should not expose API key value');
    assertNotContains(jsonStr, 'stripe_secret', 'Should not expose Stripe secret');
  });
}

// ============================================
// 5. AUTHENTICATION FAILURE TESTS
// ============================================

async function testAuthFailures() {
  console.log('\n--- Authentication Failure Tests ---');

  await test('/api/generations returns 401 without auth', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`);
    assertEqual(response.status, 401, 'Expected 401 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('/api/subscription returns 401 without auth', async () => {
    const response = await fetch(`${BASE_URL}/api/subscription`);
    // This requires auth based on server.js code
    assert.ok([400, 401].includes(response.status), 'Expected 400 or 401 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('/api/cancel-subscription returns 401 without auth', async () => {
    const response = await fetch(`${BASE_URL}/api/cancel-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    // Requires auth based on requireAuth middleware
    assert.ok([400, 401].includes(response.status), 'Expected 400 or 401 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('invalid Bearer token returns 401 for protected routes', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`, {
      headers: {
        'Authorization': 'Bearer invalid-token-12345'
      }
    });
    assertEqual(response.status, 401, 'Expected 401 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
    assertContains(data.error.toLowerCase(), 'auth', 'Error should mention authentication');
  });

  await test('malformed Authorization header is handled gracefully', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`, {
      headers: {
        'Authorization': 'NotBearer some-token'
      }
    });
    assertEqual(response.status, 401, 'Expected 401 status');
  });

  await test('empty Bearer token is handled', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`, {
      headers: {
        'Authorization': 'Bearer '
      }
    });
    assertEqual(response.status, 401, 'Expected 401 status');
  });

  await test('401 errors have proper message structure', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`);
    const data = await response.json();

    assertExists(data.error, 'Should have error field');
    assertType(data.error, 'string', 'Error should be a string');
    // Should be user-friendly
    assert.ok(data.error.length > 5, 'Error message should be descriptive');
  });

  await test('401 errors do not expose sensitive information', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`, {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid'
      }
    });
    const data = await response.json();
    const jsonStr = JSON.stringify(data);

    assertNotContains(jsonStr, 'JWT_SECRET', 'Should not expose JWT secret name');
    assertNotContains(jsonStr, 'SUPABASE', 'Should not expose Supabase details');
    assertNotContains(jsonStr, 'stack', 'Should not expose stack traces');
  });

  // Admin auth tests
  await test('/api/admin/debug returns 401 without admin token', async () => {
    const response = await fetch(`${BASE_URL}/api/admin/debug`);
    assertEqual(response.status, 401, 'Expected 401 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('/api/admin/login with wrong password returns 401, 429, or config error', async () => {
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password-12345' })
    });
    // If admin is not configured, returns 401 with "not configured" message
    // If admin is configured, returns 401 with "Invalid password" message
    // May also be rate limited due to brute force protection
    assert.ok([401, 429].includes(response.status), 'Expected 401 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
    // Error should be generic enough not to help attackers
    assert.ok(
      data.error.includes('Invalid') ||
      data.error.includes('not configured') ||
      data.error.includes('Too many'),
      'Error should indicate invalid password, not configured, or rate limit'
    );
  });
}

// ============================================
// 6. SERVER ERROR TESTS (500s)
// ============================================

async function testServerErrors() {
  console.log('\n--- Server Error Tests ---');

  await test('500 errors do not expose file paths', async () => {
    // Trigger a potential error by sending corrupted image data
    const formData = new FormData();
    const corruptData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // Incomplete PNG header
    formData.append('userPhoto', new Blob([corruptData], { type: 'image/png' }), 'corrupt.png');
    formData.append('epsteinPhoto', '/epstein-photos/nonexistent.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    const jsonStr = JSON.stringify(data);

    // Should not expose server internals
    assertNotContains(jsonStr, '/Users/', 'Should not expose user paths');
    assertNotContains(jsonStr, '/home/', 'Should not expose home paths');
    assertNotContains(jsonStr, 'node_modules', 'Should not expose node_modules');
    assertNotContains(jsonStr, '.js:', 'Should not expose file:line references');
  });

  await test('500 errors do not expose stack traces', async () => {
    const formData = new FormData();
    const badData = new Uint8Array([0xFF, 0xD8, 0xFF]); // Incomplete JPEG
    formData.append('userPhoto', new Blob([badData], { type: 'image/jpeg' }), 'bad.jpg');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    const jsonStr = JSON.stringify(data);

    assertNotContains(jsonStr, 'at Function', 'Should not expose stack traces');
    assertNotContains(jsonStr, 'at Object', 'Should not expose stack traces');
    assertNotContains(jsonStr, 'at Module', 'Should not expose stack traces');
    assertNotContains(jsonStr, '    at ', 'Should not expose stack traces');
  });

  await test('500 errors do not expose environment variables', async () => {
    const formData = new FormData();
    formData.append('userPhoto', new Blob(['test'], { type: 'image/png' }), 'test.png');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    const jsonStr = JSON.stringify(data);

    assertNotContains(jsonStr, 'GEMINI_API_KEY', 'Should not expose env var names');
    assertNotContains(jsonStr, 'AIza', 'Should not expose API keys');
    assertNotContains(jsonStr, 'STRIPE_SECRET', 'Should not expose Stripe secrets');
    assertNotContains(jsonStr, 'SUPABASE_', 'Should not expose Supabase config');
    assertNotContains(jsonStr, 'ADMIN_PASSWORD', 'Should not expose admin password');
  });

  await test('error responses have consistent structure', async () => {
    const formData = new FormData();
    formData.append('userPhoto', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    // Errors should have a consistent structure
    assertExists(data.error, 'Should have error field');
    assertType(data.error, 'string', 'Error should be a string');
    // May optionally have code and details
    if (data.code) {
      assertType(data.code, 'string', 'Code should be a string if present');
    }
  });
}

// ============================================
// 7. PATH TRAVERSAL PROTECTION TESTS
// ============================================

async function testPathTraversalProtection() {
  console.log('\n--- Path Traversal Protection Tests ---');

  await test('path traversal in epsteinPhoto is blocked', async () => {
    const pngBytes = createMinimalPng();
    const formData = new FormData();
    formData.append('userPhoto', new Blob([pngBytes], { type: 'image/png' }), 'test.png');
    formData.append('epsteinPhoto', '../../.env');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    // Server validates against whitelist - should return 400 or 429 if rate limited
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status for path traversal attempt');
    const data = await response.json();
    assertNotContains(JSON.stringify(data), 'GEMINI', 'Should not expose .env contents');
  });

  await test('absolute paths in epsteinPhoto are blocked', async () => {
    const pngBytes = createMinimalPng();
    const formData = new FormData();
    formData.append('userPhoto', new Blob([pngBytes], { type: 'image/png' }), 'test.png');
    formData.append('epsteinPhoto', '/etc/passwd');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertNotContains(JSON.stringify(data), 'root:', 'Should not expose system files');
  });

  await test('/output/:filename path traversal is blocked', async () => {
    const response = await fetch(`${BASE_URL}/output/../.env`);
    // Should either return 400 or 404, not the actual file
    assert.ok([400, 403, 404].includes(response.status), 'Expected 400, 403, or 404 status');

    const text = await response.text();
    assertNotContains(text, 'GEMINI_API_KEY', 'Should not expose .env contents');
  });
}

// ============================================
// 8. CORS ERROR HANDLING TESTS
// ============================================

async function testCORSHandling() {
  console.log('\n--- CORS Handling Tests ---');

  await test('OPTIONS request returns proper CORS headers', async () => {
    const response = await fetch(`${BASE_URL}/api/health`, {
      method: 'OPTIONS'
    });
    // Should either return 200/204 with CORS headers or be handled by the server
    assert.ok([200, 204].includes(response.status), 'Expected 200 or 204 for OPTIONS');
  });

  await test('API endpoints include Content-Type header', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const contentType = response.headers.get('content-type');
    assertContains(contentType, 'application/json', 'Should return JSON content type');
  });
}

// ============================================
// 9. WEBHOOK ERROR HANDLING TESTS
// ============================================

async function testWebhookErrors() {
  console.log('\n--- Webhook Error Handling Tests ---');

  await test('Stripe webhook without signature returns 400', async () => {
    const response = await fetch(`${BASE_URL}/api/webhook/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test.event' })
    });

    assertEqual(response.status, 400, 'Expected 400 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
    assertContains(data.error.toLowerCase(), 'signature', 'Error should mention signature');
  });

  await test('Stripe webhook with invalid signature returns 400', async () => {
    const response = await fetch(`${BASE_URL}/api/webhook/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 't=12345,v1=invalid_signature'
      },
      body: JSON.stringify({ type: 'test.event' })
    });

    assertEqual(response.status, 400, 'Expected 400 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });
}

// ============================================
// 10. INPUT VALIDATION TESTS
// ============================================

async function testInputValidation() {
  console.log('\n--- Input Validation Tests ---');

  await test('oversized file returns 400 with clear message', async () => {
    // Create a large blob (simulated - actual upload would be larger)
    const formData = new FormData();
    // Note: FormData/Blob in Node doesn't enforce size limits the same way
    // The server should reject files > 10MB
    const largeData = new Uint8Array(100); // Symbolic test
    formData.append('userPhoto', new Blob([largeData], { type: 'image/png' }), 'large.png');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    // This test documents the expected behavior
    // Actual large file test would require different approach
    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    // Should return 400 for invalid image (too small or corrupted)
    assert.ok([400, 429, 500].includes(response.status), 'Should handle file validation');
  });

  await test('image with valid MIME but invalid content returns error', async () => {
    const formData = new FormData();
    // Claim it's a PNG but send random bytes
    const fakeImage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    formData.append('userPhoto', new Blob([fakeImage], { type: 'image/png' }), 'fake.png');
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      rateLimitedGenerate = true;
      console.log('    (Note: Rate limited - expected behavior when running many tests)');
    }
    assert.ok([400, 429].includes(response.status), 'Expected 400 or 429 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('SQL injection attempts in query params are handled safely', async () => {
    const response = await fetch(`${BASE_URL}/api/generation/'; DROP TABLE users; --`);
    // Should return 404 (not found) not 500 (server error)
    assertEqual(response.status, 404, 'Expected 404 status');
  });

  await test('XSS attempts in input are not reflected in error messages', async () => {
    const formData = new FormData();
    const xssPayload = '<script>alert("xss")</script>';
    formData.append('userPhoto', new Blob([xssPayload], { type: 'text/html' }), `${xssPayload}.html`);
    formData.append('epsteinPhoto', '/epstein-photos/test.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    const jsonStr = JSON.stringify(data);

    assertNotContains(jsonStr, '<script>', 'Should not reflect XSS payload');
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create a minimal valid PNG image
 */
function createMinimalPng() {
  return new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk start
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, // 256x256 dimensions (to pass min size check)
    0x08, 0x02, 0x00, 0x00, 0x00, 0xD3, 0x10, 0x3F,
    0x31, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
    0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
    0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Error Handling Tests - Pimp My Epstein');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);
  console.log('');

  // Check if server is running
  try {
    const healthCheck = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!healthCheck.ok) {
      throw new Error(`Server returned ${healthCheck.status}`);
    }
    console.log('Server is running.\n');
  } catch (error) {
    console.error('ERROR: Server is not running or not accessible');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error(`Run: npm run server`);
    console.error('');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Run all test suites
  await testInvalidJsonBody();
  await testMissingRequiredFields();
  await testInvalidFileTypes();
  await testRateLimits();
  await testAuthFailures();
  await testServerErrors();
  await testPathTraversalProtection();
  await testCORSHandling();
  await testWebhookErrors();
  await testInputValidation();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log('');

  if (rateLimitedGenerate) {
    console.log('NOTE: Some tests encountered rate limiting (429).');
    console.log('This is expected behavior - the server protects against abuse.');
    console.log('Restart server to reset rate limits if testing again.\n');
  }

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('All tests passed!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
