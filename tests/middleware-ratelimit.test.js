/**
 * Rate Limit Middleware Tests for Pimp My Epstein
 *
 * Tests the rate limiting middleware at middleware/rateLimit.js.
 * Run with: node tests/middleware-ratelimit.test.js
 *
 * Rate Limit Tiers Configuration:
 * ================================
 * | Tier      | Limit     | Description                       |
 * |-----------|-----------|-----------------------------------|
 * | anonymous | 1         | Try it once without signing up    |
 * | free      | 3         | Sign up for 3 free generations    |
 * | paid      | Infinity  | Unlimited generations (Pro tier)  |
 * | admin     | Infinity  | Admin bypass (no limits)          |
 *
 * Rate Limit Headers:
 * - Response includes usage info in successful responses
 * - 429 status returned when rate limit exceeded
 * - Error response includes tier, limit, used, remaining, upgradeUrl
 */

const assert = require('assert');

// Mock the usage service for isolated testing
const originalUsageModule = require('../services/usage');
const tiers = require('../config/tiers');
const { createRateLimitMiddleware, getClientIP, simpleRateLimitMiddleware } = require('../middleware/rateLimit');

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

/**
 * Simple test runner
 */
function test(name, fn) {
  return new Promise(async (resolve) => {
    try {
      await fn();
      passed++;
      results.push({ name, status: 'PASS' });
      console.log(`  [PASS] ${name}`);
      resolve(true);
    } catch (error) {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
      console.log(`  [FAIL] ${name}`);
      console.log(`    Error: ${error.message}`);
      resolve(false);
    }
  });
}

/**
 * Assert helper functions
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertNotEqual(actual, expected, message) {
  if (actual === expected) {
    throw new Error(message || `Expected value to not equal ${expected}`);
  }
}

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to exist, got ${value}`);
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

function assertType(value, type, message) {
  if (typeof value !== type) {
    throw new Error(message || `Expected type ${type}, got ${typeof value}`);
  }
}

/**
 * Create a mock Express request object
 */
function createMockRequest(options = {}) {
  return {
    headers: options.headers || {},
    connection: options.connection || {},
    socket: options.socket || {},
    ip: options.ip || null,
    user: options.user || null,
    isAdmin: options.isAdmin || false
  };
}

/**
 * Create a mock Express response object
 */
function createMockResponse() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.jsonData = data;
      return this;
    }
  };
  return res;
}

/**
 * Create a simple next function that tracks if it was called
 */
function createNext() {
  let called = false;
  const next = () => { called = true; };
  next.wasCalled = () => called;
  return next;
}

// ============================================
// getClientIP TESTS
// ============================================

async function runGetClientIPTests() {
  console.log('\n=== getClientIP Tests (Secure Implementation) ===\n');

  // SECURITY: The new secure implementation uses req.ip (Express built-in)
  // which respects 'trust proxy' setting instead of directly reading headers
  // This prevents IP spoofing attacks from untrusted sources

  await test('uses req.ip when available (Express trust proxy)', () => {
    // req.ip is set by Express based on 'trust proxy' setting
    const req = createMockRequest({
      ip: '203.0.113.195',
      headers: { 'x-forwarded-for': '1.2.3.4' } // Should be ignored - Express handles this
    });
    const ip = getClientIP(req);
    assertEqual(ip, '203.0.113.195', 'Should use req.ip (Express handles trust proxy)');
  });

  await test('ignores x-forwarded-for header directly (security)', () => {
    // Headers should NOT be read directly - that's insecure
    const req = createMockRequest({
      headers: { 'x-forwarded-for': '203.0.113.195' }
      // Note: no ip or socket.remoteAddress - only untrusted header
    });
    const ip = getClientIP(req);
    // Without req.ip or socket.remoteAddress, should fall back to unknown
    assertEqual(ip, 'unknown', 'Should NOT read x-forwarded-for directly');
  });

  await test('ignores x-real-ip header directly (security)', () => {
    const req = createMockRequest({
      headers: { 'x-real-ip': '192.168.1.100' }
    });
    const ip = getClientIP(req);
    assertEqual(ip, 'unknown', 'Should NOT read x-real-ip directly');
  });

  await test('falls back to socket.remoteAddress when req.ip not set', () => {
    const req = createMockRequest({
      socket: { remoteAddress: '172.16.0.1' }
    });
    const ip = getClientIP(req);
    assertEqual(ip, '172.16.0.1', 'Should use socket.remoteAddress as fallback');
  });

  await test('returns req.ip over socket.remoteAddress', () => {
    const req = createMockRequest({
      ip: '8.8.8.8',
      socket: { remoteAddress: '127.0.0.1' }
    });
    const ip = getClientIP(req);
    assertEqual(ip, '8.8.8.8', 'Should prefer req.ip');
  });

  await test('returns "unknown" when no IP source available', () => {
    const req = createMockRequest({});
    const ip = getClientIP(req);
    assertEqual(ip, 'unknown', 'Should return "unknown"');
  });

  await test('handles IPv6 addresses via req.ip', () => {
    const req = createMockRequest({
      ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
    });
    const ip = getClientIP(req);
    assertEqual(ip, '2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'Should handle IPv6');
  });

  await test('Express trust proxy handles header parsing securely', () => {
    // This tests that when Express's trust proxy is configured,
    // req.ip contains the correct client IP from trusted proxies
    const req = createMockRequest({
      ip: '203.0.113.50' // Express would set this from trusted proxy headers
    });
    const ip = getClientIP(req);
    assertEqual(ip, '203.0.113.50', 'Should use Express-set req.ip');
  });

}

// ============================================
// createRateLimitMiddleware TESTS
// ============================================

async function runCreateRateLimitMiddlewareTests() {
  console.log('\n=== createRateLimitMiddleware Tests ===\n');

  await test('creates middleware function', () => {
    const middleware = createRateLimitMiddleware();
    assertType(middleware, 'function', 'Should return a function');
  });

  await test('middleware accepts options', () => {
    const middleware = createRateLimitMiddleware({
      upgradeUrl: '/custom-upgrade',
      getProfile: async () => ({ subscription_status: 'active' }),
      updateProfile: async () => {}
    });
    assertType(middleware, 'function', 'Should return a function with options');
  });

  await test('uses default upgradeUrl when not specified', async () => {
    // Reset anonymous usage for this IP
    originalUsageModule.resetAnonymousUsage('rate-limit-test-ip-1');
    // Use up the limit first
    originalUsageModule.incrementUsage(null, null, 'rate-limit-test-ip-1');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'rate-limit-test-ip-1'  // Use ip (Express sets this via trust proxy)
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.upgradeUrl, '/pricing', 'Should use default upgradeUrl');
  });

  await test('uses custom upgradeUrl when specified', async () => {
    originalUsageModule.resetAnonymousUsage('rate-limit-test-ip-2');
    originalUsageModule.incrementUsage(null, null, 'rate-limit-test-ip-2');

    const middleware = createRateLimitMiddleware({
      upgradeUrl: '/custom-pricing'
    });
    const req = createMockRequest({
      ip: 'rate-limit-test-ip-2'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.upgradeUrl, '/custom-pricing', 'Should use custom upgradeUrl');
  });
}

// ============================================
// ADMIN BYPASS TESTS
// ============================================

async function runAdminBypassTests() {
  console.log('\n=== Admin Rate Limit Bypass Tests ===\n');

  await test('admin users bypass rate limits', async () => {
    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      isAdmin: true,
      ip: 'admin-test-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should call next() for admin');
    assertEqual(req.usage.tier, 'admin', 'Should set admin tier');
    assertEqual(req.usage.tierName, 'Admin', 'Should set Admin tier name');
    assertEqual(req.usage.canGenerate, true, 'Admin should always be able to generate');
    assertEqual(req.usage.remaining, Infinity, 'Admin should have infinite remaining');
  });

  await test('admin bypass sets clientIP on request', async () => {
    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      isAdmin: true,
      ip: 'admin-ip-123'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(req.clientIP, 'admin-ip-123', 'Should set clientIP for admin');
  });

  await test('admin bypass ignores usage limits even at high counts', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => ({ generation_count: 10000 })
    });
    const req = createMockRequest({
      isAdmin: true,
      user: { id: 'admin-user-id' },
      ip: 'admin-heavy-user'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should bypass regardless of usage count');
    assertEqual(req.usage.canGenerate, true, 'Should be able to generate');
  });
}

// ============================================
// TIER-BASED RATE LIMIT TESTS
// ============================================

async function runTierRateLimitTests() {
  console.log('\n=== Tier-Based Rate Limit Tests ===\n');

  // Anonymous tier tests
  await test('anonymous user allowed on first request', async () => {
    originalUsageModule.resetAnonymousUsage('anon-first-ip');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'anon-first-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should allow first anonymous request');
    assertEqual(req.usage.tier, 'anonymous', 'Should be anonymous tier');
    assertEqual(req.usage.limit, 1, 'Anonymous limit should be 1');
  });

  await test('anonymous user blocked after limit reached', async () => {
    originalUsageModule.resetAnonymousUsage('anon-limited-ip');
    originalUsageModule.incrementUsage(null, null, 'anon-limited-ip');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'anon-limited-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertFalse(next.wasCalled(), 'Should block anonymous after limit');
    assertEqual(res.statusCode, 429, 'Should return 429 status');
    assertEqual(res.jsonData.code, 'RATE_LIMITED', 'Should return RATE_LIMITED code');
  });

  // Free tier tests
  await test('free user allowed within limit', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => ({ generation_count: 1 })
    });
    const req = createMockRequest({
      user: { id: 'free-user-123' },
      ip: 'free-user-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should allow free user within limit');
    assertEqual(req.usage.tier, 'free', 'Should be free tier');
    assertEqual(req.usage.limit, 3, 'Free limit should be 3');
    assertEqual(req.usage.remaining, 2, 'Should have 2 remaining');
  });

  await test('free user blocked at limit', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => ({ generation_count: 3 })
    });
    const req = createMockRequest({
      user: { id: 'free-limited-user' },
      ip: 'free-limited-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertFalse(next.wasCalled(), 'Should block free user at limit');
    assertEqual(res.statusCode, 429, 'Should return 429 status');
  });

  // Paid tier tests
  await test('paid user always allowed (unlimited)', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => ({ subscription_status: 'active', generation_count: 1000 })
    });
    const req = createMockRequest({
      user: { id: 'paid-user-123' },
      ip: 'paid-user-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should always allow paid user');
    assertEqual(req.usage.tier, 'paid', 'Should be paid tier');
    assertEqual(req.usage.limit, 'unlimited', 'Paid limit should be unlimited');
    assertEqual(req.usage.remaining, 'unlimited', 'Paid remaining should be unlimited');
    assertTrue(req.usage.canGenerate, 'Paid user should always be able to generate');
  });

  await test('paid user with extremely high usage still allowed', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => ({ subscription_status: 'active', generation_count: 999999 })
    });
    const req = createMockRequest({
      user: { id: 'heavy-paid-user' },
      ip: 'heavy-paid-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should allow even heavy paid user');
  });
}

// ============================================
// RATE LIMIT RESPONSE TESTS
// ============================================

async function runRateLimitResponseTests() {
  console.log('\n=== Rate Limit Response Tests ===\n');

  await test('429 response includes error field', async () => {
    originalUsageModule.resetAnonymousUsage('response-test-ip-1');
    originalUsageModule.incrementUsage(null, null, 'response-test-ip-1');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'response-test-ip-1'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.error, 'Rate limit exceeded', 'Should include error message');
  });

  await test('429 response includes code field', async () => {
    originalUsageModule.resetAnonymousUsage('response-test-ip-2');
    originalUsageModule.incrementUsage(null, null, 'response-test-ip-2');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'response-test-ip-2'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.code, 'RATE_LIMITED', 'Should include RATE_LIMITED code');
  });

  await test('429 response includes tier info', async () => {
    originalUsageModule.resetAnonymousUsage('response-test-ip-3');
    originalUsageModule.incrementUsage(null, null, 'response-test-ip-3');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'response-test-ip-3'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.tier, 'anonymous', 'Should include tier');
    assertEqual(res.jsonData.tierName, 'Anonymous', 'Should include tierName');
  });

  await test('429 response includes limit and used', async () => {
    originalUsageModule.resetAnonymousUsage('response-test-ip-4');
    originalUsageModule.incrementUsage(null, null, 'response-test-ip-4');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'response-test-ip-4'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.limit, 1, 'Should include limit');
    assertEqual(res.jsonData.used, 1, 'Should include used');
    assertEqual(res.jsonData.remaining, 0, 'Should include remaining as 0');
  });

  await test('429 response includes resetAt timestamp', async () => {
    originalUsageModule.resetAnonymousUsage('response-test-ip-5');
    originalUsageModule.incrementUsage(null, null, 'response-test-ip-5');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'response-test-ip-5'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertExists(res.jsonData.resetAt, 'Should include resetAt');
    // Verify it's a valid ISO date string
    const date = new Date(res.jsonData.resetAt);
    assertTrue(!isNaN(date.getTime()), 'resetAt should be valid date');
  });

  await test('429 response includes upgrade message for anonymous', async () => {
    originalUsageModule.resetAnonymousUsage('response-test-ip-6');
    originalUsageModule.incrementUsage(null, null, 'response-test-ip-6');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'response-test-ip-6'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.message, 'Sign up for free to get 3 more generations!',
      'Should include anonymous upgrade message');
  });

  await test('429 response includes upgrade message for free user', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => ({ generation_count: 3 })
    });
    const req = createMockRequest({
      user: { id: 'free-upgrade-user' },
      ip: 'free-upgrade-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(res.jsonData.message, 'Upgrade to Pro for unlimited generations!',
      'Should include free upgrade message');
  });
}

// ============================================
// REQUEST AUGMENTATION TESTS
// ============================================

async function runRequestAugmentationTests() {
  console.log('\n=== Request Augmentation Tests ===\n');

  await test('attaches usage info to request', async () => {
    originalUsageModule.resetAnonymousUsage('augment-test-ip-1');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'augment-test-ip-1'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertExists(req.usage, 'Should attach usage object to request');
    assertExists(req.usage.used, 'usage should have used');
    assertExists(req.usage.limit, 'usage should have limit');
    assertExists(req.usage.tier, 'usage should have tier');
    assertExists(req.usage.tierName, 'usage should have tierName');
    assertType(req.usage.canGenerate, 'boolean', 'usage should have canGenerate boolean');
  });

  await test('attaches clientIP to request', async () => {
    originalUsageModule.resetAnonymousUsage('augment-test-ip-2');

    const middleware = createRateLimitMiddleware();
    const req = createMockRequest({
      ip: 'augment-test-ip-2'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertEqual(req.clientIP, 'augment-test-ip-2', 'Should attach clientIP to request');
  });
}

// ============================================
// PROFILE FETCHING TESTS
// ============================================

async function runProfileFetchingTests() {
  console.log('\n=== Profile Fetching Tests ===\n');

  await test('calls getProfile for authenticated users', async () => {
    let profileFetched = false;
    const middleware = createRateLimitMiddleware({
      getProfile: async (userId) => {
        profileFetched = true;
        assertEqual(userId, 'profile-test-user', 'Should pass correct userId');
        return { generation_count: 0 };
      }
    });
    const req = createMockRequest({
      user: { id: 'profile-test-user' },
      ip: 'profile-test-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertTrue(profileFetched, 'Should call getProfile');
  });

  await test('does not call getProfile for anonymous users', async () => {
    let profileFetched = false;
    originalUsageModule.resetAnonymousUsage('no-profile-ip');

    const middleware = createRateLimitMiddleware({
      getProfile: async () => {
        profileFetched = true;
        return null;
      }
    });
    const req = createMockRequest({
      ip: 'no-profile-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    assertFalse(profileFetched, 'Should not call getProfile for anonymous');
  });

  await test('handles getProfile errors gracefully', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: async () => {
        throw new Error('Database connection failed');
      }
    });
    const req = createMockRequest({
      user: { id: 'error-profile-user' },
      ip: 'error-profile-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    // Should still proceed (treated as free user with no profile)
    assertTrue(next.wasCalled(), 'Should continue despite getProfile error');
  });
}

// ============================================
// simpleRateLimitMiddleware TESTS
// ============================================

async function runSimpleRateLimitMiddlewareTests() {
  console.log('\n=== simpleRateLimitMiddleware Tests ===\n');

  await test('creates middleware without options', () => {
    assertType(simpleRateLimitMiddleware, 'function', 'Should be a function');
  });

  await test('works for anonymous users', async () => {
    originalUsageModule.resetAnonymousUsage('simple-test-ip');

    const req = createMockRequest({
      ip: 'simple-test-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await simpleRateLimitMiddleware(req, res, next);

    assertTrue(next.wasCalled(), 'Should call next for valid request');
    assertEqual(req.usage.tier, 'anonymous', 'Should identify as anonymous');
  });
}

// ============================================
// MIDDLEWARE ERROR HANDLING TESTS
// ============================================

async function runErrorHandlingTests() {
  console.log('\n=== Middleware Error Handling Tests ===\n');

  await test('continues on middleware errors', async () => {
    // Create a middleware that could potentially fail
    const middleware = createRateLimitMiddleware({
      getProfile: async () => null
    });

    const req = createMockRequest({
      user: { id: 'error-test-user' },
      ip: 'error-test-ip'
    });
    const res = createMockResponse();
    const next = createNext();

    await middleware(req, res, next);

    // Should not throw and should call next
    assertTrue(next.wasCalled(), 'Should handle gracefully and continue');
  });
}

// ============================================
// TIER CONFIGURATION DOCUMENTATION
// ============================================

function documentTierConfiguration() {
  console.log('\n=== Tier Configuration Reference ===\n');
  console.log('Current rate limit tiers:');
  console.log('');
  console.log('| Tier      | Limit    | Name       | Description                       |');
  console.log('|-----------|----------|------------|-----------------------------------|');
  Object.entries(tiers).forEach(([key, config]) => {
    const limit = config.limit === Infinity ? 'Unlimited' : config.limit.toString();
    console.log(`| ${key.padEnd(9)} | ${limit.padEnd(8)} | ${config.name.padEnd(10)} | ${config.description.padEnd(33)} |`);
  });
  console.log('');
  console.log('Special tiers (not in config):');
  console.log('| admin     | Unlimited | Admin      | Bypass all rate limits (req.isAdmin) |');
  console.log('');
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Rate Limit Middleware Tests for Pimp My Epstein');
  console.log('='.repeat(60));
  console.log('');

  // Document tier configuration first
  documentTierConfiguration();

  // Run all test suites
  await runGetClientIPTests();
  await runCreateRateLimitMiddlewareTests();
  await runAdminBypassTests();
  await runTierRateLimitTests();
  await runRateLimitResponseTests();
  await runRequestAugmentationTests();
  await runProfileFetchingTests();
  await runSimpleRateLimitMiddlewareTests();
  await runErrorHandlingTests();

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
