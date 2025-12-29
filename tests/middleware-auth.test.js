/**
 * Authentication Middleware Tests
 *
 * Tests for middleware/auth.js which handles:
 * - JWT extraction from Authorization header
 * - Token verification via Supabase
 * - User session management
 * - Protected route access control
 *
 * Run with: node tests/middleware-auth.test.js
 *
 * ============================================
 * HOW AUTHENTICATION WORKS
 * ============================================
 *
 * 1. FLOW:
 *    - Client sends request with "Authorization: Bearer <jwt>" header
 *    - authMiddleware extracts and verifies the JWT via Supabase
 *    - Sets req.user (user object or null) and req.isAuthenticated (boolean)
 *    - Non-blocking: always calls next(), even for invalid/missing tokens
 *
 * 2. PROTECTED ROUTES:
 *    - Use requireAuth middleware after authMiddleware
 *    - Blocks request with 401 if req.isAuthenticated is false
 *
 * 3. ROLE-BASED ACCESS:
 *    - Use requireUserCheck(checkFn, errorMessage) for custom checks
 *    - Returns 401 if not authenticated, 403 if check fails
 *
 * ============================================
 * EDGE CASES HANDLED
 * ============================================
 *
 * - No Authorization header: continues as anonymous
 * - Malformed header (not "Bearer <token>"): continues as anonymous
 * - Empty token: continues as anonymous
 * - Invalid/expired token: continues as anonymous (logged as warning)
 * - Supabase not configured: continues as anonymous (error logged)
 * - Unexpected errors: caught and logged, continues as anonymous
 *
 * ============================================
 */

const assert = require('assert');

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

/**
 * Simple test runner
 */
function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      results.push({ name, status: 'PASS' });
      console.log(`  [PASS] ${name}`);
    } catch (error) {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
      console.log(`  [FAIL] ${name}`);
      console.log(`    Error: ${error.message}`);
    }
  })();
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
  if (value !== true) {
    throw new Error(message || `Expected true, got ${value}`);
  }
}

function assertFalse(value, message) {
  if (value !== false) {
    throw new Error(message || `Expected false, got ${value}`);
  }
}

function assertNull(value, message) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${value}`);
  }
}

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to exist, got ${value}`);
  }
}

function assertCalled(mock, message) {
  if (!mock.called) {
    throw new Error(message || 'Expected function to be called');
  }
}

function assertNotCalled(mock, message) {
  if (mock.called) {
    throw new Error(message || 'Expected function to not be called');
  }
}

/**
 * Create a mock request object
 */
function createMockReq(options = {}) {
  return {
    headers: options.headers || {},
    user: options.user || undefined,
    isAuthenticated: options.isAuthenticated || undefined
  };
}

/**
 * Create a mock response object
 */
function createMockRes() {
  const res = {
    statusCode: null,
    jsonData: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.jsonData = data;
      return res;
    }
  };
  return res;
}

/**
 * Create a mock next function
 */
function createMockNext() {
  const next = () => { next.called = true; };
  next.called = false;
  return next;
}

// ============================================
// Mock the Supabase verifyToken function
// ============================================

// Store original module
let originalVerifyToken;
let mockVerifyTokenResponse = { user: null, error: null };

/**
 * Setup mock for lib/supabase
 * We need to mock before requiring the auth middleware
 */
function setupMocks() {
  // Clear require cache
  delete require.cache[require.resolve('../middleware/auth')];
  delete require.cache[require.resolve('../lib/supabase')];

  // Create mock verifyToken
  const mockSupabase = {
    verifyToken: async (token) => {
      return mockVerifyTokenResponse;
    },
    supabase: null,
    createServerClient: () => null,
    getClientConfig: () => ({ url: '', anonKey: '' })
  };

  // Inject mock into require cache
  require.cache[require.resolve('../lib/supabase')] = {
    id: require.resolve('../lib/supabase'),
    filename: require.resolve('../lib/supabase'),
    loaded: true,
    exports: mockSupabase
  };
}

/**
 * Set mock response for verifyToken
 */
function setVerifyTokenResponse(response) {
  mockVerifyTokenResponse = response;
}

// ============================================
// authMiddleware Tests
// ============================================

async function runAuthMiddlewareTests() {
  console.log('\n=== authMiddleware Tests ===\n');

  // Setup mocks before requiring auth middleware
  setupMocks();
  const { authMiddleware } = require('../middleware/auth');

  // -------------------------------------------
  // No Authorization Header
  // -------------------------------------------
  console.log('No Authorization Header:');

  await test('sets user to null when no auth header', async () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
  });

  await test('sets isAuthenticated to false when no auth header', async () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
  });

  await test('calls next() when no auth header', async () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertCalled(next, 'next should be called');
  });

  // -------------------------------------------
  // Malformed Authorization Header
  // -------------------------------------------
  console.log('\nMalformed Authorization Header:');

  await test('handles header without Bearer prefix', async () => {
    const req = createMockReq({
      headers: { authorization: 'token123' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertCalled(next, 'next should be called');
  });

  await test('handles header with wrong prefix', async () => {
    const req = createMockReq({
      headers: { authorization: 'Basic token123' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertCalled(next, 'next should be called');
  });

  await test('handles header with too many parts', async () => {
    const req = createMockReq({
      headers: { authorization: 'Bearer token extra stuff' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
  });

  await test('handles Bearer with empty token', async () => {
    const req = createMockReq({
      headers: { authorization: 'Bearer ' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertCalled(next, 'next should be called');
  });

  await test('handles case-insensitive Bearer prefix', async () => {
    // The middleware lowercases the prefix check, so "BEARER" should work
    setVerifyTokenResponse({
      user: { id: 'user-123', email: 'test@example.com' },
      error: null
    });

    const req = createMockReq({
      headers: { authorization: 'BEARER valid-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertExists(req.user, 'user should exist');
    assertTrue(req.isAuthenticated, 'isAuthenticated should be true');
  });

  // -------------------------------------------
  // Valid Token
  // -------------------------------------------
  console.log('\nValid Token:');

  await test('sets user from verified token', async () => {
    const mockUser = {
      id: 'user-456',
      email: 'valid@example.com',
      user_metadata: { name: 'Test User' }
    };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-jwt-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertEqual(req.user.id, 'user-456', 'user id should match');
    assertEqual(req.user.email, 'valid@example.com', 'user email should match');
  });

  await test('sets isAuthenticated to true for valid token', async () => {
    const mockUser = { id: 'user-789', email: 'test@example.com' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-jwt-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertTrue(req.isAuthenticated, 'isAuthenticated should be true');
  });

  await test('calls next() after successful auth', async () => {
    const mockUser = { id: 'user-abc', email: 'test@example.com' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-jwt-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertCalled(next, 'next should be called');
  });

  // -------------------------------------------
  // Invalid/Expired Token
  // -------------------------------------------
  console.log('\nInvalid/Expired Token:');

  await test('handles token verification error gracefully', async () => {
    setVerifyTokenResponse({
      user: null,
      error: new Error('Token expired')
    });

    const req = createMockReq({
      headers: { authorization: 'Bearer expired-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertCalled(next, 'next should be called (non-blocking)');
  });

  await test('handles invalid token error gracefully', async () => {
    setVerifyTokenResponse({
      user: null,
      error: new Error('Invalid token')
    });

    const req = createMockReq({
      headers: { authorization: 'Bearer invalid-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertCalled(next, 'next should be called (non-blocking)');
  });

  await test('handles Supabase not configured error', async () => {
    setVerifyTokenResponse({
      user: null,
      error: new Error('Supabase not configured')
    });

    const req = createMockReq({
      headers: { authorization: 'Bearer some-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertCalled(next, 'next should be called');
  });

  // -------------------------------------------
  // Null User Response
  // -------------------------------------------
  console.log('\nNull User Response:');

  await test('handles null user from verifyToken (no error)', async () => {
    setVerifyTokenResponse({ user: null, error: null });

    const req = createMockReq({
      headers: { authorization: 'Bearer some-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertNull(req.user, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
  });
}

// ============================================
// requireAuth Tests
// ============================================

async function runRequireAuthTests() {
  console.log('\n=== requireAuth Tests ===\n');

  // Setup mocks
  setupMocks();
  const { requireAuth } = require('../middleware/auth');

  // -------------------------------------------
  // Unauthenticated Requests
  // -------------------------------------------
  console.log('Unauthenticated Requests:');

  await test('returns 401 when isAuthenticated is false', async () => {
    const req = createMockReq();
    req.isAuthenticated = false;
    req.user = null;
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertEqual(res.statusCode, 401, 'should return 401');
  });

  await test('returns error message when unauthenticated', async () => {
    const req = createMockReq();
    req.isAuthenticated = false;
    req.user = null;
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertEqual(res.jsonData.error, 'Authentication required', 'should have error message');
    assertExists(res.jsonData.message, 'should have detailed message');
  });

  await test('does not call next() when unauthenticated', async () => {
    const req = createMockReq();
    req.isAuthenticated = false;
    req.user = null;
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertNotCalled(next, 'next should not be called');
  });

  await test('returns 401 when user is null but isAuthenticated true', async () => {
    // Edge case: isAuthenticated is true but user is null (shouldn't happen normally)
    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = null;
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertEqual(res.statusCode, 401, 'should return 401');
  });

  await test('returns 401 when user is undefined', async () => {
    const req = createMockReq();
    req.isAuthenticated = false;
    req.user = undefined;
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertEqual(res.statusCode, 401, 'should return 401');
  });

  // -------------------------------------------
  // Authenticated Requests
  // -------------------------------------------
  console.log('\nAuthenticated Requests:');

  await test('calls next() when authenticated', async () => {
    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', email: 'test@example.com' };
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertCalled(next, 'next should be called');
  });

  await test('does not set status when authenticated', async () => {
    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', email: 'test@example.com' };
    const res = createMockRes();
    const next = createMockNext();

    requireAuth(req, res, next);

    assertNull(res.statusCode, 'status should not be set');
    assertNull(res.jsonData, 'json should not be set');
  });
}

// ============================================
// requireUserCheck Tests
// ============================================

async function runRequireUserCheckTests() {
  console.log('\n=== requireUserCheck Tests ===\n');

  // Setup mocks
  setupMocks();
  const { requireUserCheck } = require('../middleware/auth');

  // -------------------------------------------
  // Unauthenticated Requests
  // -------------------------------------------
  console.log('Unauthenticated Requests:');

  await test('returns 401 when not authenticated', async () => {
    const checkFn = (user) => user.role === 'admin';
    const middleware = requireUserCheck(checkFn, 'Admin required');

    const req = createMockReq();
    req.isAuthenticated = false;
    req.user = null;
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertEqual(res.statusCode, 401, 'should return 401');
    assertEqual(res.jsonData.error, 'Authentication required', 'should have auth error');
  });

  // -------------------------------------------
  // Failed Check
  // -------------------------------------------
  console.log('\nFailed Check:');

  await test('returns 403 when check fails', async () => {
    const checkFn = (user) => user.role === 'admin';
    const middleware = requireUserCheck(checkFn, 'Admin access required');

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', role: 'user' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertEqual(res.statusCode, 403, 'should return 403');
  });

  await test('returns custom error message when check fails', async () => {
    const checkFn = (user) => user.role === 'admin';
    const middleware = requireUserCheck(checkFn, 'Admin access required');

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', role: 'user' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertEqual(res.jsonData.error, 'Forbidden', 'should have Forbidden error');
    assertEqual(res.jsonData.message, 'Admin access required', 'should have custom message');
  });

  await test('uses default error message when none provided', async () => {
    const checkFn = (user) => user.isPremium === true;
    const middleware = requireUserCheck(checkFn);

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', isPremium: false };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertEqual(res.jsonData.message, 'Access denied', 'should have default message');
  });

  await test('does not call next() when check fails', async () => {
    const checkFn = (user) => false;
    const middleware = requireUserCheck(checkFn);

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertNotCalled(next, 'next should not be called');
  });

  // -------------------------------------------
  // Passed Check
  // -------------------------------------------
  console.log('\nPassed Check:');

  await test('calls next() when check passes', async () => {
    const checkFn = (user) => user.role === 'admin';
    const middleware = requireUserCheck(checkFn);

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', role: 'admin' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertCalled(next, 'next should be called');
  });

  await test('does not set status when check passes', async () => {
    const checkFn = (user) => user.subscription === 'pro';
    const middleware = requireUserCheck(checkFn);

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', subscription: 'pro' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertNull(res.statusCode, 'status should not be set');
  });

  // -------------------------------------------
  // Various Check Functions
  // -------------------------------------------
  console.log('\nVarious Check Functions:');

  await test('works with email domain check', async () => {
    const checkFn = (user) => user.email.endsWith('@company.com');
    const middleware = requireUserCheck(checkFn, 'Company email required');

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', email: 'employee@company.com' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertCalled(next, 'should allow company email');
  });

  await test('works with array includes check', async () => {
    const allowedRoles = ['admin', 'moderator'];
    const checkFn = (user) => allowedRoles.includes(user.role);
    const middleware = requireUserCheck(checkFn);

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', role: 'moderator' };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertCalled(next, 'should allow moderator');
  });

  await test('works with boolean property check', async () => {
    const checkFn = (user) => user.emailVerified === true;
    const middleware = requireUserCheck(checkFn, 'Email verification required');

    const req = createMockReq();
    req.isAuthenticated = true;
    req.user = { id: 'user-123', emailVerified: false };
    const res = createMockRes();
    const next = createMockNext();

    middleware(req, res, next);

    assertEqual(res.statusCode, 403, 'should reject unverified email');
  });
}

// ============================================
// Token Extraction Edge Cases Tests
// ============================================

async function runTokenExtractionTests() {
  console.log('\n=== Token Extraction Edge Cases ===\n');

  // Setup mocks
  setupMocks();
  const { authMiddleware } = require('../middleware/auth');

  await test('extracts token correctly from "Bearer <token>"', async () => {
    const mockUser = { id: 'user-extract', email: 'test@example.com' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const req = createMockReq({
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertTrue(req.isAuthenticated, 'should authenticate with valid format');
  });

  await test('handles authorization header with lowercase bearer', async () => {
    const mockUser = { id: 'user-lower', email: 'test@example.com' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const req = createMockReq({
      headers: { authorization: 'bearer valid-token' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertTrue(req.isAuthenticated, 'should authenticate with lowercase bearer');
  });

  await test('handles token with special characters', async () => {
    const mockUser = { id: 'user-special', email: 'test@example.com' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    // JWT tokens contain dots and base64 characters
    const req = createMockReq({
      headers: { authorization: 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertTrue(req.isAuthenticated, 'should handle JWT format token');
  });

  await test('handles empty authorization header', async () => {
    const req = createMockReq({
      headers: { authorization: '' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertFalse(req.isAuthenticated, 'should not authenticate with empty header');
    assertCalled(next, 'should call next');
  });

  await test('handles authorization header with only Bearer', async () => {
    const req = createMockReq({
      headers: { authorization: 'Bearer' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    assertFalse(req.isAuthenticated, 'should not authenticate with only Bearer');
  });

  await test('handles whitespace-only token', async () => {
    const req = createMockReq({
      headers: { authorization: 'Bearer    ' }
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(req, res, next);

    // The split will produce ['Bearer', '   '] which is 2 parts
    // The token '   ' is truthy, so it will try to verify
    // We expect it to fail verification (mocked as failure)
    assertFalse(req.isAuthenticated, 'should handle whitespace token');
  });
}

// ============================================
// Integration-Style Tests (Full Middleware Chain)
// ============================================

async function runIntegrationTests() {
  console.log('\n=== Integration-Style Tests ===\n');

  // Setup mocks
  setupMocks();
  const { authMiddleware, requireAuth, requireUserCheck } = require('../middleware/auth');

  console.log('Full Middleware Chain:');

  await test('authMiddleware + requireAuth: blocks unauthenticated', async () => {
    setVerifyTokenResponse({ user: null, error: new Error('Invalid token') });

    const req = createMockReq({
      headers: { authorization: 'Bearer invalid-token' }
    });
    const res = createMockRes();
    const next1 = createMockNext();

    // First middleware: authMiddleware
    await authMiddleware(req, res, next1);
    assertCalled(next1, 'authMiddleware should call next');

    // Second middleware: requireAuth
    const next2 = createMockNext();
    requireAuth(req, res, next2);

    assertEqual(res.statusCode, 401, 'should block with 401');
    assertNotCalled(next2, 'requireAuth should not call next');
  });

  await test('authMiddleware + requireAuth: allows authenticated', async () => {
    const mockUser = { id: 'user-chain', email: 'chain@example.com' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-token' }
    });
    const res = createMockRes();
    const next1 = createMockNext();

    // First middleware: authMiddleware
    await authMiddleware(req, res, next1);
    assertCalled(next1, 'authMiddleware should call next');

    // Second middleware: requireAuth
    const next2 = createMockNext();
    requireAuth(req, res, next2);

    assertCalled(next2, 'requireAuth should call next');
    assertNull(res.statusCode, 'should not set error status');
  });

  await test('full chain with requireUserCheck: admin access', async () => {
    const mockUser = { id: 'admin-user', email: 'admin@example.com', role: 'admin' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const isAdmin = requireUserCheck(
      (user) => user.role === 'admin',
      'Admin access required'
    );

    const req = createMockReq({
      headers: { authorization: 'Bearer admin-token' }
    });
    const res = createMockRes();

    // Chain: authMiddleware -> requireUserCheck
    await authMiddleware(req, res, createMockNext());

    const next = createMockNext();
    isAdmin(req, res, next);

    assertCalled(next, 'should allow admin');
  });

  await test('full chain with requireUserCheck: non-admin denied', async () => {
    const mockUser = { id: 'regular-user', email: 'user@example.com', role: 'user' };
    setVerifyTokenResponse({ user: mockUser, error: null });

    const isAdmin = requireUserCheck(
      (user) => user.role === 'admin',
      'Admin access required'
    );

    const req = createMockReq({
      headers: { authorization: 'Bearer user-token' }
    });
    const res = createMockRes();

    // Chain: authMiddleware -> requireUserCheck
    await authMiddleware(req, res, createMockNext());

    const next = createMockNext();
    isAdmin(req, res, next);

    assertNotCalled(next, 'should deny non-admin');
    assertEqual(res.statusCode, 403, 'should return 403');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Authentication Middleware Tests');
  console.log('='.repeat(60));
  console.log('');
  console.log('Testing: middleware/auth.js');
  console.log('  - authMiddleware: JWT extraction and verification');
  console.log('  - requireAuth: Protected route enforcement');
  console.log('  - requireUserCheck: Role/permission checking');
  console.log('');

  // Run all test suites
  await runAuthMiddlewareTests();
  await runRequireAuthTests();
  await runRequireUserCheckTests();
  await runTokenExtractionTests();
  await runIntegrationTests();

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
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('All tests passed!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
