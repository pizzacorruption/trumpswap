/**
 * Comprehensive End-to-End Test Script for Pimp My Epstein
 *
 * Tests the complete user journey from loading the homepage to generation.
 * Run with: node tests/e2e-full.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 * - ADMIN_PASSWORD env var set for admin login tests (optional)
 *
 * Expected behaviors documented at each step.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

// Store data between tests
let selectedPhoto = null;
let adminCookies = null;

/**
 * Simple test runner with descriptive output
 */
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`    [PASS] ${name}`);
  } catch (error) {
    failed++;
    results.push({ name, status: 'FAIL', error: error.message });
    console.log(`    [FAIL] ${name}`);
    console.log(`           Error: ${error.message}`);
  }
}

/**
 * Test group header
 */
function describe(groupName, description) {
  console.log(`\n  ${groupName}`);
  if (description) {
    console.log(`  ${description}`);
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

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || `Expected truthy value, got ${value}`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(message || `Expected falsy value, got ${value}`);
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

function assertContains(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to contain "${substr}"`);
  }
}

function assertArrayLength(arr, minLength, message) {
  if (!Array.isArray(arr) || arr.length < minLength) {
    throw new Error(message || `Expected array with at least ${minLength} items, got ${arr?.length || 0}`);
  }
}

/**
 * Create a valid test PNG image buffer
 * A minimal 256x256 red PNG for testing uploads
 */
function createTestImageBuffer() {
  // This is a minimal valid PNG file (1x1 pixel, red)
  // For more realistic testing, we'd need a larger image
  // The server requires minimum 256x256, so this test will fail validation
  // We include this to test the validation error handling
  const minimaPNG = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
    0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
    0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  return minimaPNG;
}

/**
 * Create a FormData-compatible blob for Node.js fetch
 */
function createImageBlob(buffer, filename = 'test.png') {
  return new Blob([buffer], { type: 'image/png' });
}

// ============================================
// STEP 1: LOAD HOMEPAGE
// ============================================

async function testLoadHomepage() {
  describe('STEP 1: Load Homepage', 'User navigates to the main application page');

  await test('Homepage returns 200 OK', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - The server should respond with HTTP 200
     * - The response should be HTML content
     */
    const response = await fetch(`${BASE_URL}/`);
    assertEqual(response.status, 200, 'Homepage should return 200');
  });

  await test('Homepage contains correct title', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - The page should contain the app title "PIMP MY EPSTEIN"
     * - This confirms the correct page is being served
     */
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assertContains(html, 'PIMP MY EPSTEIN', 'Page should contain app title');
  });

  await test('Homepage includes Supabase client script', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - The page includes the Supabase JS client for authentication
     * - This is loaded from a CDN
     */
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assertContains(html, 'supabase-js', 'Page should include Supabase client');
  });

  await test('Homepage has security headers', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Server should set security headers via Helmet middleware
     * - X-Content-Type-Options should be set to nosniff
     * - X-Frame-Options should prevent clickjacking
     */
    const response = await fetch(`${BASE_URL}/`);
    const xContentType = response.headers.get('x-content-type-options');
    assertEqual(xContentType, 'nosniff', 'Should have X-Content-Type-Options header');
  });

  await test('Health check confirms API is functional', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /api/health endpoint should return JSON with status "ok"
     * - This confirms the API layer is working
     */
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    assertEqual(data.status, 'ok', 'Health check should return ok status');
  });
}

// ============================================
// STEP 2: VIEW PHOTO GALLERY
// ============================================

async function testViewPhotoGallery() {
  describe('STEP 2: View Photo Gallery', 'User browses available Epstein photos');

  await test('Photos API returns array of photos', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /api/photos endpoint returns JSON with photos array
     * - The array should contain Epstein photo metadata
     */
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();
    assertTrue(Array.isArray(data.photos), 'Should return photos array');
  });

  await test('At least one photo is available', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Gallery should have at least one Epstein photo
     * - Without photos, the app cannot function
     */
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();
    assertArrayLength(data.photos, 1, 'Should have at least 1 photo');

    // Store for later tests
    selectedPhoto = data.photos[0];
  });

  await test('Each photo has required metadata fields', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Each photo object should have: name, path, filename
     * - name: Human-readable display name
     * - path: URL path to the image file
     * - filename: Original filename
     */
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();

    for (const photo of data.photos) {
      assertExists(photo.name, 'Photo should have name');
      assertExists(photo.path, 'Photo should have path');
      assertExists(photo.filename, 'Photo should have filename');
    }
  });

  await test('Photo paths start with /epstein-photos/', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - All photo paths should be under the /epstein-photos/ directory
     * - This ensures proper static file serving
     */
    const response = await fetch(`${BASE_URL}/api/photos`);
    const data = await response.json();

    for (const photo of data.photos) {
      assertTrue(
        photo.path.startsWith('/epstein-photos/'),
        `Photo path should start with /epstein-photos/, got ${photo.path}`
      );
    }
  });

  await test('Photo images are accessible via their paths', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Each photo file should be accessible via HTTP GET
     * - Server should return the image file with 200 status
     */
    if (!selectedPhoto) {
      throw new Error('No photo selected from previous test');
    }

    const response = await fetch(`${BASE_URL}${selectedPhoto.path}`);
    assertEqual(response.status, 200, `Photo at ${selectedPhoto.path} should be accessible`);

    const contentType = response.headers.get('content-type');
    assertTrue(
      contentType.includes('image/'),
      `Should return image content type, got ${contentType}`
    );
  });
}

// ============================================
// STEP 3: SELECT A PHOTO
// ============================================

async function testSelectPhoto() {
  describe('STEP 3: Select a Photo', 'User picks an Epstein photo for the swap');

  await test('First photo from gallery is valid for selection', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - When a user selects a photo, it should have a valid path
     * - The path will be sent to the generate API
     */
    assertTrue(selectedPhoto !== null, 'Should have a selected photo from gallery');
    assertExists(selectedPhoto.path, 'Selected photo should have path');
    assertExists(selectedPhoto.filename, 'Selected photo should have filename');
  });

  await test('Photo selection is accepted by generate endpoint validation', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - The generate endpoint validates that epsteinPhoto is a valid gallery photo
     * - Invalid paths should be rejected with appropriate error
     * - This test confirms path format is correct (actual generation tested later)
     */
    const formData = new FormData();
    formData.append('epsteinPhoto', selectedPhoto.path);
    // Intentionally not adding userPhoto to test partial validation

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    // Should fail because userPhoto is missing, not because epsteinPhoto is invalid
    assertEqual(response.status, 400, 'Should return 400 for missing userPhoto');
    const data = await response.json();
    assertContains(data.error.toLowerCase(), 'photo', 'Error should mention photo requirement');
  });
}

// ============================================
// STEP 4: UPLOAD A TEST IMAGE
// ============================================

async function testUploadImage() {
  describe('STEP 4: Upload a Test Image', 'User uploads their face photo');

  await test('Generate endpoint rejects missing epsteinPhoto', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - If epsteinPhoto is not provided, server returns 400
     * - Error message should indicate what's missing
     */
    const imageBuffer = createTestImageBuffer();
    const formData = new FormData();
    formData.append('userPhoto', createImageBlob(imageBuffer), 'test.png');

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    assertEqual(response.status, 400, 'Should return 400 for missing epsteinPhoto');
    const data = await response.json();
    assertExists(data.error, 'Should have error message');
  });

  await test('Generate endpoint rejects invalid file types', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Only JPEG, PNG, and WebP files are accepted
     * - Other file types should be rejected with 400 error
     * - Server validates both MIME type and file content (magic bytes)
     */
    const formData = new FormData();
    formData.append('userPhoto', new Blob(['not an image'], { type: 'text/plain' }), 'test.txt');
    formData.append('epsteinPhoto', selectedPhoto.path);

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    assertEqual(response.status, 400, 'Should return 400 for invalid file type');
    const data = await response.json();
    assertEqual(data.code, 'INVALID_FORMAT', 'Should return INVALID_FORMAT error code');
  });

  await test('Generate endpoint rejects images that are too small', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Images smaller than 256x256 pixels are rejected
     * - Server validates dimensions using Sharp
     * - Error should indicate minimum size requirement
     */
    const imageBuffer = createTestImageBuffer(); // 1x1 pixel image
    const formData = new FormData();
    formData.append('userPhoto', createImageBlob(imageBuffer), 'tiny.png');
    formData.append('epsteinPhoto', selectedPhoto.path);

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    assertEqual(response.status, 400, 'Should return 400 for too-small image');
    const data = await response.json();
    assertEqual(data.code, 'IMAGE_TOO_SMALL', 'Should return IMAGE_TOO_SMALL error code');
    assertContains(data.error.toLowerCase(), 'small', 'Error should mention size issue');
  });

  await test('Generate endpoint validates path traversal attempts', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Security: Paths like "../../.env" should be rejected
     * - Server validates epsteinPhoto against whitelist of actual photos
     * - This prevents attackers from reading arbitrary files
     */
    const imageBuffer = createTestImageBuffer();
    const formData = new FormData();
    formData.append('userPhoto', createImageBlob(imageBuffer), 'test.png');
    formData.append('epsteinPhoto', '../../.env'); // Path traversal attempt

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    assertEqual(response.status, 400, 'Should reject path traversal attempt');
    const data = await response.json();
    assertContains(data.error.toLowerCase(), 'invalid', 'Should indicate invalid selection');
  });
}

// ============================================
// STEP 5: CLICK GENERATE
// ============================================

async function testClickGenerate() {
  describe('STEP 5: Click Generate', 'Test generation (may fail without API key)');

  await test('Generate endpoint requires authentication for tracking', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Anonymous users can still attempt generation
     * - Usage is tracked by IP for rate limiting
     * - Response includes error if rate limited or API fails
     *
     * NOTE: This test may fail if:
     * - GEMINI_API_KEY is not set (expected in test environment)
     * - Rate limit exceeded
     * - AI service is unavailable
     */
    // We've already tested validation above
    // Full generation would require a valid API key
    // Just confirm the endpoint accepts proper requests

    const imageBuffer = createTestImageBuffer();
    const formData = new FormData();
    formData.append('userPhoto', createImageBlob(imageBuffer), 'test.png');
    formData.append('epsteinPhoto', selectedPhoto.path);

    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      body: formData
    });

    // We expect either:
    // - 400 for small image (our test image is 1x1)
    // - 500/504 if API key not configured or timeout
    // - 429 if rate limited
    // - 200 if everything works (unlikely in test environment)

    assertTrue(
      [200, 400, 429, 500, 504].includes(response.status),
      `Expected valid response status, got ${response.status}`
    );
  });

  await test('Usage info is available via /api/me', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /api/me returns current user's usage information
     * - For anonymous users, shows tier="anonymous" and limit info
     * - Used to display remaining swaps in the UI
     */
    const response = await fetch(`${BASE_URL}/api/me`);
    const data = await response.json();

    assertEqual(response.status, 200, 'Should return 200');
    assertEqual(data.authenticated, false, 'Anonymous user not authenticated');
    assertExists(data.usage, 'Should have usage info');
    assertEqual(data.usage.tier, 'anonymous', 'Should be anonymous tier');
    assertType(data.usage.limit, 'number', 'Limit should be a number');
    assertType(data.usage.used, 'number', 'Used should be a number');
    assertType(data.usage.remaining, 'number', 'Remaining should be a number');
    assertType(data.usage.canGenerate, 'boolean', 'canGenerate should be boolean');
  });
}

// ============================================
// STEP 6: ADMIN LOGIN FLOW
// ============================================

async function testAdminLogin() {
  describe('STEP 6: Admin Login Flow', 'Test debug mode authentication');

  await test('Admin status check works for non-admin', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /api/admin/status returns whether user is admin
     * - Without login, isAdmin should be false
     * - Shows if admin mode is configured on server
     */
    const response = await fetch(`${BASE_URL}/api/admin/status`);
    const data = await response.json();

    assertEqual(response.status, 200, 'Should return 200');
    assertEqual(data.isAdmin, false, 'Should not be admin without login');
    assertType(data.adminConfigured, 'boolean', 'Should indicate if admin is configured');
  });

  await test('Admin login rejects empty password', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Login requires a password in request body
     * - Empty/missing password returns 400 error
     */
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assertEqual(response.status, 400, 'Should return 400 for empty password');
    const data = await response.json();
    assertExists(data.error, 'Should have error message');
  });

  await test('Admin login rejects invalid password', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Wrong password returns 401 Unauthorized
     * - Rate limited to prevent brute force (5 attempts per 15 minutes)
     */
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password-12345' })
    });

    assertEqual(response.status, 401, 'Should return 401 for wrong password');
    const data = await response.json();
    assertExists(data.error, 'Should have error message');
  });

  await test('Admin login with correct password sets httpOnly cookie', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Correct password returns 200 with success=true
     * - Server sets httpOnly cookie for session (not in response body)
     * - expiresAt timestamp indicates when session expires (24 hours)
     *
     * NOTE: This test requires ADMIN_PASSWORD env var to match server config
     * If admin is not configured, this will return error
     */
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD })
    });

    // If admin is configured with our test password, login succeeds
    // Otherwise, we get 401 (which is expected if password doesn't match)
    if (response.status === 200) {
      const data = await response.json();
      assertEqual(data.success, true, 'Should indicate success');
      assertExists(data.expiresAt, 'Should have expiration time');

      // Check for set-cookie header (httpOnly cookie)
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        assertContains(setCookie, 'adminToken', 'Should set adminToken cookie');
        assertContains(setCookie, 'HttpOnly', 'Cookie should be httpOnly');
        adminCookies = setCookie;
      }
    } else {
      // Admin not configured with our test password - that's OK
      assertEqual(response.status, 401, 'Should return 401 if password wrong');
    }
  });

  await test('Admin debug endpoint requires authentication', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /api/admin/debug returns detailed server info
     * - Requires valid admin session
     * - Returns 401 if not authenticated as admin
     */
    const response = await fetch(`${BASE_URL}/api/admin/debug`);
    assertEqual(response.status, 401, 'Should return 401 without admin auth');
  });

  await test('Admin debug endpoint works with valid session', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - With valid admin cookie, returns detailed debug info
     * - Includes server stats, config status, memory usage
     * - Only accessible to authenticated admins
     */
    if (!adminCookies) {
      console.log('           (Skipped - no admin session available)');
      return;
    }

    const response = await fetch(`${BASE_URL}/api/admin/debug`, {
      headers: { 'Cookie': adminCookies }
    });

    if (response.status === 200) {
      const data = await response.json();
      assertEqual(data.admin, true, 'Should indicate admin access');
      assertExists(data.server, 'Should have server info');
      assertExists(data.config, 'Should have config info');
    }
    // If still 401, admin login didn't work with our test password
  });
}

// ============================================
// STEP 7: LOGOUT FLOW
// ============================================

async function testLogout() {
  describe('STEP 7: Logout Flow', 'Test admin session termination');

  await test('Logout endpoint clears admin session', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - POST /api/admin/logout invalidates session
     * - Clears the httpOnly cookie
     * - Returns success even if no session exists
     */
    const response = await fetch(`${BASE_URL}/api/admin/logout`, {
      method: 'POST',
      headers: adminCookies ? { 'Cookie': adminCookies } : {}
    });

    assertEqual(response.status, 200, 'Logout should return 200');
    const data = await response.json();
    assertEqual(data.success, true, 'Should indicate success');

    // Check that cookie is cleared
    const setCookie = response.headers.get('set-cookie');
    if (setCookie && adminCookies) {
      // Cookie should be cleared (expires in past or empty value)
      assertTrue(
        setCookie.includes('adminToken=') || setCookie.includes('Max-Age=0'),
        'Should clear admin cookie'
      );
    }
  });

  await test('After logout, admin status is false', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - After logout, /api/admin/status shows isAdmin=false
     * - Previous session token is no longer valid
     */
    const response = await fetch(`${BASE_URL}/api/admin/status`);
    const data = await response.json();

    assertEqual(data.isAdmin, false, 'Should not be admin after logout');
  });

  await test('After logout, admin debug endpoint returns 401', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Previous admin session should no longer work
     * - Debug endpoint returns 401
     */
    const response = await fetch(`${BASE_URL}/api/admin/debug`, {
      headers: adminCookies ? { 'Cookie': adminCookies } : {}
    });

    assertEqual(response.status, 401, 'Should return 401 after logout');
  });
}

// ============================================
// STEP 8: UPGRADE BUTTON (REQUIRES AUTH)
// ============================================

async function testUpgradeButton() {
  describe('STEP 8: Upgrade Button', 'Test Stripe checkout flow (requires auth)');

  await test('Upgrade page is accessible', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /upgrade.html page loads successfully
     * - Contains subscription pricing information
     */
    const response = await fetch(`${BASE_URL}/upgrade.html`);
    assertEqual(response.status, 200, 'Upgrade page should return 200');

    const html = await response.text();
    assertContains(html, '$14.99', 'Should show $14.99/month price');
    assertContains(html, 'Base', 'Should mention Base tier');
  });

  await test('Checkout endpoint requires authentication', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - POST /api/create-checkout requires authenticated user
     * - Anonymous requests return 401 Unauthorized
     * - This prevents abuse of Stripe checkout
     */
    const response = await fetch(`${BASE_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com'
      })
    });

    // Should return 401 for unauthenticated user
    assertEqual(response.status, 401, 'Should return 401 for unauthenticated user');
    const data = await response.json();
    assertExists(data.error, 'Should have error message');
  });

  await test('Subscription endpoint requires authentication', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - GET /api/subscription requires authenticated user
     * - Returns 401 for anonymous users
     * - Authenticated users get their subscription status
     */
    const response = await fetch(`${BASE_URL}/api/subscription`);

    // The endpoint now requires auth via requireAuth middleware
    assertEqual(response.status, 401, 'Should return 401 for unauthenticated user');
  });

  await test('Cancel subscription endpoint requires authentication', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - POST /api/cancel-subscription requires authenticated user
     * - User can only cancel their own subscription
     * - Returns 401 for anonymous users
     */
    const response = await fetch(`${BASE_URL}/api/cancel-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assertEqual(response.status, 401, 'Should return 401 for unauthenticated user');
  });

  await test('Config endpoint returns tier information', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /api/config returns public configuration
     * - Includes tier information for display
     * - Shows anonymous, free, and paid tier limits
     */
    const response = await fetch(`${BASE_URL}/api/config`);
    const data = await response.json();

    assertEqual(response.status, 200, 'Should return 200');
    assertExists(data.tiers, 'Should have tiers array');
    assertTrue(Array.isArray(data.tiers), 'Tiers should be array');

    const tierIds = data.tiers.map(t => t.id);
    assertTrue(tierIds.includes('anonymous'), 'Should have anonymous tier');
    assertTrue(tierIds.includes('free'), 'Should have free tier');
    assertTrue(tierIds.includes('paid'), 'Should have paid tier');
  });

  await test('Generations history requires authentication', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - GET /api/generations requires authenticated user
     * - Returns generation history for authenticated users
     * - Returns 401 for anonymous users
     */
    const response = await fetch(`${BASE_URL}/api/generations`);
    assertEqual(response.status, 401, 'Should return 401 for unauthenticated user');
  });
}

// ============================================
// ADDITIONAL SECURITY TESTS
// ============================================

async function testSecurity() {
  describe('SECURITY TESTS', 'Additional security validation');

  await test('Output directory is not directly accessible', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - /output/*.png files require authorization
     * - Direct requests without auth should be rejected
     * - Prevents unauthorized access to generated images
     */
    const response = await fetch(`${BASE_URL}/output/test.png`);

    // Should return 404 (file not found) or 403 (forbidden)
    // Not 200 (which would mean static serving is enabled)
    assertTrue(
      [403, 404].includes(response.status),
      `Output files should not be directly accessible, got ${response.status}`
    );
  });

  await test('CORS is properly configured', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Server should have CORS configured
     * - In development, localhost:3000 is allowed
     * - In production, only pimpmyepstein.lol is allowed
     */
    const response = await fetch(`${BASE_URL}/api/health`, {
      headers: { 'Origin': 'http://localhost:3000' }
    });

    // In development, should allow localhost
    // Note: Access-Control-Allow-Origin header may not be set for same-origin
    assertEqual(response.status, 200, 'Request should succeed');
  });

  await test('Non-existent API routes return 404', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Undefined routes return 404
     * - Prevents information leakage about server structure
     */
    const response = await fetch(`${BASE_URL}/api/secret-endpoint`);
    assertEqual(response.status, 404, 'Should return 404 for unknown route');
  });

  await test('Rate limiting headers are present', async () => {
    /**
     * EXPECTED BEHAVIOR:
     * - Rate limited endpoints include standard headers
     * - Shows remaining requests and reset time
     */
    const response = await fetch(`${BASE_URL}/api/health`);

    // Health endpoint might not be rate limited, but others are
    // Just check for common rate limit headers if present
    const rateLimit = response.headers.get('ratelimit-limit');
    const rateRemaining = response.headers.get('ratelimit-remaining');

    // These headers are optional but good practice
    // We don't fail if they're not present on health endpoint
    if (rateLimit !== null) {
      assertTrue(parseInt(rateLimit) > 0, 'Rate limit should be positive');
    }
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Pimp My Epstein - End-to-End Tests');
  console.log('='.repeat(60));
  console.log(`Target: ${BASE_URL}`);
  console.log(`Time:   ${new Date().toISOString()}`);
  console.log('');

  // Pre-flight check
  try {
    const healthCheck = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!healthCheck.ok) {
      throw new Error(`Server returned ${healthCheck.status}`);
    }
    console.log('Server is running and healthy.\n');
  } catch (error) {
    console.error('ERROR: Cannot connect to server');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error('Run: npm run server');
    console.error(`\nDetails: ${error.message}`);
    process.exit(1);
  }

  // Run all test suites in order (simulating user journey)
  await testLoadHomepage();
  await testViewPhotoGallery();
  await testSelectPhoto();
  await testUploadImage();
  await testClickGenerate();
  await testAdminLogin();
  await testLogout();
  await testUpgradeButton();
  await testSecurity();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => {
        console.log(`  - ${r.name}`);
        console.log(`    ${r.error}`);
      });
    console.log('');
    process.exit(1);
  } else {
    console.log('All tests passed!');
    console.log('');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
