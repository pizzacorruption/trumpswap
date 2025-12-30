/**
 * Unit Tests for Pimp My Epstein Services
 *
 * Tests the generations.js and usage.js services in isolation.
 * Run with: node tests/unit.test.js
 *
 * These tests run without any external dependencies or server.
 */

const assert = require('assert');

// Import services
const generations = require('../services/generations');
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

function assertNull(value, message) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${value}`);
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

// ============================================
// GENERATIONS SERVICE TESTS
// ============================================

function runGenerationsTests() {
  console.log('\n=== Generations Service Tests ===\n');

  // Clear before tests
  generations.clearAll();

  // -------------------------------------------
  // createGeneration Tests
  // -------------------------------------------
  console.log('createGeneration:');

  test('creates generation with unique id', () => {
    const gen = generations.createGeneration('user-123', '/epstein-photos/test.jpg');
    assertExists(gen.id, 'Should have id');
    assertType(gen.id, 'string', 'ID should be string');
    assertEqual(gen.id.length, 32, 'ID should be 32 characters (16 bytes hex)');
  });

  test('creates generation with correct userId', () => {
    const gen = generations.createGeneration('user-456', '/epstein-photos/test.jpg');
    assertEqual(gen.userId, 'user-456', 'Should have correct userId');
  });

  test('creates generation with correct epsteinPhoto', () => {
    const gen = generations.createGeneration('user-789', '/epstein-photos/photo1.jpg');
    assertEqual(gen.epsteinPhoto, '/epstein-photos/photo1.jpg', 'Should have correct epsteinPhoto');
  });

  test('creates generation with pending status', () => {
    const gen = generations.createGeneration('user-test', '/epstein-photos/test.jpg');
    assertEqual(gen.status, generations.STATUS.PENDING, 'Should have pending status');
  });

  test('creates generation with null resultUrl', () => {
    const gen = generations.createGeneration('user-test', '/epstein-photos/test.jpg');
    assertNull(gen.resultUrl, 'resultUrl should be null');
  });

  test('creates generation with null error fields', () => {
    const gen = generations.createGeneration('user-test', '/epstein-photos/test.jpg');
    assertNull(gen.errorCode, 'errorCode should be null');
    assertNull(gen.errorMessage, 'errorMessage should be null');
  });

  test('creates generation with createdAt timestamp', () => {
    const before = new Date().toISOString();
    const gen = generations.createGeneration('user-test', '/epstein-photos/test.jpg');
    const after = new Date().toISOString();

    assertExists(gen.createdAt, 'Should have createdAt');
    assertTrue(gen.createdAt >= before, 'createdAt should be >= before');
    assertTrue(gen.createdAt <= after, 'createdAt should be <= after');
  });

  test('creates generation with null completedAt', () => {
    const gen = generations.createGeneration('user-test', '/epstein-photos/test.jpg');
    assertNull(gen.completedAt, 'completedAt should be null');
  });

  test('generates unique IDs for each generation', () => {
    const gen1 = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const gen2 = generations.createGeneration('user-2', '/epstein-photos/test.jpg');
    assertNotEqual(gen1.id, gen2.id, 'IDs should be unique');
  });

  // -------------------------------------------
  // completeGeneration Tests
  // -------------------------------------------
  console.log('\ncompleteGeneration:');

  test('updates status to completed', () => {
    const gen = generations.createGeneration('user-complete', '/epstein-photos/test.jpg');
    const updated = generations.completeGeneration(gen.id, '/output/result.png');
    assertEqual(updated.status, generations.STATUS.COMPLETED, 'Should have completed status');
  });

  test('sets resultUrl correctly', () => {
    const gen = generations.createGeneration('user-complete', '/epstein-photos/test.jpg');
    const updated = generations.completeGeneration(gen.id, '/output/result123.png');
    assertEqual(updated.resultUrl, '/output/result123.png', 'Should have correct resultUrl');
  });

  test('sets completedAt timestamp', () => {
    const gen = generations.createGeneration('user-complete', '/epstein-photos/test.jpg');
    const updated = generations.completeGeneration(gen.id, '/output/result.png');
    assertExists(updated.completedAt, 'Should have completedAt');
  });

  test('returns null for non-existent id', () => {
    const result = generations.completeGeneration('non-existent-id', '/output/result.png');
    assertNull(result, 'Should return null for non-existent id');
  });

  // -------------------------------------------
  // failGeneration Tests
  // -------------------------------------------
  console.log('\nfailGeneration:');

  test('updates status to failed', () => {
    const gen = generations.createGeneration('user-fail', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'SAFETY_BLOCK', 'Content blocked');
    assertEqual(updated.status, generations.STATUS.FAILED, 'Should have failed status');
  });

  test('sets errorCode correctly', () => {
    const gen = generations.createGeneration('user-fail', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'NO_FACE', 'No face detected');
    assertEqual(updated.errorCode, 'NO_FACE', 'Should have correct errorCode');
  });

  test('sets errorMessage correctly', () => {
    const gen = generations.createGeneration('user-fail', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'TIMEOUT', 'Request timed out');
    assertEqual(updated.errorMessage, 'Request timed out', 'Should have correct errorMessage');
  });

  test('sets completedAt timestamp on failure', () => {
    const gen = generations.createGeneration('user-fail', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'ERROR', 'Something went wrong');
    assertExists(updated.completedAt, 'Should have completedAt');
  });

  test('returns null for non-existent id', () => {
    const result = generations.failGeneration('non-existent-id', 'ERROR', 'Test');
    assertNull(result, 'Should return null for non-existent id');
  });

  // -------------------------------------------
  // getGeneration Tests
  // -------------------------------------------
  console.log('\ngetGeneration:');

  test('retrieves generation by id', () => {
    const gen = generations.createGeneration('user-get', '/epstein-photos/test.jpg');
    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.id, gen.id, 'Should retrieve correct generation');
  });

  test('returns null for non-existent id', () => {
    const result = generations.getGeneration('definitely-not-an-id');
    assertNull(result, 'Should return null for non-existent id');
  });

  // -------------------------------------------
  // getGenerations Tests
  // -------------------------------------------
  console.log('\ngetGenerations:');

  test('returns empty array for user with no generations', () => {
    const result = generations.getGenerations('brand-new-user');
    assertTrue(Array.isArray(result), 'Should return array');
    assertEqual(result.length, 0, 'Should be empty');
  });

  test('returns generations for user', () => {
    // Create a few generations for a specific user
    generations.createGeneration('user-history-1', '/epstein-photos/a.jpg');
    generations.createGeneration('user-history-1', '/epstein-photos/b.jpg');
    generations.createGeneration('user-history-1', '/epstein-photos/c.jpg');

    const result = generations.getGenerations('user-history-1');
    assertEqual(result.length, 3, 'Should return 3 generations');
  });

  test('only returns generations for specified user', () => {
    generations.createGeneration('user-A', '/epstein-photos/a.jpg');
    generations.createGeneration('user-B', '/epstein-photos/b.jpg');

    const resultA = generations.getGenerations('user-A');
    const resultB = generations.getGenerations('user-B');

    // At least 1 for each (may have more from previous tests)
    assertTrue(resultA.length >= 1, 'User A should have generations');
    assertTrue(resultB.length >= 1, 'User B should have generations');

    // Check that userIds match
    assertTrue(resultA.every(g => g.userId === 'user-A'), 'All should be for user A');
    assertTrue(resultB.every(g => g.userId === 'user-B'), 'All should be for user B');
  });

  test('respects limit parameter', () => {
    // Create multiple generations
    for (let i = 0; i < 5; i++) {
      generations.createGeneration('user-limit-test', `/epstein-photos/${i}.jpg`);
    }

    const result = generations.getGenerations('user-limit-test', 2);
    assertEqual(result.length, 2, 'Should respect limit of 2');
  });

  test('returns results sorted by createdAt descending', () => {
    generations.clearAll();

    // Create generations - they may have same timestamp if created quickly
    const gen1 = generations.createGeneration('user-order', '/epstein-photos/first.jpg');
    const gen2 = generations.createGeneration('user-order', '/epstein-photos/second.jpg');

    const result = generations.getGenerations('user-order');

    // Both should be returned
    assertEqual(result.length, 2, 'Should return both generations');

    // Verify the sorting is consistent (by createdAt descending)
    // If timestamps are equal, any consistent order is acceptable
    const timestamp0 = new Date(result[0].createdAt).getTime();
    const timestamp1 = new Date(result[1].createdAt).getTime();
    assertTrue(timestamp0 >= timestamp1, 'First result should have >= timestamp than second');
  });

  // -------------------------------------------
  // STATUS Constants Tests
  // -------------------------------------------
  console.log('\nSTATUS constants:');

  test('has PENDING status', () => {
    assertEqual(generations.STATUS.PENDING, 'pending', 'PENDING should be "pending"');
  });

  test('has COMPLETED status', () => {
    assertEqual(generations.STATUS.COMPLETED, 'completed', 'COMPLETED should be "completed"');
  });

  test('has FAILED status', () => {
    assertEqual(generations.STATUS.FAILED, 'failed', 'FAILED should be "failed"');
  });

  // -------------------------------------------
  // clearAll Tests
  // -------------------------------------------
  console.log('\nclearAll:');

  test('clears all generations', () => {
    generations.createGeneration('user-clear', '/epstein-photos/test.jpg');
    generations.createGeneration('user-clear', '/epstein-photos/test2.jpg');

    generations.clearAll();

    const result = generations.getGenerations('user-clear');
    assertEqual(result.length, 0, 'Should have no generations after clear');
  });
}

// ============================================
// USAGE SERVICE TESTS
// ============================================

function runUsageTests() {
  console.log('\n=== Usage Service Tests ===\n');

  // Reset before tests
  usage.resetAnonymousUsage('test-ip-1');
  usage.resetAnonymousUsage('test-ip-2');

  // -------------------------------------------
  // getUserTier Tests
  // -------------------------------------------
  console.log('getUserTier:');

  test('returns anonymous for null userId', () => {
    const tier = usage.getUserTier(null);
    assertEqual(tier, 'anonymous', 'Should return anonymous');
  });

  test('returns anonymous for undefined userId', () => {
    const tier = usage.getUserTier(undefined);
    assertEqual(tier, 'anonymous', 'Should return anonymous');
  });

  test('returns free for user with no subscription', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: null });
    assertEqual(tier, 'free', 'Should return free');
  });

  test('returns free for user with inactive subscription', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'cancelled' });
    assertEqual(tier, 'free', 'Should return free');
  });

  test('returns paid for user with active subscription', () => {
    const tier = usage.getUserTier('user-123', { subscription_status: 'active' });
    assertEqual(tier, 'paid', 'Should return paid');
  });

  test('returns free for user without profile', () => {
    const tier = usage.getUserTier('user-123', null);
    assertEqual(tier, 'free', 'Should return free');
  });

  // -------------------------------------------
  // checkUsage Tests (Two-Tier System)
  // -------------------------------------------
  console.log('\ncheckUsage:');

  test('anonymous user has total limit of 6 (5 quick + 1 premium)', () => {
    usage.resetAnonymousUsage('check-test-ip');
    const result = usage.checkUsage(null, null, 'check-test-ip', 'quick');
    assertEqual(result.limit, 6, 'Anonymous total limit should be 6');
    assertEqual(result.quickLimit, 5, 'Anonymous quick limit should be 5');
    assertEqual(result.premiumLimit, 1, 'Anonymous premium limit should be 1');
  });

  test('anonymous user starts with 0 used', () => {
    usage.resetAnonymousUsage('fresh-ip');
    const result = usage.checkUsage(null, null, 'fresh-ip', 'quick');
    assertEqual(result.used, 0, 'Should start with 0 used');
    assertEqual(result.quickUsed, 0, 'Should start with 0 quick used');
    assertEqual(result.premiumUsed, 0, 'Should start with 0 premium used');
  });

  test('anonymous user canGenerate is true initially for quick model', () => {
    usage.resetAnonymousUsage('can-gen-ip');
    const result = usage.checkUsage(null, null, 'can-gen-ip', 'quick');
    assertTrue(result.canGenerate, 'Should be able to generate quick initially');
  });

  test('anonymous user canGenerate is true initially for premium model', () => {
    usage.resetAnonymousUsage('can-gen-premium-ip');
    const result = usage.checkUsage(null, null, 'can-gen-premium-ip', 'premium');
    assertTrue(result.canGenerate, 'Should be able to generate premium initially');
  });

  test('free user has limit of 6 (5 quick + 1 premium)', () => {
    const result = usage.checkUsage('user-free', { generation_count: 0, quick_count: 0, premium_count: 0 }, null, 'quick');
    assertEqual(result.limit, 6, 'Free total limit should be 6');
    assertEqual(result.quickLimit, 5, 'Free quick limit should be 5');
    assertEqual(result.premiumLimit, 1, 'Free premium limit should be 1');
  });

  test('base tier user has monthly limit of 50', () => {
    const result = usage.checkUsage('user-base', { tier: 'base', monthly_generation_count: 0 }, null, 'quick');
    assertEqual(result.monthlyLimit, 50, 'Base monthly limit should be 50');
  });

  test('paid user has unlimited limit', () => {
    const result = usage.checkUsage('user-paid', { subscription_status: 'active' }, null, 'quick');
    assertEqual(result.limit, 'unlimited', 'Paid limit should be unlimited');
  });

  test('returns correct tier name', () => {
    const anonymous = usage.checkUsage(null, null, 'tier-name-ip', 'quick');
    assertEqual(anonymous.tierName, 'Anonymous', 'Should return Anonymous');

    const free = usage.checkUsage('user-1', { generation_count: 0 }, null, 'quick');
    assertEqual(free.tierName, 'Free', 'Should return Free');

    const paid = usage.checkUsage('user-2', { subscription_status: 'active' }, null, 'quick');
    assertEqual(paid.tierName, 'Base', 'Should return Base');
  });

  test('calculates quick remaining correctly', () => {
    const result = usage.checkUsage('user-remaining', { quick_count: 2, premium_count: 0 }, null, 'quick');
    assertEqual(result.quickRemaining, 3, 'Should have 3 quick remaining (5 - 2)');
  });

  test('calculates premium remaining correctly', () => {
    const result = usage.checkUsage('user-remaining', { quick_count: 0, premium_count: 0 }, null, 'premium');
    assertEqual(result.premiumRemaining, 1, 'Should have 1 premium remaining (1 - 0)');
  });

  test('canGenerate is false for quick when at quick limit', () => {
    const result = usage.checkUsage('user-at-limit', { quick_count: 5, premium_count: 0 }, null, 'quick');
    assertFalse(result.canGenerate, 'Should not be able to generate quick at limit');
  });

  test('canGenerate is false for premium when at premium limit', () => {
    const result = usage.checkUsage('user-at-limit', { quick_count: 0, premium_count: 1 }, null, 'premium');
    assertFalse(result.canGenerate, 'Should not be able to generate premium at limit');
  });

  test('base tier user canGenerate when under monthly limit', () => {
    const result = usage.checkUsage('user-base', {
      tier: 'base',
      monthly_generation_count: 25
    }, null, 'quick');
    assertTrue(result.canGenerate, 'Base tier should be able to generate under monthly limit');
  });

  test('base tier user cannot generate when at monthly limit', () => {
    const result = usage.checkUsage('user-base', {
      tier: 'base',
      monthly_generation_count: 50,
      credit_balance: 0
    }, null, 'quick');
    assertFalse(result.canGenerate, 'Base tier should not generate at monthly limit without credits');
  });

  test('paid user canGenerate with credits when over monthly limit', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      monthly_generation_count: 50,
      credit_balance: 5
    }, null, 'quick');
    assertTrue(result.canGenerate, 'Paid user should generate with credits over monthly limit');
  });

  test('paid user remaining is unlimited', () => {
    const result = usage.checkUsage('user-paid', {
      subscription_status: 'active',
      generation_count: 1000
    }, null, 'quick');
    assertEqual(result.remaining, 'unlimited', 'Paid remaining should be unlimited');
  });

  test('checkUsage includes modelType in response', () => {
    const result = usage.checkUsage('user-1', { generation_count: 0 }, null, 'premium');
    assertEqual(result.modelType, 'premium', 'Should return modelType in response');
  });

  test('checkUsage includes credit info', () => {
    const result = usage.checkUsage('user-1', { generation_count: 0, credit_balance: 10 }, null, 'quick');
    assertEqual(result.credits, 10, 'Should return credit balance');
  });

  // -------------------------------------------
  // incrementUsage Tests (Two-Tier System)
  // -------------------------------------------
  console.log('\nincrementUsage:');

  test('increments anonymous quick usage in memory', () => {
    usage.resetAnonymousUsage('increment-anon-ip');
    const result1 = usage.incrementUsage(null, null, 'increment-anon-ip', 'quick', false, 0);
    assertEqual(result1.newQuickCount, 1, 'First quick increment should be 1');
    assertEqual(result1.newPremiumCount, 0, 'Premium count should stay 0');
    assertTrue(result1.success, 'First increment should succeed');
  });

  test('increments anonymous premium usage in memory', () => {
    usage.resetAnonymousUsage('increment-premium-ip');
    const result1 = usage.incrementUsage(null, null, 'increment-premium-ip', 'premium', false, 0);
    assertEqual(result1.newQuickCount, 0, 'Quick count should stay 0');
    assertEqual(result1.newPremiumCount, 1, 'First premium increment should be 1');
    assertTrue(result1.success, 'Premium increment should succeed');
  });

  test('anonymous user can use all 5 quick generations', () => {
    usage.resetAnonymousUsage('five-quick-ip');
    for (let i = 1; i <= 5; i++) {
      const result = usage.incrementUsage(null, null, 'five-quick-ip', 'quick', false, 0);
      assertTrue(result.success, `Quick increment ${i} should succeed`);
      assertEqual(result.newQuickCount, i, `Quick count should be ${i}`);
    }
  });

  test('anonymous shouldUpdateDb is false', () => {
    usage.resetAnonymousUsage('should-not-update-ip');
    const result = usage.incrementUsage(null, null, 'should-not-update-ip', 'quick', false, 0);
    assertFalse(result.shouldUpdateDb, 'Should not update DB for anonymous');
  });

  test('authenticated user shouldUpdateDb is true', () => {
    const result = usage.incrementUsage('user-auth', { generation_count: 0, quick_count: 0 }, null, 'quick', false, 0);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertTrue(result.shouldUpdateDb, 'Should update DB for authenticated user');
  });

  test('authenticated user gets correct newCount for quick', () => {
    const result = usage.incrementUsage('user-auth', { generation_count: 0, quick_count: 0 }, null, 'quick', false, 0);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertEqual(result.newCount, 1, 'newCount should be 1 (0 + 1)');
    assertEqual(result.newQuickCount, 1, 'newQuickCount should be 1');
  });

  test('authenticated user gets correct newCount for premium', () => {
    const result = usage.incrementUsage('user-auth', { generation_count: 0, premium_count: 0 }, null, 'premium', false, 0);
    assertTrue(result.success, 'Increment should succeed when under limit');
    assertEqual(result.newCount, 1, 'newCount should be 1 (0 + 1)');
    assertEqual(result.newPremiumCount, 1, 'newPremiumCount should be 1');
  });

  test('handles null profile for authenticated user', () => {
    const result = usage.incrementUsage('user-no-profile', null, null, 'quick', false, 0);
    assertEqual(result.newCount, 1, 'Should start from 0 with null profile');
  });

  test('base tier user increments monthly count', () => {
    const result = usage.incrementUsage('user-base', {
      tier: 'base',
      generation_count: 10,
      monthly_generation_count: 5
    }, null, 'quick', false, 0);
    assertTrue(result.success, 'Should succeed for base tier');
    assertEqual(result.newMonthlyCount, 6, 'Monthly count should increment');
  });

  test('credit usage deducts from credit balance', () => {
    const result = usage.incrementUsage('user-credits', {
      generation_count: 10,
      credit_balance: 5
    }, null, 'quick', true, 1);
    assertTrue(result.success, 'Should succeed with credits');
    assertEqual(result.newCredits, 4, 'Credits should decrease by 1');
    assertEqual(result.usedCredits, 1, 'Should track used credits');
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

  test('insufficient credits returns error', () => {
    const result = usage.incrementUsage('user-low-credits', {
      generation_count: 10,
      credit_balance: 1
    }, null, 'premium', true, 2);
    assertFalse(result.success, 'Should fail with insufficient credits');
    assertEqual(result.error, 'Insufficient credits', 'Should return insufficient credits error');
  });

  // -------------------------------------------
  // resetAnonymousUsage Tests
  // -------------------------------------------
  console.log('\nresetAnonymousUsage:');

  test('resets usage for IP', () => {
    // Use a unique IP to avoid collision with other tests
    const testIp = 'reset-test-ip-' + Date.now();
    usage.incrementUsage(null, null, testIp);
    // Second increment fails (limit 1), but count stays at 1

    let check = usage.checkUsage(null, null, testIp);
    assertEqual(check.used, 1, 'Should have 1 before reset (limit prevents 2)');

    usage.resetAnonymousUsage(testIp);

    check = usage.checkUsage(null, null, testIp);
    assertEqual(check.used, 0, 'Should have 0 after reset');
  });

  // -------------------------------------------
  // getAnonymousStats Tests
  // -------------------------------------------
  console.log('\ngetAnonymousStats:');

  test('returns totalTracked number', () => {
    const stats = usage.getAnonymousStats();
    assertType(stats.totalTracked, 'number', 'totalTracked should be a number');
  });

  test('totalTracked increases with new IPs', () => {
    const before = usage.getAnonymousStats().totalTracked;
    usage.incrementUsage(null, null, `unique-ip-${Date.now()}`);
    const after = usage.getAnonymousStats().totalTracked;
    assertTrue(after > before, 'totalTracked should increase');
  });
}

// ============================================
// TIERS CONFIG TESTS
// ============================================

function runTiersTests() {
  console.log('\n=== Tiers Configuration Tests (Two-Tier System) ===\n');
  console.log('Tier definitions:');

  test('anonymous tier exists', () => {
    assertExists(tiers.anonymous, 'anonymous tier should exist');
  });

  test('anonymous tier has total limit of 6', () => {
    assertEqual(tiers.anonymous.limit, 6, 'anonymous limit should be 6');
  });

  test('anonymous tier has quickLimit of 5', () => {
    assertEqual(tiers.anonymous.quickLimit, 5, 'anonymous quickLimit should be 5');
  });

  test('anonymous tier has premiumLimit of 1', () => {
    assertEqual(tiers.anonymous.premiumLimit, 1, 'anonymous premiumLimit should be 1');
  });

  test('anonymous tier has name', () => {
    assertEqual(tiers.anonymous.name, 'Anonymous', 'anonymous name should be Anonymous');
  });

  test('anonymous tier has watermark', () => {
    assertFalse(tiers.anonymous.watermarkFree, 'anonymous should have watermark');
  });

  test('free tier exists', () => {
    assertExists(tiers.free, 'free tier should exist');
  });

  test('free tier has total limit of 6', () => {
    assertEqual(tiers.free.limit, 6, 'free limit should be 6');
  });

  test('free tier has quickLimit of 5', () => {
    assertEqual(tiers.free.quickLimit, 5, 'free quickLimit should be 5');
  });

  test('free tier has premiumLimit of 1', () => {
    assertEqual(tiers.free.premiumLimit, 1, 'free premiumLimit should be 1');
  });

  test('free tier has name', () => {
    assertEqual(tiers.free.name, 'Free', 'free name should be Free');
  });

  test('free tier can purchase credits', () => {
    assertTrue(tiers.free.canPurchaseCredits, 'free should be able to purchase credits');
  });

  test('base tier exists', () => {
    assertExists(tiers.base, 'base tier should exist');
  });

  test('base tier has unlimited limit', () => {
    assertEqual(tiers.base.limit, Infinity, 'base limit should be Infinity');
  });

  test('base tier has monthlyLimit of 50', () => {
    assertEqual(tiers.base.monthlyLimit, 50, 'base monthlyLimit should be 50');
  });

  test('base tier has name', () => {
    assertEqual(tiers.base.name, 'Base', 'base name should be Base');
  });

  test('base tier is watermark-free', () => {
    assertTrue(tiers.base.watermarkFree, 'base should be watermark-free');
  });

  test('paid tier exists (legacy)', () => {
    assertExists(tiers.paid, 'paid tier should exist');
  });

  test('paid tier has unlimited limit', () => {
    assertEqual(tiers.paid.limit, Infinity, 'paid limit should be Infinity');
  });

  test('paid tier has monthlyLimit of 50', () => {
    assertEqual(tiers.paid.monthlyLimit, 50, 'paid monthlyLimit should be 50');
  });

  test('paid tier has name', () => {
    assertEqual(tiers.paid.name, 'Base', 'paid name should be Base');
  });

  test('all tiers have descriptions', () => {
    assertExists(tiers.anonymous.description, 'anonymous should have description');
    assertExists(tiers.free.description, 'free should have description');
    assertExists(tiers.base.description, 'base should have description');
    assertExists(tiers.paid.description, 'paid should have description');
  });

  test('credit config exists', () => {
    assertExists(tiers.credit, 'credit config should exist');
  });

  test('credit quickCost is 1', () => {
    assertEqual(tiers.credit.quickCost, 1, 'quick cost should be 1 credit');
  });

  test('credit premiumCost is 2', () => {
    assertEqual(tiers.credit.premiumCost, 2, 'premium cost should be 2 credits');
  });

  test('models config exists', () => {
    assertExists(tiers.models, 'models config should exist');
    assertExists(tiers.models.quick, 'quick model should exist');
    assertExists(tiers.models.premium, 'premium model should exist');
  });
}

// ============================================
// ERROR CODE TESTS
// ============================================

function runErrorCodeTests() {
  console.log('\n=== Error Code Handling Tests ===\n');
  console.log('Error codes in generations:');

  test('generation can fail with NO_FACE code', () => {
    generations.clearAll();
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'NO_FACE', 'No face detected');
    assertEqual(updated.errorCode, 'NO_FACE', 'Should store NO_FACE code');
  });

  test('generation can fail with MULTIPLE_FACES code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'MULTIPLE_FACES', 'Multiple faces detected');
    assertEqual(updated.errorCode, 'MULTIPLE_FACES', 'Should store MULTIPLE_FACES code');
  });

  test('generation can fail with IMAGE_TOO_SMALL code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'IMAGE_TOO_SMALL', 'Image too small');
    assertEqual(updated.errorCode, 'IMAGE_TOO_SMALL', 'Should store IMAGE_TOO_SMALL code');
  });

  test('generation can fail with SAFETY_BLOCK code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'SAFETY_BLOCK', 'Content blocked');
    assertEqual(updated.errorCode, 'SAFETY_BLOCK', 'Should store SAFETY_BLOCK code');
  });

  test('generation can fail with RATE_LIMITED code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'RATE_LIMITED', 'Too many requests');
    assertEqual(updated.errorCode, 'RATE_LIMITED', 'Should store RATE_LIMITED code');
  });

  test('generation can fail with TIMEOUT code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'TIMEOUT', 'Request timed out');
    assertEqual(updated.errorCode, 'TIMEOUT', 'Should store TIMEOUT code');
  });

  test('generation can fail with INVALID_FORMAT code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'INVALID_FORMAT', 'Invalid file format');
    assertEqual(updated.errorCode, 'INVALID_FORMAT', 'Should store INVALID_FORMAT code');
  });

  test('generation can fail with GENERATION_FAILED code', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'GENERATION_FAILED', 'Generation failed');
    assertEqual(updated.errorCode, 'GENERATION_FAILED', 'Should store GENERATION_FAILED code');
  });

  test('failed generation preserves error message', () => {
    const gen = generations.createGeneration('error-user', '/epstein-photos/test.jpg');
    const customMessage = 'This is a detailed error message for debugging';
    const updated = generations.failGeneration(gen.id, 'GENERATION_FAILED', customMessage);
    assertEqual(updated.errorMessage, customMessage, 'Should preserve error message');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

function main() {
  console.log('='.repeat(50));
  console.log('Pimp My Epstein Unit Tests');
  console.log('='.repeat(50));
  console.log('');

  // Run all test suites
  runGenerationsTests();
  runUsageTests();
  runTiersTests();
  runErrorCodeTests();

  // Clean up
  generations.clearAll();

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

main();
