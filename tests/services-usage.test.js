/**
 * Usage Service Unit Tests for Pimp My Epstein
 *
 * Tests the usage tracking service (services/usage.js) in isolation.
 * Run with: node tests/services-usage.test.js
 *
 * ============================================
 * USAGE SYSTEM DOCUMENTATION (Two-Tier Model)
 * ============================================
 *
 * The usage tracking system manages generation limits across tiers with
 * separate quick/premium model quotas:
 *
 * 1. ANONYMOUS USERS (tracked by IP address)
 *    - Quick Limit: 5 generations
 *    - Premium Limit: 1 generation
 *    - Total Limit: 6 generations
 *    - Storage: In-memory Map (anonymousUsage) with { quickCount, premiumCount }
 *    - Auto-cleanup: 24-hour TTL on entries
 *    - No database updates required
 *    - Watermarked output
 *
 * 2. FREE USERS (authenticated, no subscription)
 *    - Quick Limit: 5 generations
 *    - Premium Limit: 1 generation
 *    - Total Limit: 6 generations
 *    - Storage: Database (profile.quick_count, profile.premium_count)
 *    - Can purchase credits for additional generations
 *    - Watermarked output
 *
 * 3. BASE TIER ($14.99/mo subscription)
 *    - Monthly Limit: 50 generations (shared pool for any model)
 *    - Storage: Database (profile.monthly_generation_count)
 *    - Monthly reset based on billing cycle
 *    - Can purchase credits when monthly quota exceeded
 *    - Watermark-free output
 *
 * 4. PAID/PRO USERS (legacy, same as Base)
 *    - Same as Base tier for backward compatibility
 *
 * CREDIT SYSTEM:
 * - 1 credit = 1 quick generation
 * - 2 credits = 1 premium generation
 * - Credits can be purchased by Free and Base tier users
 *
 * API CHANGES:
 * - checkUsage(userId, profile, ipAddress, modelType) - 4th param is 'quick' or 'premium'
 * - incrementUsage(userId, profile, ipAddress, modelType, useCredit, creditCost) - 6 params
 *
 * EDGE CASES:
 * - Anonymous users with same IP share the same counts
 * - Authenticated user with null profile treated as free tier with 0 count
 * - Subscription status must be exactly 'active' for base/paid tier
 * - Memory cleanup is TTL-based (24 hours)
 * - Monthly reset is handled when checking/incrementing
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
// ANONYMOUS USAGE TRACKING BY IP TESTS (Two-Tier System)
// ============================================

function runAnonymousUsageTests() {
  console.log('\n=== Anonymous Usage Tracking by IP (Two-Tier System) ===\n');

  // Fresh start for each test section
  const testIp1 = `test-anon-ip-${Date.now()}-1`;
  const testIp2 = `test-anon-ip-${Date.now()}-2`;

  test('new IP address starts with 0 used for both quick and premium', () => {
    const freshIp = `fresh-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, freshIp, 'quick');
    assertEqual(result.used, 0, 'New IP should have 0 total used');
    assertEqual(result.quickUsed, 0, 'New IP should have 0 quick used');
    assertEqual(result.premiumUsed, 0, 'New IP should have 0 premium used');
  });

  test('anonymous users are identified by IP address', () => {
    usage.resetAnonymousUsage(testIp1);
    usage.resetAnonymousUsage(testIp2);

    usage.incrementUsage(null, null, testIp1, 'quick', false, 0);

    const result1 = usage.checkUsage(null, null, testIp1, 'quick');
    const result2 = usage.checkUsage(null, null, testIp2, 'quick');

    assertEqual(result1.quickUsed, 1, 'IP1 should have 1 quick used');
    assertEqual(result2.quickUsed, 0, 'IP2 should have 0 quick used (different IP)');
  });

  test('anonymous can use 5 quick generations', () => {
    const ip = `five-quick-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    for (let i = 1; i <= 5; i++) {
      const r = usage.incrementUsage(null, null, ip, 'quick', false, 0);
      assertTrue(r.success, `Quick increment ${i} should succeed`);
      assertEqual(r.newQuickCount, i, `Quick count should be ${i}`);
    }

    const result = usage.checkUsage(null, null, ip, 'quick');
    assertEqual(result.quickUsed, 5, 'Should have 5 quick used');
    assertFalse(result.canGenerate, 'Should not be able to generate quick at limit');
  });

  test('anonymous can use 1 premium generation', () => {
    const ip = `one-premium-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const r1 = usage.incrementUsage(null, null, ip, 'premium', false, 0);
    assertTrue(r1.success, 'First premium should succeed');
    assertEqual(r1.newPremiumCount, 1, 'Premium count should be 1');

    const result = usage.checkUsage(null, null, ip, 'premium');
    assertEqual(result.premiumUsed, 1, 'Should have 1 premium used');
    assertFalse(result.canGenerate, 'Should not be able to generate premium at limit');
  });

  test('anonymous user tier is correctly identified', () => {
    const ip = `tier-check-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, ip, 'quick');
    assertEqual(result.tier, 'anonymous', 'Tier should be anonymous');
    assertEqual(result.tierName, 'Anonymous', 'Tier name should be Anonymous');
  });

  test('anonymous total usage limit is 6', () => {
    const ip = `limit-check-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, ip, 'quick');
    assertEqual(result.limit, 6, 'Anonymous total limit should be 6');
    assertEqual(result.quickLimit, 5, 'Anonymous quick limit should be 5');
    assertEqual(result.premiumLimit, 1, 'Anonymous premium limit should be 1');
  });

  test('anonymous user can generate quick when under quick limit', () => {
    const ip = `can-gen-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.checkUsage(null, null, ip, 'quick');
    assertTrue(result.canGenerate, 'Should be able to generate quick with 0 used');
    assertEqual(result.quickRemaining, 5, 'Should have 5 quick remaining');
  });

  test('anonymous user can generate premium when under premium limit', () => {
    const ip = `can-gen-premium-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.checkUsage(null, null, ip, 'premium');
    assertTrue(result.canGenerate, 'Should be able to generate premium with 0 used');
    assertEqual(result.premiumRemaining, 1, 'Should have 1 premium remaining');
  });

  test('anonymous cannot generate quick when at quick limit', () => {
    const ip = `at-quick-limit-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    // Use all 5 quick generations
    for (let i = 0; i < 5; i++) {
      usage.incrementUsage(null, null, ip, 'quick', false, 0);
    }

    const result = usage.checkUsage(null, null, ip, 'quick');
    assertFalse(result.canGenerate, 'Should not be able to generate quick at limit');
    assertEqual(result.quickRemaining, 0, 'Should have 0 quick remaining');
  });

  test('anonymous cannot generate premium when at premium limit', () => {
    const ip = `at-premium-limit-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    usage.incrementUsage(null, null, ip, 'premium', false, 0);

    const result = usage.checkUsage(null, null, ip, 'premium');
    assertFalse(result.canGenerate, 'Should not be able to generate premium at limit');
    assertEqual(result.premiumRemaining, 0, 'Should have 0 premium remaining');
  });

  test('quick and premium quotas are independent', () => {
    const ip = `independent-quotas-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    // Use all quick generations
    for (let i = 0; i < 5; i++) {
      usage.incrementUsage(null, null, ip, 'quick', false, 0);
    }

    // Should still have premium available
    const result = usage.checkUsage(null, null, ip, 'premium');
    assertTrue(result.canGenerate, 'Should still be able to generate premium');
    assertEqual(result.premiumRemaining, 1, 'Should have 1 premium remaining');
  });

  test('resetAnonymousUsage clears both quick and premium usage', () => {
    const ip = `reset-ip-${Date.now()}`;

    usage.incrementUsage(null, null, ip, 'quick', false, 0);
    usage.incrementUsage(null, null, ip, 'premium', false, 0);

    let result = usage.checkUsage(null, null, ip, 'quick');
    assertEqual(result.quickUsed, 1, 'Should have 1 quick before reset');
    assertEqual(result.premiumUsed, 1, 'Should have 1 premium before reset');

    usage.resetAnonymousUsage(ip);

    result = usage.checkUsage(null, null, ip, 'quick');
    assertEqual(result.quickUsed, 0, 'Should have 0 quick after reset');
    assertEqual(result.premiumUsed, 0, 'Should have 0 premium after reset');
  });

  test('incrementUsage returns correct counts for quick', () => {
    const ip = `newcount-quick-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.incrementUsage(null, null, ip, 'quick', false, 0);
    assertTrue(result.success, 'Increment should succeed');
    assertEqual(result.newQuickCount, 1, 'Quick count should be 1');
    assertEqual(result.newPremiumCount, 0, 'Premium count should stay 0');
    assertEqual(result.newCount, 1, 'Total count should be 1');
  });

  test('incrementUsage returns correct counts for premium', () => {
    const ip = `newcount-premium-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.incrementUsage(null, null, ip, 'premium', false, 0);
    assertTrue(result.success, 'Increment should succeed');
    assertEqual(result.newQuickCount, 0, 'Quick count should stay 0');
    assertEqual(result.newPremiumCount, 1, 'Premium count should be 1');
    assertEqual(result.newCount, 1, 'Total count should be 1');
  });

  test('incrementUsage returns shouldUpdateDb false for anonymous', () => {
    const ip = `no-db-update-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    const result = usage.incrementUsage(null, null, ip, 'quick', false, 0);
    assertFalse(result.shouldUpdateDb, 'Anonymous should not require DB update');
  });

  test('anonymous users get watermarked output', () => {
    const ip = `watermark-ip-${Date.now()}`;
    const result = usage.checkUsage(null, null, ip, 'quick');
    assertFalse(result.watermarkFree, 'Anonymous should get watermarked output');
  });
}

// ============================================
// AUTHENTICATED USER USAGE TRACKING TESTS (Two-Tier System)
// ============================================

function runAuthenticatedUsageTests() {
  console.log('\n=== Authenticated User Usage Tracking (Two-Tier System) ===\n');

  test('authenticated user with null profile returns free tier', () => {
    const tier = usage.getUserTier('user-123', null);
    assertEqual(tier, 'free', 'Should return free for null profile');
  });

  test('authenticated user with empty profile returns free tier', () => {
    const tier = usage.getUserTier('user-123', {});
    assertEqual(tier, 'free', 'Should return free for empty profile');
  });

  test('free user has correct tier info', () => {
    const result = usage.checkUsage('user-free-1', { generation_count: 0 }, null, 'quick');
    assertEqual(result.tier, 'free', 'Tier should be free');
    assertEqual(result.tierName, 'Free', 'Tier name should be Free');
  });

  test('free user total limit is 6', () => {
    const result = usage.checkUsage('user-free-2', { generation_count: 0 }, null, 'quick');
    assertEqual(result.limit, 6, 'Free total limit should be 6');
    assertEqual(result.quickLimit, 5, 'Free quick limit should be 5');
    assertEqual(result.premiumLimit, 1, 'Free premium limit should be 1');
  });

  test('free user used count comes from profile.generation_count', () => {
    const result = usage.checkUsage('user-gen-count', { generation_count: 3, quick_count: 2, premium_count: 1 }, null, 'quick');
    assertEqual(result.used, 3, 'Used should match profile.generation_count');
    assertEqual(result.quickUsed, 2, 'Quick used should match profile.quick_count');
    assertEqual(result.premiumUsed, 1, 'Premium used should match profile.premium_count');
  });

  test('free user quick remaining is calculated correctly', () => {
    const result = usage.checkUsage('user-remaining', { quick_count: 2, premium_count: 0 }, null, 'quick');
    assertEqual(result.quickRemaining, 3, 'Should have 3 quick remaining (5 - 2)');
  });

  test('free user premium remaining is calculated correctly', () => {
    const result = usage.checkUsage('user-remaining', { quick_count: 0, premium_count: 0 }, null, 'premium');
    assertEqual(result.premiumRemaining, 1, 'Should have 1 premium remaining (1 - 0)');
  });

  test('free user can generate quick when under quick limit', () => {
    const result = usage.checkUsage('user-under', { quick_count: 0 }, null, 'quick');
    assertTrue(result.canGenerate, 'Should be able to generate quick with 0 used');
  });

  test('free user can generate premium when under premium limit', () => {
    const result = usage.checkUsage('user-under', { premium_count: 0 }, null, 'premium');
    assertTrue(result.canGenerate, 'Should be able to generate premium with 0 used');
  });

  test('free user cannot generate quick when at quick limit', () => {
    const result = usage.checkUsage('user-at-limit', { quick_count: 5, credit_balance: 0 }, null, 'quick');
    assertFalse(result.canGenerate, 'Should not be able to generate quick at limit');
    assertEqual(result.quickRemaining, 0, 'Should have 0 quick remaining');
  });

  test('free user cannot generate premium when at premium limit', () => {
    const result = usage.checkUsage('user-at-limit', { premium_count: 1, credit_balance: 0 }, null, 'premium');
    assertFalse(result.canGenerate, 'Should not be able to generate premium at limit');
    assertEqual(result.premiumRemaining, 0, 'Should have 0 premium remaining');
  });

  test('free user can generate with credits when at limit', () => {
    const result = usage.checkUsage('user-credits', { quick_count: 5, credit_balance: 5 }, null, 'quick');
    assertTrue(result.canGenerate, 'Should be able to generate with credits');
    assertTrue(result.useCredit, 'Should indicate credit usage');
    assertEqual(result.creditCost, 1, 'Quick should cost 1 credit');
  });

  test('free user premium costs 2 credits', () => {
    const result = usage.checkUsage('user-credits', { premium_count: 1, credit_balance: 5 }, null, 'premium');
    assertTrue(result.canGenerate, 'Should be able to generate with credits');
    assertTrue(result.useCredit, 'Should indicate credit usage');
    assertEqual(result.creditCost, 2, 'Premium should cost 2 credits');
  });

  test('incrementUsage returns correct newCount for quick', () => {
    const result = usage.incrementUsage('user-auth', { generation_count: 0, quick_count: 0 }, null, 'quick', false, 0);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertEqual(result.newCount, 1, 'Should return profile.generation_count + 1');
    assertEqual(result.newQuickCount, 1, 'Should return profile.quick_count + 1');
  });

  test('incrementUsage returns correct newCount for premium', () => {
    const result = usage.incrementUsage('user-auth', { generation_count: 0, premium_count: 0 }, null, 'premium', false, 0);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertEqual(result.newCount, 1, 'Should return profile.generation_count + 1');
    assertEqual(result.newPremiumCount, 1, 'Should return profile.premium_count + 1');
  });

  test('incrementUsage returns shouldUpdateDb true for authenticated user', () => {
    const result = usage.incrementUsage('user-auth', { generation_count: 0 }, null, 'quick', false, 0);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertTrue(result.shouldUpdateDb, 'Authenticated user should require DB update');
  });

  test('incrementUsage handles null profile generation_count', () => {
    const result = usage.incrementUsage('user-null-count', { generation_count: null }, null, 'quick', false, 0);
    assertEqual(result.newCount, 1, 'Should treat null as 0');
  });

  test('incrementUsage handles missing generation_count property', () => {
    const result = usage.incrementUsage('user-no-count', {}, null, 'quick', false, 0);
    assertEqual(result.newCount, 1, 'Should treat missing as 0');
  });

  test('incrementUsage handles undefined generation_count', () => {
    const result = usage.incrementUsage('user-undefined', { generation_count: undefined }, null, 'quick', false, 0);
    assertEqual(result.newCount, 1, 'Should treat undefined as 0');
  });

  test('free user gets watermarked output', () => {
    const result = usage.checkUsage('user-free', { generation_count: 0 }, null, 'quick');
    assertFalse(result.watermarkFree, 'Free user should get watermarked output');
  });
}

// ============================================
// USAGE LIMITS ENFORCEMENT TESTS (Two-Tier System)
// ============================================

function runUsageLimitsTests() {
  console.log('\n=== Usage Limits Enforcement (Two-Tier System) ===\n');

  test('anonymous limits match tiers config', () => {
    assertEqual(tiers.anonymous.limit, 6, 'Tiers config anonymous total limit should be 6');
    assertEqual(tiers.anonymous.quickLimit, 5, 'Tiers config anonymous quick limit should be 5');
    assertEqual(tiers.anonymous.premiumLimit, 1, 'Tiers config anonymous premium limit should be 1');
    const result = usage.checkUsage(null, null, 'config-check-ip', 'quick');
    assertEqual(result.limit, 6, 'checkUsage should return same total limit');
    assertEqual(result.quickLimit, 5, 'checkUsage should return same quick limit');
    assertEqual(result.premiumLimit, 1, 'checkUsage should return same premium limit');
  });

  test('free limits match tiers config', () => {
    assertEqual(tiers.free.limit, 6, 'Tiers config free total limit should be 6');
    assertEqual(tiers.free.quickLimit, 5, 'Tiers config free quick limit should be 5');
    assertEqual(tiers.free.premiumLimit, 1, 'Tiers config free premium limit should be 1');
    const result = usage.checkUsage('user-config', { generation_count: 0 }, null, 'quick');
    assertEqual(result.limit, 6, 'checkUsage should return same total limit');
    assertEqual(result.quickLimit, 5, 'checkUsage should return same quick limit');
  });

  test('base tier has monthlyLimit of 50', () => {
    assertEqual(tiers.base.monthlyLimit, 50, 'Tiers config base monthly limit should be 50');
    const result = usage.checkUsage('user-base', { tier: 'base', monthly_generation_count: 0 }, null, 'quick');
    assertEqual(result.monthlyLimit, 50, 'checkUsage should return same monthly limit');
  });

  test('paid limit is Infinity in tiers config', () => {
    assertEqual(tiers.paid.limit, Infinity, 'Tiers config paid limit should be Infinity');
  });

  test('paid limit displayed as unlimited string', () => {
    const result = usage.checkUsage('user-paid', { subscription_status: 'active' }, null, 'quick');
    assertEqual(result.limit, 'unlimited', 'Should display as unlimited');
  });

  test('canGenerate boundary: anonymous quick at exactly 0', () => {
    const ip = `boundary-0-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    const result = usage.checkUsage(null, null, ip, 'quick');
    assertTrue(result.canGenerate, '0 < 5, should be able to generate quick');
  });

  test('canGenerate boundary: anonymous quick at exactly 5', () => {
    const ip = `boundary-5-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    for (let i = 0; i < 5; i++) {
      usage.incrementUsage(null, null, ip, 'quick', false, 0);
    }
    const result = usage.checkUsage(null, null, ip, 'quick');
    assertFalse(result.canGenerate, '5 >= 5, should not be able to generate quick');
  });

  test('canGenerate boundary: anonymous premium at exactly 0', () => {
    const ip = `boundary-p0-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    const result = usage.checkUsage(null, null, ip, 'premium');
    assertTrue(result.canGenerate, '0 < 1, should be able to generate premium');
  });

  test('canGenerate boundary: anonymous premium at exactly 1', () => {
    const ip = `boundary-p1-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    usage.incrementUsage(null, null, ip, 'premium', false, 0);
    const result = usage.checkUsage(null, null, ip, 'premium');
    assertFalse(result.canGenerate, '1 >= 1, should not be able to generate premium');
  });

  test('canGenerate boundary: free quick at exactly 0', () => {
    const result = usage.checkUsage('user-boundary-0', { quick_count: 0 }, null, 'quick');
    assertTrue(result.canGenerate, '0 < 5, should be able to generate quick');
  });

  test('canGenerate boundary: free quick at exactly 5', () => {
    const result = usage.checkUsage('user-boundary-5', { quick_count: 5, credit_balance: 0 }, null, 'quick');
    assertFalse(result.canGenerate, '5 >= 5, should not be able to generate quick');
  });

  test('remaining never goes negative', () => {
    const result = usage.checkUsage('user-over', { quick_count: 100, premium_count: 50 }, null, 'quick');
    assertEqual(result.quickRemaining, 0, 'Quick remaining should be 0, not negative');
    assertEqual(result.premiumRemaining, 0, 'Premium remaining should be 0, not negative');
  });

  test('credit costs are correct', () => {
    assertEqual(tiers.credit.quickCost, 1, 'Quick cost should be 1 credit');
    assertEqual(tiers.credit.premiumCost, 2, 'Premium cost should be 2 credits');
  });
}

// ============================================
// INCREMENT USAGE TESTS (Two-Tier System)
// ============================================

function runIncrementUsageTests() {
  console.log('\n=== incrementUsage Tests (Two-Tier System) ===\n');

  test('anonymous quick increment stores in memory', () => {
    const ip = `mem-store-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    usage.incrementUsage(null, null, ip, 'quick', false, 0);

    const result = usage.checkUsage(null, null, ip, 'quick');
    assertEqual(result.quickUsed, 1, 'Quick should be stored in memory');
  });

  test('anonymous premium increment stores in memory', () => {
    const ip = `mem-store-premium-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    usage.incrementUsage(null, null, ip, 'premium', false, 0);

    const result = usage.checkUsage(null, null, ip, 'premium');
    assertEqual(result.premiumUsed, 1, 'Premium should be stored in memory');
  });

  test('authenticated increment does not modify profile object', () => {
    const profile = { generation_count: 5, quick_count: 3, premium_count: 1 };
    usage.incrementUsage('user-no-modify', profile, null, 'quick', false, 0);
    assertEqual(profile.generation_count, 5, 'Original profile should not be modified');
    assertEqual(profile.quick_count, 3, 'Original quick_count should not be modified');
  });

  test('anonymous can use all 5 quick generations sequentially', () => {
    const ip = `sequential-quick-${Date.now()}`;
    usage.resetAnonymousUsage(ip);

    for (let i = 1; i <= 5; i++) {
      const result = usage.incrementUsage(null, null, ip, 'quick', false, 0);
      assertTrue(result.success, `Quick increment ${i} should succeed`);
      assertEqual(result.newQuickCount, i, `newQuickCount should be ${i}`);
    }
  });

  test('base tier increment updates monthly count', () => {
    const result = usage.incrementUsage('user-base', {
      tier: 'base',
      generation_count: 10,
      monthly_generation_count: 5
    }, null, 'quick', false, 0);
    assertTrue(result.success, 'Should succeed for base tier');
    assertEqual(result.newMonthlyCount, 6, 'Monthly count should increment');
  });

  test('base tier increment still requires DB update', () => {
    const result = usage.incrementUsage('user-base', {
      tier: 'base',
      generation_count: 10,
      monthly_generation_count: 5
    }, null, 'quick', false, 0);
    assertTrue(result.shouldUpdateDb, 'Base tier should still update DB for tracking');
  });

  test('credit usage works with incrementUsage', () => {
    const result = usage.incrementUsage('user-credits', {
      generation_count: 10,
      credit_balance: 5
    }, null, 'quick', true, 1);
    assertTrue(result.success, 'Should succeed with credits');
    assertEqual(result.newCredits, 4, 'Credits should decrease by 1');
  });

  test('premium credit usage deducts 2 credits', () => {
    const result = usage.incrementUsage('user-credits', {
      generation_count: 10,
      credit_balance: 5
    }, null, 'premium', true, 2);
    assertTrue(result.success, 'Should succeed with credits');
    assertEqual(result.newCredits, 3, 'Credits should decrease by 2');
    assertEqual(result.usedCredits, 2, 'Should track used credits');
  });

  test('insufficient credits fails increment', () => {
    const result = usage.incrementUsage('user-low-credits', {
      generation_count: 10,
      credit_balance: 1
    }, null, 'premium', true, 2);
    assertFalse(result.success, 'Should fail with insufficient credits');
    assertEqual(result.error, 'Insufficient credits', 'Should return insufficient credits error');
  });

  test('incrementUsage returns modelType', () => {
    const result = usage.incrementUsage('user-model', {
      generation_count: 0
    }, null, 'premium', false, 0);
    assertEqual(result.modelType, 'premium', 'Should return modelType');
  });
}

// ============================================
// CHECK USAGE TESTS (Two-Tier System)
// ============================================

function runCheckUsageTests() {
  console.log('\n=== checkUsage Return Value Tests (Two-Tier System) ===\n');

  test('checkUsage returns used property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 5 }, null, 'quick');
    assertExists(result.used, 'Should have used property');
    assertType(result.used, 'number', 'used should be number');
  });

  test('checkUsage returns limit property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null, 'quick');
    assertExists(result.limit, 'Should have limit property');
  });

  test('checkUsage returns quickUsed and premiumUsed', () => {
    const result = usage.checkUsage('user-check', { quick_count: 2, premium_count: 1 }, null, 'quick');
    assertEqual(result.quickUsed, 2, 'Should have quickUsed property');
    assertEqual(result.premiumUsed, 1, 'Should have premiumUsed property');
  });

  test('checkUsage returns quickLimit and premiumLimit', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null, 'quick');
    assertEqual(result.quickLimit, 5, 'Should have quickLimit property');
    assertEqual(result.premiumLimit, 1, 'Should have premiumLimit property');
  });

  test('checkUsage returns quickRemaining and premiumRemaining', () => {
    const result = usage.checkUsage('user-check', { quick_count: 2, premium_count: 0 }, null, 'quick');
    assertEqual(result.quickRemaining, 3, 'Should have quickRemaining property (5 - 2 = 3)');
    assertEqual(result.premiumRemaining, 1, 'Should have premiumRemaining property');
  });

  test('checkUsage returns remaining property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 1 }, null, 'quick');
    assertExists(result.remaining, 'Should have remaining property');
  });

  test('checkUsage returns canGenerate property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null, 'quick');
    assertExists(result.canGenerate, 'Should have canGenerate property');
    assertType(result.canGenerate, 'boolean', 'canGenerate should be boolean');
  });

  test('checkUsage returns tier property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null, 'quick');
    assertExists(result.tier, 'Should have tier property');
    assertType(result.tier, 'string', 'tier should be string');
  });

  test('checkUsage returns tierName property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null, 'quick');
    assertExists(result.tierName, 'Should have tierName property');
    assertType(result.tierName, 'string', 'tierName should be string');
  });

  test('checkUsage returns modelType property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0 }, null, 'premium');
    assertEqual(result.modelType, 'premium', 'Should return modelType');
  });

  test('checkUsage returns credits property', () => {
    const result = usage.checkUsage('user-check', { generation_count: 0, credit_balance: 10 }, null, 'quick');
    assertEqual(result.credits, 10, 'Should return credit balance');
  });

  test('checkUsage returns useCredit and creditCost properties', () => {
    const result = usage.checkUsage('user-check', { quick_count: 5, credit_balance: 5 }, null, 'quick');
    assertTrue(result.useCredit, 'Should return useCredit when at limit with credits');
    assertEqual(result.creditCost, 1, 'Should return creditCost for quick');
  });

  test('checkUsage returns watermarkFree property', () => {
    const freeResult = usage.checkUsage('user-free', { generation_count: 0 }, null, 'quick');
    assertFalse(freeResult.watermarkFree, 'Free user should not be watermark-free');

    const baseResult = usage.checkUsage('user-base', { tier: 'base' }, null, 'quick');
    assertTrue(baseResult.watermarkFree, 'Base user should be watermark-free');
  });

  test('checkUsage for paid user returns unlimited remaining', () => {
    const result = usage.checkUsage('user-paid', { subscription_status: 'active' }, null, 'quick');
    assertEqual(result.remaining, 'unlimited', 'Paid remaining should be unlimited');
  });

  test('checkUsage returns monthly info for base tier', () => {
    const result = usage.checkUsage('user-base', { tier: 'base', monthly_generation_count: 10 }, null, 'quick');
    assertEqual(result.monthlyUsed, 10, 'Should return monthlyUsed');
    assertEqual(result.monthlyLimit, 50, 'Should return monthlyLimit');
    assertEqual(result.monthlyRemaining, 40, 'Should return monthlyRemaining');
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
    usage.incrementUsage(null, null, uniqueIp, 'quick', false, 0);
    const after = usage.getAnonymousStats().totalTracked;
    assertTrue(after > before, 'totalTracked should increase with new IP');
  });

  test('totalTracked does not increase for existing IP', () => {
    const existingIp = `existing-stats-${Date.now()}`;
    usage.incrementUsage(null, null, existingIp, 'quick', false, 0);
    const before = usage.getAnonymousStats().totalTracked;
    usage.incrementUsage(null, null, existingIp, 'quick', false, 0);
    const after = usage.getAnonymousStats().totalTracked;
    assertEqual(after, before, 'totalTracked should not change for existing IP');
  });

  test('totalTracked decreases after resetAnonymousUsage', () => {
    const ipToReset = `reset-stats-${Date.now()}`;
    usage.incrementUsage(null, null, ipToReset, 'quick', false, 0);
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
// PAID/BASE USER ACCESS TESTS (Two-Tier System)
// ============================================

function runPaidUserTests() {
  console.log('\n=== Paid/Base User Access (Two-Tier System) ===\n');

  test('paid user canGenerate quick with 0 monthly count', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      monthly_generation_count: 0
    }, null, 'quick');
    assertTrue(result.canGenerate, 'Paid should generate quick with 0 monthly count');
  });

  test('paid user canGenerate premium with 0 monthly count', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      monthly_generation_count: 0
    }, null, 'premium');
    assertTrue(result.canGenerate, 'Paid should generate premium with 0 monthly count');
  });

  test('paid user canGenerate when under monthly limit', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      monthly_generation_count: 25
    }, null, 'quick');
    assertTrue(result.canGenerate, 'Paid should generate when under monthly limit');
    assertEqual(result.monthlyRemaining, 25, 'Should have 25 monthly remaining');
  });

  test('base tier user cannot generate at monthly limit without credits', () => {
    const result = usage.checkUsage('user-base', {
      tier: 'base',
      monthly_generation_count: 50,
      credit_balance: 0
    }, null, 'quick');
    assertFalse(result.canGenerate, 'Base should not generate at monthly limit without credits');
  });

  test('base tier user can generate at monthly limit with credits', () => {
    const result = usage.checkUsage('user-base', {
      tier: 'base',
      monthly_generation_count: 50,
      credit_balance: 5
    }, null, 'quick');
    assertTrue(result.canGenerate, 'Base should generate with credits over monthly limit');
    assertTrue(result.useCredit, 'Should indicate credit usage');
  });

  test('paid user tier is correctly identified', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active'
    }, null, 'quick');
    assertEqual(result.tier, 'paid', 'Tier should be paid');
  });

  test('base user tier is correctly identified', () => {
    const result = usage.checkUsage('user-base', {
      tier: 'base'
    }, null, 'quick');
    assertEqual(result.tier, 'base', 'Tier should be base');
  });

  test('paid user tierName is Base', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active'
    }, null, 'quick');
    assertEqual(result.tierName, 'Base', 'Tier name should be Base');
  });

  test('paid user monthly used count tracks correctly', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      monthly_generation_count: 42
    }, null, 'quick');
    assertEqual(result.monthlyUsed, 42, 'Monthly used should be tracked');
  });

  test('paid user is watermark-free', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active'
    }, null, 'quick');
    assertTrue(result.watermarkFree, 'Paid user should be watermark-free');
  });

  test('base tier uses shared pool for quick and premium', () => {
    // Both quick and premium draw from the same monthly pool of 50
    const quickResult = usage.checkUsage('user-base', {
      tier: 'base',
      monthly_generation_count: 25
    }, null, 'quick');
    const premiumResult = usage.checkUsage('user-base', {
      tier: 'base',
      monthly_generation_count: 25
    }, null, 'premium');

    assertEqual(quickResult.monthlyRemaining, 25, 'Quick should see 25 remaining from shared pool');
    assertEqual(premiumResult.monthlyRemaining, 25, 'Premium should see 25 remaining from shared pool');
  });
}

// ============================================
// CREDIT SYSTEM TESTS
// ============================================

function runCreditSystemTests() {
  console.log('\n=== Credit System Tests ===\n');

  test('getCreditCost returns 1 for quick', () => {
    assertEqual(usage.getCreditCost('quick'), 1, 'Quick should cost 1 credit');
  });

  test('getCreditCost returns 2 for premium', () => {
    assertEqual(usage.getCreditCost('premium'), 2, 'Premium should cost 2 credits');
  });

  test('getCreditBalance returns 0 for null profile', () => {
    assertEqual(usage.getCreditBalance(null), 0, 'Null profile should have 0 credits');
  });

  test('getCreditBalance returns correct balance', () => {
    assertEqual(usage.getCreditBalance({ credit_balance: 15 }), 15, 'Should return credit_balance');
  });

  test('free user can use credits when at limit', () => {
    const result = usage.checkUsage('user-credits', { quick_count: 5, credit_balance: 3 }, null, 'quick');
    assertTrue(result.canGenerate, 'Should be able to generate with credits');
    assertTrue(result.useCredit, 'Should indicate credit usage');
    assertEqual(result.creditCost, 1, 'Quick should cost 1 credit');
  });

  test('free user cannot use credits for premium if insufficient', () => {
    const result = usage.checkUsage('user-low-credits', { premium_count: 1, credit_balance: 1 }, null, 'premium');
    assertFalse(result.canGenerate, 'Should not generate with insufficient credits (needs 2, has 1)');
  });

  test('anonymous user cannot use credits', () => {
    const ip = `anon-credits-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    // Use all quick
    for (let i = 0; i < 5; i++) {
      usage.incrementUsage(null, null, ip, 'quick', false, 0);
    }
    const result = usage.checkUsage(null, null, ip, 'quick');
    assertFalse(result.canGenerate, 'Anonymous should not generate at limit even with credits');
  });

  test('credit deduction works correctly', () => {
    const result = usage.incrementUsage('user-credits', {
      generation_count: 10,
      credit_balance: 10
    }, null, 'premium', true, 2);
    assertTrue(result.success, 'Should succeed with credits');
    assertEqual(result.newCredits, 8, 'Credits should be deducted (10 - 2 = 8)');
    assertEqual(result.usedCredits, 2, 'Should track used credits');
  });
}

// ============================================
// CHECK MODEL USAGE TESTS
// ============================================

function runCheckModelUsageTests() {
  console.log('\n=== checkModelUsage Tests ===\n');

  test('checkModelUsage returns canGenerate for quick under limit', () => {
    const result = usage.checkModelUsage('user-1', { quick_count: 0 }, 'quick', null);
    assertTrue(result.canGenerate, 'Should be able to generate quick under limit');
  });

  test('checkModelUsage returns canGenerate for premium under limit', () => {
    const result = usage.checkModelUsage('user-1', { premium_count: 0 }, 'premium', null);
    assertTrue(result.canGenerate, 'Should be able to generate premium under limit');
  });

  test('checkModelUsage returns useCredit when at limit with credits', () => {
    const result = usage.checkModelUsage('user-1', { quick_count: 5, credit_balance: 5 }, 'quick', null);
    assertTrue(result.canGenerate, 'Should be able to generate with credits');
    assertTrue(result.useCredit, 'Should indicate credit usage');
    assertEqual(result.creditCost, 1, 'Quick should cost 1 credit');
  });

  test('checkModelUsage returns reason string', () => {
    const result = usage.checkModelUsage('user-1', { quick_count: 0 }, 'quick', null);
    assertExists(result.reason, 'Should have reason property');
    assertType(result.reason, 'string', 'reason should be string');
  });

  test('checkModelUsage for base tier uses monthly pool', () => {
    const result = usage.checkModelUsage('user-base', { tier: 'base', monthly_generation_count: 25 }, 'quick', null);
    assertTrue(result.canGenerate, 'Base tier should generate from monthly pool');
    assertFalse(result.useCredit, 'Should not use credits under monthly limit');
  });

  test('checkModelUsage for base tier at monthly limit with credits', () => {
    const result = usage.checkModelUsage('user-base', { tier: 'base', monthly_generation_count: 50, credit_balance: 5 }, 'quick', null);
    assertTrue(result.canGenerate, 'Base tier should generate with credits over limit');
    assertTrue(result.useCredit, 'Should indicate credit usage');
  });

  test('checkModelUsage for anonymous uses IP-based tracking', () => {
    const ip = `model-usage-ip-${Date.now()}`;
    usage.resetAnonymousUsage(ip);
    const result = usage.checkModelUsage(null, null, 'quick', ip);
    assertTrue(result.canGenerate, 'Anonymous should be able to generate');
    assertFalse(result.useCredit, 'Anonymous should not use credits');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

function main() {
  console.log('='.repeat(60));
  console.log('Usage Service Unit Tests (Two-Tier System)');
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
  runCreditSystemTests();
  runCheckModelUsageTests();

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
