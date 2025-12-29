/**
 * Usage Service Unit Tests for Pimp My Epstein
 *
 * Tests the usage tracking service (services/usage.js) in isolation.
 * Run with: node tests/services-usage.test.js
 *
 * ============================================
 * USAGE SYSTEM DOCUMENTATION
 * ============================================
 *
 * The usage tracking system manages generation limits across three tiers:
 *
 * 1. ANONYMOUS USERS (tracked by IP address)
 *    - Limit: 1 generation
 *    - Storage: In-memory Map (anonymousUsage)
 *    - Auto-cleanup: When Map exceeds 10,000 entries, oldest 5,000 are removed
 *    - No database updates required
 *
 * 2. FREE USERS (authenticated, no subscription)
 *    - Limit: 3 generations
 *    - Storage: Database (profile.generation_count)
 *    - Requires caller to update database after incrementUsage()
 *
 * 3. PAID/PRO USERS (active subscription)
 *    - Limit: Unlimited (Infinity)
 *    - Storage: Database (profile.generation_count for tracking, not limits)
 *    - canGenerate always returns true regardless of count
 *
 * EDGE CASES:
 * - Anonymous users with same IP share the same count
 * - Authenticated user with null profile treated as free tier with 0 count
 * - Subscription status must be exactly 'active' for paid tier
 * - Memory cleanup is FIFO (first 5000 keys removed when limit hit)
 * - No automatic reset of counts - anonymous resets only when IP removed from Map
 *
 * IMPORTANT NOTES:
 * - incrementUsage for authenticated users does NOT update the database
 *   It returns { newCount, shouldUpdateDb: true } for caller to handle
 * - The anonymousUsage Map persists for server lifetime (not request-scoped)
 * - resetAnonymousUsage() is primarily for testing
 */

const assert = require('assert');

// Import services
const usage = require('../services/usage');
const tiers = require('../config/tiers');

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

/**
 * Simple test runner
 */
function test(name, fn) {
  try {
    fn();
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

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || `Expected value to exist, got ${value}`);
  }
}

// ============================================
// ANONYMOUS USAGE TRACKING BY IP TESTS
// ============================================

function runAnonymousUsageTests() {
  console.log('\n=== Anonymous Usage Tracking by IP ===\n');

  // Fresh start for each test section
  const testIp1 = `test-anon-ip-${Date.now()}-1`;
  const testIp2 = `test-anon-ip-${Date.now()}-2`;

  test('new IP address starts with 0 used', () => {
    const freshIp = `fresh-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, freshIp);
    assertEqual(result.used, 0, 'New IP should have 0 used');
  });

  test('anonymous users are identified by IP address', () => {
    usage.resetAnonymousUsage(testIp1);
    usage.resetAnonymousUsage(testIp2);

    usage.incrementUsage(null, null, testIp1);

    const result1 = usage.checkUsage(null, null, testIp1);
    const result2 = usage.checkUsage(null, null, testIp2);

    assertEqual(result1.used, 1, 'IP1 should have 1 used');
    assertEqual(result2.used, 0, 'IP2 should have 0 used (different IP)');
  });

  test('multiple increments for same IP - atomic limit enforcement', () => {
    // With anonymous limit of 1, second increment fails
    const ip = `accumulate-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const r1 = usage.incrementUsage(null, null, ip);
    assertTrue(r1.success, 'First increment should succeed');

    const r2 = usage.incrementUsage(null, null, ip);
    assertFalse(r2.success, 'Second increment should fail (limit reached)');

    const result = usage.checkUsage(null, null, ip);
    assertEqual(result.used, 1, 'Should have 1 used (limit enforced)');
  });

  test('anonymous user tier is correctly identified', () => {
    const ip = `tier-check-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, ip);
    assertEqual(result.tier, 'anonymous', 'Tier should be anonymous');
    assertEqual(result.tierName, 'Anonymous', 'Tier name should be Anonymous');
  });

  test('anonymous usage limit is 1', () => {
    const ip = `limit-check-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, ip);
    assertEqual(result.limit, 1, 'Anonymous limit should be 1');
  });

  test('anonymous user can generate when under limit', () => {
    const ip = `can-gen-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.checkUsage(null, null, ip);
    assertTrue(result.canGenerate, 'Should be able to generate with 0 used');
    assertEqual(result.remaining, 1, 'Should have 1 remaining');
  });

  test('anonymous user cannot generate when at limit', () => {
    const ip = `at-limit-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    usage.incrementUsage(null, null, ip);

    const result = usage.checkUsage(null, null, ip);
    assertFalse(result.canGenerate, 'Should not be able to generate at limit');
    assertEqual(result.remaining, 0, 'Should have 0 remaining');
  });

  test('anonymous user cannot generate when over limit', () => {
    const ip = `over-limit-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    // Increment multiple times to go over limit
    usage.incrementUsage(null, null, ip);
    usage.incrementUsage(null, null, ip);
    usage.incrementUsage(null, null, ip);

    const result = usage.checkUsage(null, null, ip);
    assertFalse(result.canGenerate, 'Should not be able to generate over limit');
    assertEqual(result.remaining, 0, 'Remaining should be 0, not negative');
  });

  test('resetAnonymousUsage clears usage for IP', () => {
    const ip = `reset-ip-${Date.now()}`;

    usage.incrementUsage(null, null, ip);
    // Second increment fails due to limit, but first one was stored

    let result = usage.checkUsage(null, null, ip);
    assertEqual(result.used, 1, 'Should have 1 before reset (limit prevents more)');

    usage.resetAnonymousUsage(ip);

    result = usage.checkUsage(null, null, ip);
    assertEqual(result.used, 0, 'Should have 0 after reset');
  });

  test('incrementUsage returns correct newCount for anonymous', () => {
    const ip = `newcount-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result1 = usage.incrementUsage(null, null, ip);
    assertTrue(result1.success, 'First increment should succeed');
    assertEqual(result1.newCount, 1, 'First increment should return 1');

    // Second increment fails due to limit=1
    const result2 = usage.incrementUsage(null, null, ip);
    assertFalse(result2.success, 'Second increment should fail (limit reached)');
    assertEqual(result2.newCount, 1, 'Failed increment returns current count');
  });

  test('incrementUsage returns shouldUpdateDb false for anonymous', () => {
    const ip = `no-db-update-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.incrementUsage(null, null, ip);
    assertFalse(result.shouldUpdateDb, 'Anonymous should not require DB update');
  });
}

// ============================================
// AUTHENTICATED USER USAGE TRACKING TESTS
// ============================================

function runAuthenticatedUsageTests() {
  console.log('\n=== Authenticated User Usage Tracking ===\n');

  test('authenticated user with null profile returns free tier', () => {
    const tier = usage.getUserTier('user-123', null);
    assertEqual(tier, 'free', 'Should return free for null profile');
  });

  test('authenticated user with empty profile returns free tier', () => {
    const tier = usage.getUserTier('user-123', {});
    assertEqual(tier, 'free', 'Should return free for empty profile');
  });

  test('free user has correct tier info', () => {
    const result = usage.checkUsage('user-free-1', { generation_count: 0 }, null);
    assertEqual(result.tier, 'free', 'Tier should be free');
    assertEqual(result.tierName, 'Free', 'Tier name should be Free');
  });

  test('free user limit is 3', () => {
    const result = usage.checkUsage('user-free-2', { generation_count: 0 }, null);
    assertEqual(result.limit, 3, 'Free limit should be 3');
  });

  test('free user used count comes from profile.generation_count', () => {
    const result = usage.checkUsage('user-gen-count', { generation_count: 2 }, null);
    assertEqual(result.used, 2, 'Used should match profile.generation_count');
  });

  test('free user remaining is calculated correctly', () => {
    const result = usage.checkUsage('user-remaining', { generation_count: 1 }, null);
    assertEqual(result.remaining, 2, 'Should have 2 remaining (3 - 1)');
  });

  test('free user can generate when under limit', () => {
    const result = usage.checkUsage('user-under', { generation_count: 2 }, null);
    assertTrue(result.canGenerate, 'Should be able to generate with 2 used');
  });

  test('free user cannot generate when at limit', () => {
    const result = usage.checkUsage('user-at-limit', { generation_count: 3 }, null);
    assertFalse(result.canGenerate, 'Should not be able to generate at limit');
    assertEqual(result.remaining, 0, 'Should have 0 remaining');
  });

  test('free user cannot generate when over limit', () => {
    const result = usage.checkUsage('user-over-limit', { generation_count: 10 }, null);
    assertFalse(result.canGenerate, 'Should not be able to generate over limit');
  });

  test('incrementUsage returns correct newCount for authenticated user', () => {
    // Use count under free tier limit (3) so increment succeeds
    const result = usage.incrementUsage('user-auth', { generation_count: 1 }, null);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertEqual(result.newCount, 2, 'Should return profile.generation_count + 1');
  });

  test('incrementUsage returns shouldUpdateDb true for authenticated user', () => {
    // Use count under free tier limit (3) so increment succeeds
    const result = usage.incrementUsage('user-auth', { generation_count: 0 }, null);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertTrue(result.shouldUpdateDb, 'Authenticated user should require DB update');
  });

  test('incrementUsage fails for authenticated user at limit', () => {
    // At free tier limit (3), increment should fail
    const result = usage.incrementUsage('user-at-limit', { generation_count: 3 }, null);
    assertFalse(result.success, 'Increment should fail at limit');
    assertEqual(result.error, 'Usage limit exceeded', 'Should return limit error');
  });

  test('incrementUsage handles null profile generation_count', () => {
    const result = usage.incrementUsage('user-null-count', { generation_count: null }, null);
    assertEqual(result.newCount, 1, 'Should treat null as 0');
  });

  test('incrementUsage handles missing generation_count property', () => {
    const result = usage.incrementUsage('user-no-count', {}, null);
    assertEqual(result.newCount, 1, 'Should treat missing as 0');
  });

  test('incrementUsage handles undefined generation_count', () => {
    const result = usage.incrementUsage('user-undefined', { generation_count: undefined }, null);
    assertEqual(result.newCount, 1, 'Should treat undefined as 0');
  });
}

// ============================================
// USAGE LIMITS ENFORCEMENT TESTS
// ============================================

function runUsageLimitsTests() {
  console.log('\n=== Usage Limits Enforcement ===\n');

  test('anonymous limit matches tiers config', () => {
    assertEqual(tiers.anonymous.limit, 1, 'Tiers config anonymous limit should be 1');
    const result = usage.checkUsage(null, null, 'config-check-ip');
    assertEqual(result.limit, 1, 'checkUsage should return same limit');
  });

  test('free limit matches tiers config', () => {
    assertEqual(tiers.free.limit, 3, 'Tiers config free limit should be 3');
    const result = usage.checkUsage('user-config', { generation_count: 0 }, null);
    assertEqual(result.limit, 3, 'checkUsage should return same limit');
  });

  test('paid limit is Infinity in tiers config', () => {
    assertEqual(tiers.paid.limit, Infinity, 'Tiers config paid limit should be Infinity');
  });

  test('paid limit displayed as unlimited string', () => {
    const result = usage.checkUsage('user-paid', { subscription_status: 'active' }, null);
    assertEqual(result.limit, 'unlimited', 'Should display as unlimited');
  });

  test('canGenerate boundary: anonymous at exactly 0', () => {
    const ip = `boundary-0-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    const result = usage.checkUsage(null, null, ip);
    assertTrue(result.canGenerate, '0 < 1, should be able to generate');
  });

  test('canGenerate boundary: anonymous at exactly 1', () => {
    const ip = `boundary-1-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    usage.incrementUsage(null, null, ip);
    const result = usage.checkUsage(null, null, ip);
    assertFalse(result.canGenerate, '1 >= 1, should not be able to generate');
  });

  test('canGenerate boundary: free at exactly 2', () => {
    const result = usage.checkUsage('user-boundary-2', { generation_count: 2 }, null);
    assertTrue(result.canGenerate, '2 < 3, should be able to generate');
  });

  test('canGenerate boundary: free at exactly 3', () => {
    const result = usage.checkUsage('user-boundary-3', { generation_count: 3 }, null);
    assertFalse(result.canGenerate, '3 >= 3, should not be able to generate');
  });

  test('remaining never goes negative', () => {
    const result = usage.checkUsage('user-over', { generation_count: 100 }, null);
    assertEqual(result.remaining, 0, 'Remaining should be 0, not negative');
  });
}

// ============================================
// INCREMENT USAGE TESTS
// ============================================

function runIncrementUsageTests() {
  console.log('\n=== incrementUsage Tests ===\n');

  test('anonymous increment stores in memory', () => {
    const ip = `mem-store-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    usage.incrementUsage(null, null, ip);

    const result = usage.checkUsage(null, null, ip);
    assertEqual(result.used, 1, 'Should be stored in memory');
  });

  test('authenticated increment does not modify profile object', () => {
    const profile = { generation_count: 5 };
    usage.incrementUsage('user-no-modify', profile, null);
    assertEqual(profile.generation_count, 5, 'Original profile should not be modified');
  });

  test('increment enforces limit for anonymous', () => {
    // Anonymous limit is 1, so only first increment succeeds
    const ip = `sequential-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result1 = usage.incrementUsage(null, null, ip);
    assertTrue(result1.success, 'First increment should succeed');
    assertEqual(result1.newCount, 1, 'First increment should return 1');

    // Subsequent increments should fail
    for (let i = 2; i <= 5; i++) {
      const result = usage.incrementUsage(null, null, ip);
      assertFalse(result.success, `Increment ${i} should fail (limit reached)`);
      assertEqual(result.newCount, 1, `newCount should stay at 1`);
    }
  });

  test('paid user increment still requires DB update', () => {
    const result = usage.incrementUsage('user-paid', {
      subscription_status: 'active',
      generation_count: 1000
    }, null);
    assertTrue(result.shouldUpdateDb, 'Paid user should still update DB for tracking');
  });
}

// ============================================
// CHECK USAGE TESTS
// ============================================

function runCheckUsageTests() {
  console.log('\n=== checkUsage Return Value Tests ===\n');

  test('checkUsage returns used property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 5 }, null);
    assertExists(result.used, 'Should have used property');
    assertType(result.used, 'number', 'used should be number');
  });

  test('checkUsage returns limit property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null);
    assertExists(result.limit, 'Should have limit property');
  });

  test('checkUsage returns remaining property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 1 }, null);
    assertExists(result.remaining, 'Should have remaining property');
  });

  test('checkUsage returns canGenerate property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null);
    assertExists(result.canGenerate, 'Should have canGenerate property');
    assertType(result.canGenerate, 'boolean', 'canGenerate should be boolean');
  });

  test('checkUsage returns tier property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null);
    assertExists(result.tier, 'Should have tier property');
    assertType(result.tier, 'string', 'tier should be string');
  });

  test('checkUsage returns tierName property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null);
    assertExists(result.tierName, 'Should have tierName property');
    assertType(result.tierName, 'string', 'tierName should be string');
  });

  test('checkUsage for paid user returns unlimited remaining', () => {
    const result = usage.checkUsage('user-paid', { subscription_status: 'active' }, null);
    assertEqual(result.remaining, 'unlimited', 'Paid remaining should be unlimited');
  });
}

// ============================================
// GET ANONYMOUS STATS TESTS
// ============================================

function runAnonymousStatsTests() {
  console.log('\n=== getAnonymousStats Tests ===\n');

  test('getAnonymousStats returns object', () => {
    const stats = usage.getAnonymousStats();
    assertType(stats, 'object', 'Should return object');
  });

  test('getAnonymousStats returns totalTracked property', () => {
    const stats = usage.getAnonymousStats();
    assertExists(stats.totalTracked, 'Should have totalTracked property');
  });

  test('getAnonymousStats totalTracked is a number', () => {
    const stats = usage.getAnonymousStats();
    assertType(stats.totalTracked, 'number', 'totalTracked should be number');
  });

  test('totalTracked is non-negative', () => {
    const stats = usage.getAnonymousStats();
    assertTrue(stats.totalTracked >= 0, 'totalTracked should be >= 0');
  });

  test('totalTracked increases when new IP tracked', () => {
    const before = usage.getAnonymousStats().totalTracked;
    const uniqueIp = `unique-stats-${Date.now()}-${Math.random()}`;
    usage.incrementUsage(null, null, uniqueIp);
    const after = usage.getAnonymousStats().totalTracked;
    assertTrue(after > before, 'totalTracked should increase with new IP');
  });

  test('totalTracked does not increase for existing IP', () => {
    const existingIp = `existing-stats-${Date.now()}`;
    usage.incrementUsage(null, null, existingIp);
    const before = usage.getAnonymousStats().totalTracked;
    usage.incrementUsage(null, null, existingIp);
    const after = usage.getAnonymousStats().totalTracked;
    assertEqual(after, before, 'totalTracked should not change for existing IP');
  });

  test('totalTracked decreases after resetAnonymousUsage', () => {
    const ipToReset = `reset-stats-${Date.now()}`;
    usage.incrementUsage(null, null, ipToReset);
    const before = usage.getAnonymousStats().totalTracked;
    usage.resetAnonymousUsage(ipToReset);
    const after = usage.getAnonymousStats().totalTracked;
    assertEqual(after, before - 1, 'totalTracked should decrease by 1 after reset');
  });
}

// ============================================
// SUBSCRIPTION STATUS EDGE CASES TESTS
// ============================================

function runSubscriptionEdgeCases() {
  console.log('\n=== Subscription Status Edge Cases ===\n');

  test('subscription_status "active" returns paid tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'active' });
    assertEqual(tier, 'paid', 'active should be paid');
  });

  test('subscription_status "cancelled" returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'cancelled' });
    assertEqual(tier, 'free', 'cancelled should be free');
  });

  test('subscription_status "inactive" returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'inactive' });
    assertEqual(tier, 'free', 'inactive should be free');
  });

  test('subscription_status "past_due" returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'past_due' });
    assertEqual(tier, 'free', 'past_due should be free');
  });

  test('subscription_status "trialing" returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'trialing' });
    assertEqual(tier, 'free', 'trialing should be free (only active is paid)');
  });

  test('subscription_status null returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: null });
    assertEqual(tier, 'free', 'null should be free');
  });

  test('subscription_status undefined returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: undefined });
    assertEqual(tier, 'free', 'undefined should be free');
  });

  test('subscription_status empty string returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: '' });
    assertEqual(tier, 'free', 'empty string should be free');
  });

  test('subscription_status "ACTIVE" (uppercase) returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'ACTIVE' });
    assertEqual(tier, 'free', 'ACTIVE (uppercase) should be free - case sensitive');
  });

  test('subscription_status " active " (whitespace) returns free tier', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: ' active ' });
    assertEqual(tier, 'free', 'whitespace around active should be free');
  });
}

// ============================================
// PAID USER UNLIMITED ACCESS TESTS
// ============================================

function runPaidUserTests() {
  console.log('\n=== Paid User Unlimited Access ===\n');

  test('paid user canGenerate with 0 count', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      generation_count: 0
    }, null);
    assertTrue(result.canGenerate, 'Paid should generate with 0 count');
  });

  test('paid user canGenerate with high count', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      generation_count: 10000
    }, null);
    assertTrue(result.canGenerate, 'Paid should generate with 10000 count');
  });

  test('paid user canGenerate with very high count', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      generation_count: Number.MAX_SAFE_INTEGER
    }, null);
    assertTrue(result.canGenerate, 'Paid should generate with max safe integer count');
  });

  test('paid user tier is correctly identified', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active'
    }, null);
    assertEqual(result.tier, 'paid', 'Tier should be paid');
  });

  test('paid user tierName is Pro', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active'
    }, null);
    assertEqual(result.tierName, 'Pro', 'Tier name should be Pro');
  });

  test('paid user used count still tracks correctly', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      generation_count: 42
    }, null);
    assertEqual(result.used, 42, 'Used should still be tracked for analytics');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

function main() {
  console.log('='.repeat(60));
  console.log('Usage Service Unit Tests');
  console.log('='.repeat(60));

  // Run all test suites
  runAnonymousUsageTests();
  runAuthenticatedUsageTests();
  runUsageLimitsTests();
  runIncrementUsageTests();
  runCheckUsageTests();
  runAnonymousStatsTests();
  runSubscriptionEdgeCases();
  runPaidUserTests();

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

main();
