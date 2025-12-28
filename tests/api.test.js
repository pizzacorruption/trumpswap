/**
 * API Endpoint Tests for Pimp My Epstein
 *
 * Tests the REST API endpoints using native fetch.
 * Run with: node tests/api.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 * - At least one Epstein photo must exist in public/epstein-photos
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

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
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    results.push({ name, status: 'FAIL', error: error.message });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
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

function assertIncludes(array, item, message) {
  if (!array.includes(item)) {
    throw new Error(message || `Expected array to include ${item}`);
  }
}

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to exist, got ${value}`);
  }
}

function assertType(value, type, message) {
  if (typeof value !== type) {
    throw new Error(message || `Expected type ${type}, got ${typeof value}`);
  }
}

// ============================================
// API ENDPOINT TESTS
// ============================================

async function runAPITests() {
  console.log('\n=== API Endpoint Tests ===\n');

  // -------------------------------------------
  // Health Check Endpoint Tests
  // -------------------------------------------
  console.log('Health Check (/api/health):');

  await test('returns 200 OK status', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    assertEqual(response.status, 200, 'Expected 200 status');
  });

  await test('returns JSON with status field', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertEqual(data.status, 'ok', 'Expected status to be "ok"');
  });

  await test('includes apiKeySet boolean', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertType(data.apiKeySet, 'boolean', 'Expected apiKeySet to be boolean');
  });

  await test('includes stripeConfigured boolean', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertType(data.stripeConfigured, 'boolean', 'Expected stripeConfigured to be boolean');
  });

  await test('includes supabaseConfigured boolean', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertType(data.supabaseConfigured, 'boolean', 'Expected supabaseConfigured to be boolean');
  });

  await test('includes epsteinPhotosCount number', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertType(data.epsteinPhotosCount, 'number', 'Expected epsteinPhotosCount to be number');
  });

  await test('includes anonymousUsersTracked number', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertType(data.anonymousUsersTracked, 'number', 'Expected anonymousUsersTracked to be number');
  });

  // -------------------------------------------
  // Photos Gallery Endpoint Tests
  // -------------------------------------------
  console.log('\nPhotos Gallery (/api/photos):');

  await test('returns 200 OK status', async () => {
    const response = await fetch(`${BASE_URL}/api/photos`);
    assertEqual(response.status, 200, 'Expected 200 status');
  });

  await test('returns JSON with photos array', async () => {
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();
    assert.ok(Array.isArray(data.photos), 'Expected photos to be an array');
  });

  await test('each photo has required fields', async () => {
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();

    if (data.photos.length > 0) {
      const photo = data.photos[0];
      assertExists(photo.name, 'Photo should have name');
      assertExists(photo.path, 'Photo should have path');
      assertExists(photo.filename, 'Photo should have filename');
    }
  });

  await test('photo paths are valid URL format', async () => {
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();

    if (data.photos.length > 0) {
      const photo = data.photos[0];
      assert.ok(photo.path.startsWith('/epstein-photos/'), 'Photo path should start with /epstein-photos/');
    }
  });

  // -------------------------------------------
  // Config Endpoint Tests
  // -------------------------------------------
  console.log('\nConfig (/api/config):');

  await test('returns 200 OK status', async () => {
    const response = await fetch(`${BASE_URL}/api/config`);
    assertEqual(response.status, 200, 'Expected 200 status');
  });

  await test('returns supabase configuration', async () => {
    const response = await fetch(`${BASE_URL}/api/config`);
    const data = await response.json();
    assertExists(data.supabase, 'Expected supabase object');
    // URL and anonKey may be null if not configured
  });

  await test('returns tiers array', async () => {
    const response = await fetch(`${BASE_URL}/api/config`);
    const data = await response.json();
    assert.ok(Array.isArray(data.tiers), 'Expected tiers to be an array');
  });

  await test('tiers include anonymous, free, and paid', async () => {
    const response = await fetch(`${BASE_URL}/api/config`);
    const data = await response.json();
    const tierIds = data.tiers.map(t => t.id);

    assertIncludes(tierIds, 'anonymous', 'Should include anonymous tier');
    assertIncludes(tierIds, 'free', 'Should include free tier');
    assertIncludes(tierIds, 'paid', 'Should include paid tier');
  });

  await test('each tier has required fields', async () => {
    const response = await fetch(`${BASE_URL}/api/config`);
    const data = await response.json();

    for (const tier of data.tiers) {
      assertExists(tier.id, 'Tier should have id');
      assertExists(tier.name, 'Tier should have name');
      assertExists(tier.limit, 'Tier should have limit');
      assertExists(tier.description, 'Tier should have description');
    }
  });

  // -------------------------------------------
  // Me Endpoint Tests (Anonymous)
  // -------------------------------------------
  console.log('\nMe (/api/me):');

  await test('returns 200 OK for anonymous user', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    assertEqual(response.status, 200, 'Expected 200 status');
  });

  await test('anonymous user has authenticated=false', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    assertEqual(data.authenticated, false, 'Expected authenticated to be false');
  });

  await test('anonymous user has null user object', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    assertEqual(data.user, null, 'Expected user to be null');
  });

  await test('anonymous user has usage object', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    assertExists(data.usage, 'Expected usage object');
    assertExists(data.usage.tier, 'Expected usage.tier');
    assertExists(data.usage.limit, 'Expected usage.limit');
  });

  await test('anonymous user tier is "anonymous"', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    assertEqual(data.usage.tier, 'anonymous', 'Expected tier to be anonymous');
  });

  // -------------------------------------------
  // Error Handling Tests
  // -------------------------------------------
  console.log('\nError Handling:');

  await test('404 for non-existent endpoint', async () => {
    const response = await fetch(`${BASE_URL}/api/nonexistent`);
    assertEqual(response.status, 404, 'Expected 404 status');
  });

  await test('generate endpoint requires userPhoto', async () => {
    const formData = new FormData();
    formData.append('epsteinPhoto', '/epstein-photos/clinton-1993-1.jpg');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    assertEqual(response.status, 400, 'Expected 400 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  await test('generate endpoint requires epsteinPhoto', async () => {
    // Create a minimal valid image blob
    const dummyImageData = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk start
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
      0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82
    ]);

    const formData = new FormData();
    formData.append('userPhoto', new Blob([dummyImageData], { type: 'image/png' }), 'test.png');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    assertEqual(response.status, 400, 'Expected 400 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  // -------------------------------------------
  // Generations Endpoint Tests (Requires Auth)
  // -------------------------------------------
  console.log('\nGenerations (/api/generations):');

  await test('returns 401 for unauthenticated request', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`);
    assertEqual(response.status, 401, 'Expected 401 status');
  });

  await test('returns error message for unauthenticated request', async () => {
    const response = await fetch(`${BASE_URL}/api/generations`);
    const data = await response.json();
    assertExists(data.error, 'Expected error field');
  });

  // -------------------------------------------
  // Generation by ID Tests
  // -------------------------------------------
  console.log('\nGeneration by ID (/api/generation/:id):');

  await test('returns 404 for non-existent generation', async () => {
    const response = await fetch(`${BASE_URL}/api/generation/nonexistent-id-12345`);
    assertEqual(response.status, 404, 'Expected 404 status');
  });

  // -------------------------------------------
  // Subscription Endpoint Tests
  // -------------------------------------------
  console.log('\nSubscription (/api/subscription):');

  await test('returns 400 without userId', async () => {
    const response = await fetch(`${BASE_URL}/api/subscription`);
    assertEqual(response.status, 400, 'Expected 400 status');
    const data = await response.json();
    assertExists(data.error, 'Expected error message');
  });

  // -------------------------------------------
  // Checkout Endpoint Tests
  // -------------------------------------------
  console.log('\nCheckout (/api/create-checkout):');

  await test('returns 400 without required fields', async () => {
    const response = await fetch(`${BASE_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(response.status, 400, 'Expected 400 status');
  });

  await test('returns 400 with invalid email', async () => {
    const response = await fetch(`${BASE_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test-123', email: 'invalid-email' })
    });
    assertEqual(response.status, 400, 'Expected 400 status');
  });

  // -------------------------------------------
  // Cancel Subscription Tests
  // -------------------------------------------
  console.log('\nCancel Subscription (/api/cancel-subscription):');

  await test('returns 400 without customerId', async () => {
    const response = await fetch(`${BASE_URL}/api/cancel-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(response.status, 400, 'Expected 400 status');
  });
}

// ============================================
// RATE LIMITING TESTS
// ============================================

async function runRateLimitTests() {
  console.log('\n=== Rate Limiting Tests ===\n');
  console.log('Rate Limiting Behavior:');

  await test('anonymous users start with 1 generation limit', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    assertEqual(data.usage.tier, 'anonymous', 'Should be anonymous tier');
    assertEqual(data.usage.limit, 1, 'Anonymous limit should be 1');
  });

  await test('usage info is included in responses', async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();
    assertExists(data.usage.used, 'Should have used count');
    assertExists(data.usage.remaining, 'Should have remaining count');
    assertExists(data.usage.canGenerate, 'Should have canGenerate flag');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(50));
  console.log('Pimp My Epstein API Tests');
  console.log('='.repeat(50));
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
  } catch (error) {
    console.error('ERROR: Server is not running or not accessible');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error(`Run: npm run server`);
    console.error('');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Run all test suites
  await runAPITests();
  await runRateLimitTests();

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('Test Summary');
  console.log('='.repeat(50));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
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
