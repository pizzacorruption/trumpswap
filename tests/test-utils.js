/**
 * Test Utilities for Pimp My Epstein
 *
 * Helper functions for making API requests, creating test users,
 * mocking services, and cleanup operations.
 *
 * Usage:
 *   const testUtils = require('./test-utils');
 *   const { api, mockSupabase, cleanup } = testUtils.setup();
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Configuration
const DEFAULT_BASE_URL = 'http://localhost:3000';
const TEST_TIMEOUT = 30000; // 30 seconds

// ============================================
// TEST CONFIGURATION
// ============================================

/**
 * Test configuration object
 */
const config = {
  baseUrl: process.env.TEST_BASE_URL || DEFAULT_BASE_URL,
  timeout: parseInt(process.env.TEST_TIMEOUT) || TEST_TIMEOUT,
  verbose: process.env.TEST_VERBOSE === 'true',
  coverage: process.env.TEST_COVERAGE === 'true',
};

/**
 * Get test configuration
 */
function getConfig() {
  return { ...config };
}

/**
 * Update test configuration
 */
function setConfig(updates) {
  Object.assign(config, updates);
}

// ============================================
// API REQUEST HELPERS
// ============================================

/**
 * Make an API request with common options
 * @param {string} endpoint - API endpoint (e.g., '/api/health')
 * @param {object} options - Fetch options
 * @returns {Promise<{response: Response, data: any}>}
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${config.baseUrl}${endpoint}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const mergedOptions = { ...defaultOptions, ...options };

  // Handle JSON body
  if (mergedOptions.body && typeof mergedOptions.body === 'object' && !(mergedOptions.body instanceof FormData)) {
    mergedOptions.body = JSON.stringify(mergedOptions.body);
  }

  const response = await fetch(url, mergedOptions);
  let data = null;

  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
  } catch (e) {
    // Response may be empty
  }

  return { response, data };
}

/**
 * Make GET request
 */
async function get(endpoint, options = {}) {
  return apiRequest(endpoint, { method: 'GET', ...options });
}

/**
 * Make POST request
 */
async function post(endpoint, body = {}, options = {}) {
  return apiRequest(endpoint, { method: 'POST', body, ...options });
}

/**
 * Make POST request with FormData (for file uploads)
 */
async function postForm(endpoint, formData, options = {}) {
  const url = `${config.baseUrl}${endpoint}`;

  // Don't set Content-Type for FormData - let fetch handle it
  const headers = { ...options.headers };
  delete headers['Content-Type'];

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    headers,
    ...options,
  });

  let data = null;
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    }
  } catch (e) {
    // Response may be empty
  }

  return { response, data };
}

/**
 * Make authenticated request with Bearer token
 */
async function authenticatedRequest(endpoint, token, options = {}) {
  return apiRequest(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Make admin request with admin token
 */
async function adminRequest(endpoint, adminToken, options = {}) {
  return apiRequest(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      'X-Admin-Token': adminToken,
    },
  });
}

// ============================================
// TEST USER HELPERS
// ============================================

/**
 * Generate a unique test user ID
 */
function generateTestUserId() {
  return `test-user-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Generate a unique test email
 */
function generateTestEmail() {
  return `test-${crypto.randomBytes(4).toString('hex')}@test.epswag.local`;
}

/**
 * Create a mock test user object
 */
function createTestUser(overrides = {}) {
  const id = generateTestUserId();
  return {
    id,
    email: generateTestEmail(),
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    ...overrides,
  };
}

/**
 * Create a mock user profile object
 */
function createTestProfile(userId, overrides = {}) {
  return {
    id: userId,
    generation_count: 0,
    subscription_status: null,
    stripe_customer_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a paid user profile
 */
function createPaidProfile(userId, overrides = {}) {
  return createTestProfile(userId, {
    subscription_status: 'active',
    stripe_customer_id: `cus_test_${crypto.randomBytes(8).toString('hex')}`,
    ...overrides,
  });
}

/**
 * Create a free user profile at their limit
 */
function createLimitedProfile(userId, overrides = {}) {
  return createTestProfile(userId, {
    generation_count: 3, // Free tier limit
    ...overrides,
  });
}

// ============================================
// MOCK SUPABASE SESSION HELPERS
// ============================================

/**
 * Create a mock Supabase session
 */
function createMockSession(user, overrides = {}) {
  const accessToken = `mock-token-${crypto.randomBytes(16).toString('hex')}`;
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `mock-refresh-${crypto.randomBytes(16).toString('hex')}`,
    user,
    ...overrides,
  };
}

/**
 * Create a mock Supabase client for testing
 */
function createMockSupabaseClient() {
  const users = new Map();
  const profiles = new Map();
  const sessions = new Map();

  return {
    // Auth methods
    auth: {
      getUser: async (token) => {
        const session = sessions.get(token);
        if (!session) {
          return { data: { user: null }, error: { message: 'Invalid token' } };
        }
        return { data: { user: session.user }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        // For testing, accept any password
        const user = Array.from(users.values()).find(u => u.email === email);
        if (!user) {
          return { data: { user: null, session: null }, error: { message: 'User not found' } };
        }
        const session = createMockSession(user);
        sessions.set(session.access_token, session);
        return { data: { user, session }, error: null };
      },
      signUp: async ({ email, password }) => {
        const user = createTestUser({ email });
        users.set(user.id, user);
        const session = createMockSession(user);
        sessions.set(session.access_token, session);
        return { data: { user, session }, error: null };
      },
      signOut: async () => {
        return { error: null };
      },
    },

    // Database methods
    from: (table) => {
      const data = table === 'profiles' ? profiles : new Map();

      return {
        select: (columns) => ({
          eq: (column, value) => ({
            single: async () => {
              const record = data.get(value);
              return { data: record || null, error: record ? null : { message: 'Not found' } };
            },
            // Return all matching records
            then: async (resolve) => {
              const results = Array.from(data.values()).filter(r => r[column] === value);
              resolve({ data: results, error: null });
            },
          }),
        }),
        insert: (record) => ({
          select: () => ({
            single: async () => {
              const id = record.id || generateTestUserId();
              const newRecord = { ...record, id };
              data.set(id, newRecord);
              return { data: newRecord, error: null };
            },
          }),
        }),
        update: (updates) => ({
          eq: (column, value) => ({
            then: async (resolve) => {
              const record = data.get(value);
              if (record) {
                Object.assign(record, updates);
                data.set(value, record);
              }
              resolve({ data: record, error: record ? null : { message: 'Not found' } });
            },
          }),
        }),
        delete: () => ({
          eq: (column, value) => ({
            then: async (resolve) => {
              const deleted = data.delete(value);
              resolve({ data: null, error: deleted ? null : { message: 'Not found' } });
            },
          }),
        }),
      };
    },

    // Helper methods for tests
    _test: {
      addUser: (user) => {
        users.set(user.id, user);
        return user;
      },
      addProfile: (profile) => {
        profiles.set(profile.id, profile);
        return profile;
      },
      addSession: (token, session) => {
        sessions.set(token, session);
        return session;
      },
      getUsers: () => new Map(users),
      getProfiles: () => new Map(profiles),
      getSessions: () => new Map(sessions),
      clear: () => {
        users.clear();
        profiles.clear();
        sessions.clear();
      },
    },
  };
}

// ============================================
// TEST IMAGE HELPERS
// ============================================

/**
 * Get path to test fixtures directory
 */
function getFixturesPath() {
  return path.join(__dirname, 'fixtures');
}

/**
 * Get path to a specific test fixture
 */
function getFixturePath(filename) {
  return path.join(getFixturesPath(), filename);
}

/**
 * Create a minimal valid PNG image buffer
 * This is a 1x1 red pixel PNG
 */
function createTestPngBuffer() {
  // Minimal 1x1 red PNG
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xFE,
    0xD4, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
  ]);
}

/**
 * Create a minimal valid JPEG image buffer
 * This is a 1x1 white pixel JPEG
 */
function createTestJpegBuffer() {
  // Minimal 1x1 white JPEG
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
    0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04,
    0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00,
    0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
    0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1,
    0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A,
    0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35,
    0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65,
    0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85,
    0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94,
    0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
    0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2,
    0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA,
    0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
    0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8,
    0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6,
    0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
    0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA,
    0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    0xFB, 0xD5, 0xDB, 0x20, 0xA8, 0xF1, 0x7E, 0xFF,
    0xD9,
  ]);
}

/**
 * Create a larger test image buffer (for dimension validation tests)
 * Creates a simple 256x256 gradient PNG
 */
function createValidSizeTestPng() {
  // This returns a pre-generated 256x256 PNG or loads from fixtures
  const fixturePath = getFixturePath('test-face-256.png');
  if (fs.existsSync(fixturePath)) {
    return fs.readFileSync(fixturePath);
  }
  // Fallback to minimal PNG
  return createTestPngBuffer();
}

/**
 * Create a FormData object with a test image
 */
function createTestFormData(imageBuffer = null, epsteinPhoto = '/epstein-photos/test.jpg') {
  const formData = new FormData();
  const buffer = imageBuffer || createTestPngBuffer();
  const blob = new Blob([buffer], { type: 'image/png' });
  formData.append('userPhoto', blob, 'test-face.png');
  formData.append('epsteinPhoto', epsteinPhoto);
  return formData;
}

// ============================================
// CLEANUP HELPERS
// ============================================

/**
 * Clean up test-generated files in output directory
 */
function cleanupOutputFiles(pattern = /^epstein_test_.*\.png$/) {
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    return 0;
  }

  const files = fs.readdirSync(outputDir);
  let cleaned = 0;

  for (const file of files) {
    if (pattern.test(file)) {
      fs.unlinkSync(path.join(outputDir, file));
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Clean up test fixtures
 */
function cleanupFixtures() {
  const fixturesDir = getFixturesPath();
  const tempPattern = /^temp_.*\.(png|jpg|jpeg)$/;

  if (!fs.existsSync(fixturesDir)) {
    return 0;
  }

  const files = fs.readdirSync(fixturesDir);
  let cleaned = 0;

  for (const file of files) {
    if (tempPattern.test(file)) {
      fs.unlinkSync(path.join(fixturesDir, file));
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Full cleanup after tests
 */
function cleanup() {
  const outputCleaned = cleanupOutputFiles();
  const fixturesCleaned = cleanupFixtures();

  if (config.verbose) {
    console.log(`Cleanup: removed ${outputCleaned} output files, ${fixturesCleaned} temp fixtures`);
  }

  return { outputCleaned, fixturesCleaned };
}

// ============================================
// TEST RUNNER HELPERS
// ============================================

/**
 * Test results collector
 */
class TestResults {
  constructor(suiteName = 'Test Suite') {
    this.suiteName = suiteName;
    this.tests = [];
    this.startTime = Date.now();
    this.endTime = null;
  }

  addResult(name, status, error = null, duration = 0) {
    this.tests.push({
      name,
      status,
      error: error?.message || error,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  pass(name, duration = 0) {
    this.addResult(name, 'PASS', null, duration);
  }

  fail(name, error, duration = 0) {
    this.addResult(name, 'FAIL', error, duration);
  }

  skip(name, reason = 'Skipped') {
    this.addResult(name, 'SKIP', reason, 0);
  }

  finish() {
    this.endTime = Date.now();
    return this.getSummary();
  }

  getSummary() {
    const passed = this.tests.filter(t => t.status === 'PASS').length;
    const failed = this.tests.filter(t => t.status === 'FAIL').length;
    const skipped = this.tests.filter(t => t.status === 'SKIP').length;

    return {
      suiteName: this.suiteName,
      total: this.tests.length,
      passed,
      failed,
      skipped,
      duration: this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime,
      tests: this.tests,
      success: failed === 0,
    };
  }
}

/**
 * Simple async test runner
 */
async function runTest(name, fn, results = null) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    if (results) results.pass(name, duration);
    console.log(`  \x1b[32m✓\x1b[0m ${name} (${duration}ms)`);
    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - start;
    if (results) results.fail(name, error, duration);
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31mError: ${error.message}\x1b[0m`);
    return { success: false, error, duration };
  }
}

/**
 * Wait for server to be ready
 */
async function waitForServer(maxRetries = 30, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${config.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error(`Server not ready after ${maxRetries} attempts`);
}

// ============================================
// ASSERTION HELPERS
// ============================================

/**
 * Common assertion helpers
 */
const assert = {
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  notEqual(actual, expected, message) {
    if (actual === expected) {
      throw new Error(message || `Expected value to not equal ${expected}`);
    }
  },

  deepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message || `Objects are not equal`);
    }
  },

  exists(value, message) {
    if (value === null || value === undefined) {
      throw new Error(message || `Expected value to exist, got ${value}`);
    }
  },

  isNull(value, message) {
    if (value !== null) {
      throw new Error(message || `Expected null, got ${value}`);
    }
  },

  isTrue(value, message) {
    if (value !== true) {
      throw new Error(message || `Expected true, got ${value}`);
    }
  },

  isFalse(value, message) {
    if (value !== false) {
      throw new Error(message || `Expected false, got ${value}`);
    }
  },

  isType(value, type, message) {
    if (typeof value !== type) {
      throw new Error(message || `Expected type ${type}, got ${typeof value}`);
    }
  },

  isArray(value, message) {
    if (!Array.isArray(value)) {
      throw new Error(message || `Expected array, got ${typeof value}`);
    }
  },

  includes(array, item, message) {
    if (!array.includes(item)) {
      throw new Error(message || `Expected array to include ${item}`);
    }
  },

  hasProperty(obj, prop, message) {
    if (!(prop in obj)) {
      throw new Error(message || `Expected object to have property ${prop}`);
    }
  },

  statusCode(response, expected, message) {
    if (response.status !== expected) {
      throw new Error(message || `Expected status ${expected}, got ${response.status}`);
    }
  },

  throws(fn, message) {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message || 'Expected function to throw');
    }
  },

  async rejects(fn, message) {
    let threw = false;
    try {
      await fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message || 'Expected async function to reject');
    }
  },
};

// ============================================
// COVERAGE TRACKING
// ============================================

/**
 * Simple coverage tracker for manual tracking
 */
class CoverageTracker {
  constructor() {
    this.coveredFiles = new Set();
    this.coveredFunctions = new Set();
    this.coveredEndpoints = new Set();
  }

  trackFile(filepath) {
    this.coveredFiles.add(filepath);
  }

  trackFunction(filepath, functionName) {
    this.coveredFunctions.add(`${filepath}:${functionName}`);
  }

  trackEndpoint(method, endpoint) {
    this.coveredEndpoints.add(`${method.toUpperCase()} ${endpoint}`);
  }

  getReport() {
    return {
      files: Array.from(this.coveredFiles),
      functions: Array.from(this.coveredFunctions),
      endpoints: Array.from(this.coveredEndpoints),
      summary: {
        filesCovered: this.coveredFiles.size,
        functionsCovered: this.coveredFunctions.size,
        endpointsCovered: this.coveredEndpoints.size,
      },
    };
  }

  clear() {
    this.coveredFiles.clear();
    this.coveredFunctions.clear();
    this.coveredEndpoints.clear();
  }
}

// Singleton coverage tracker
const coverageTracker = new CoverageTracker();

// ============================================
// SETUP HELPER
// ============================================

/**
 * Setup test environment with all utilities
 */
function setup(options = {}) {
  setConfig(options);

  return {
    config: getConfig(),
    api: {
      get,
      post,
      postForm,
      authenticatedRequest,
      adminRequest,
      request: apiRequest,
    },
    mockSupabase: createMockSupabaseClient(),
    users: {
      createUser: createTestUser,
      createProfile: createTestProfile,
      createPaidProfile,
      createLimitedProfile,
      generateUserId: generateTestUserId,
      generateEmail: generateTestEmail,
    },
    sessions: {
      createSession: createMockSession,
    },
    images: {
      createPng: createTestPngBuffer,
      createJpeg: createTestJpegBuffer,
      createValidSizePng: createValidSizeTestPng,
      createFormData: createTestFormData,
      getFixturePath,
    },
    cleanup,
    assert,
    TestResults,
    runTest,
    waitForServer,
    coverage: coverageTracker,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Configuration
  getConfig,
  setConfig,
  config,

  // API helpers
  apiRequest,
  get,
  post,
  postForm,
  authenticatedRequest,
  adminRequest,

  // User helpers
  generateTestUserId,
  generateTestEmail,
  createTestUser,
  createTestProfile,
  createPaidProfile,
  createLimitedProfile,

  // Session helpers
  createMockSession,
  createMockSupabaseClient,

  // Image helpers
  getFixturesPath,
  getFixturePath,
  createTestPngBuffer,
  createTestJpegBuffer,
  createValidSizeTestPng,
  createTestFormData,

  // Cleanup
  cleanupOutputFiles,
  cleanupFixtures,
  cleanup,

  // Test runner helpers
  TestResults,
  runTest,
  waitForServer,

  // Assertions
  assert,

  // Coverage
  CoverageTracker,
  coverageTracker,

  // Main setup
  setup,
};
