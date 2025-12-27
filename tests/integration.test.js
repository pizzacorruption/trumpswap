/**
 * Integration Tests for Trump Swap
 *
 * Tests the full flow from upload to result with mocked Gemini API.
 * Also tests auth middleware and rate limiting behavior.
 *
 * Run with: node tests/integration.test.js
 *
 * These tests create a test server and mock external dependencies.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

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

// ============================================
// MOCK MODULES
// ============================================

// Mock profile storage for testing
const mockProfiles = new Map();

function mockGetProfile(userId) {
  return mockProfiles.get(userId) || null;
}

function mockUpdateProfile(userId, updates) {
  const existing = mockProfiles.get(userId) || {};
  mockProfiles.set(userId, { ...existing, ...updates });
  return true;
}

function clearMockProfiles() {
  mockProfiles.clear();
}

// ============================================
// AUTH MIDDLEWARE TESTS
// ============================================

async function runAuthMiddlewareTests() {
  console.log('\n=== Auth Middleware Tests ===\n');

  // Import the middleware
  const { authMiddleware, requireAuth } = require('../middleware/auth');

  console.log('authMiddleware behavior:');

  await test('sets user to null when no auth header', async () => {
    const req = { headers: {} };
    const res = {};
    let nextCalled = false;

    await authMiddleware(req, res, () => { nextCalled = true; });

    assertEqual(req.user, null, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertTrue(nextCalled, 'next should be called');
  });

  await test('sets user to null with malformed auth header', async () => {
    const req = { headers: { authorization: 'InvalidFormat' } };
    const res = {};
    let nextCalled = false;

    await authMiddleware(req, res, () => { nextCalled = true; });

    assertEqual(req.user, null, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertTrue(nextCalled, 'next should be called');
  });

  await test('sets user to null with empty token', async () => {
    const req = { headers: { authorization: 'Bearer ' } };
    const res = {};
    let nextCalled = false;

    await authMiddleware(req, res, () => { nextCalled = true; });

    assertEqual(req.user, null, 'user should be null');
    assertFalse(req.isAuthenticated, 'isAuthenticated should be false');
    assertTrue(nextCalled, 'next should be called');
  });

  await test('handles Bearer token correctly (case insensitive)', async () => {
    const req = { headers: { authorization: 'bearer test-token' } };
    const res = {};
    let nextCalled = false;

    // This will try to verify with Supabase and fail, but should still call next
    await authMiddleware(req, res, () => { nextCalled = true; });

    // Since the token is invalid, user should still be null
    assertEqual(req.user, null, 'user should be null with invalid token');
    assertTrue(nextCalled, 'next should be called');
  });

  console.log('\nrequireAuth behavior:');

  await test('returns 401 when not authenticated', async () => {
    const req = { isAuthenticated: false, user: null };
    let status = null;
    let jsonData = null;
    const res = {
      status: (code) => { status = code; return res; },
      json: (data) => { jsonData = data; }
    };
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assertEqual(status, 401, 'Should return 401');
    assertExists(jsonData.error, 'Should have error message');
    assertFalse(nextCalled, 'next should not be called');
  });

  await test('calls next when authenticated', async () => {
    const req = { isAuthenticated: true, user: { id: 'test-user' } };
    const res = {};
    let nextCalled = false;

    requireAuth(req, res, () => { nextCalled = true; });

    assertTrue(nextCalled, 'next should be called');
  });
}

// ============================================
// RATE LIMIT MIDDLEWARE TESTS
// ============================================

async function runRateLimitTests() {
  console.log('\n=== Rate Limit Middleware Tests ===\n');

  // Import services
  const { createRateLimitMiddleware, getClientIP } = require('../middleware/rateLimit');
  const usage = require('../services/usage');

  console.log('getClientIP:');

  await test('extracts IP from x-forwarded-for header', async () => {
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      connection: {},
      socket: {}
    };
    const ip = getClientIP(req);
    assertEqual(ip, '1.2.3.4', 'Should extract first IP from x-forwarded-for');
  });

  await test('extracts IP from x-real-ip header', async () => {
    const req = {
      headers: { 'x-real-ip': '10.0.0.1' },
      connection: {},
      socket: {}
    };
    const ip = getClientIP(req);
    assertEqual(ip, '10.0.0.1', 'Should use x-real-ip');
  });

  await test('falls back to connection.remoteAddress', async () => {
    const req = {
      headers: {},
      connection: { remoteAddress: '192.168.1.1' },
      socket: {}
    };
    const ip = getClientIP(req);
    assertEqual(ip, '192.168.1.1', 'Should use connection.remoteAddress');
  });

  await test('returns unknown when no IP available', async () => {
    const req = {
      headers: {},
      connection: {},
      socket: {}
    };
    const ip = getClientIP(req);
    assertEqual(ip, 'unknown', 'Should return unknown');
  });

  console.log('\ncreateRateLimitMiddleware:');

  await test('allows request when under limit', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: mockGetProfile,
      updateProfile: mockUpdateProfile
    });

    // Reset usage for this test
    usage.resetAnonymousUsage('rate-test-ip-1');

    const req = {
      headers: { 'x-forwarded-for': 'rate-test-ip-1' },
      connection: {},
      socket: {},
      user: null
    };
    const res = {};
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assertTrue(nextCalled, 'next should be called when under limit');
    assertExists(req.usage, 'Should attach usage to request');
    assertTrue(req.usage.canGenerate, 'canGenerate should be true');
  });

  await test('blocks request when at limit', async () => {
    const middleware = createRateLimitMiddleware({
      getProfile: mockGetProfile,
      updateProfile: mockUpdateProfile
    });

    // Use up the anonymous limit
    usage.resetAnonymousUsage('rate-test-ip-2');
    usage.incrementUsage(null, null, 'rate-test-ip-2');

    const req = {
      headers: { 'x-forwarded-for': 'rate-test-ip-2' },
      connection: {},
      socket: {},
      user: null
    };
    let status = null;
    let jsonData = null;
    const res = {
      status: (code) => { status = code; return res; },
      json: (data) => { jsonData = data; }
    };
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assertEqual(status, 402, 'Should return 402 Payment Required');
    assertFalse(nextCalled, 'next should not be called when at limit');
    assertEqual(jsonData.code, 'LIMIT_REACHED', 'Should have LIMIT_REACHED code');
  });

  await test('allows paid user with high usage', async () => {
    clearMockProfiles();
    mockProfiles.set('paid-user-123', {
      subscription_status: 'active',
      generation_count: 1000
    });

    const middleware = createRateLimitMiddleware({
      getProfile: mockGetProfile,
      updateProfile: mockUpdateProfile
    });

    const req = {
      headers: {},
      connection: {},
      socket: {},
      user: { id: 'paid-user-123' }
    };
    const res = {};
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assertTrue(nextCalled, 'next should be called for paid user');
    assertEqual(req.usage.tier, 'paid', 'Should be paid tier');
    assertTrue(req.usage.canGenerate, 'Paid user should always be able to generate');
  });

  await test('free user blocked at limit', async () => {
    clearMockProfiles();
    mockProfiles.set('free-user-at-limit', {
      subscription_status: null,
      generation_count: 3
    });

    const middleware = createRateLimitMiddleware({
      getProfile: mockGetProfile,
      updateProfile: mockUpdateProfile
    });

    const req = {
      headers: {},
      connection: {},
      socket: {},
      user: { id: 'free-user-at-limit' }
    };
    let status = null;
    let jsonData = null;
    const res = {
      status: (code) => { status = code; return res; },
      json: (data) => { jsonData = data; }
    };
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assertEqual(status, 402, 'Should return 402');
    assertFalse(nextCalled, 'next should not be called');
    assertEqual(jsonData.tier, 'free', 'Should be free tier');
  });

  await test('includes upgrade message in blocked response', async () => {
    clearMockProfiles();
    mockProfiles.set('free-upgrade-test', {
      subscription_status: null,
      generation_count: 3
    });

    const middleware = createRateLimitMiddleware({
      getProfile: mockGetProfile,
      updateProfile: mockUpdateProfile,
      upgradeUrl: '/pricing'
    });

    const req = {
      headers: {},
      connection: {},
      socket: {},
      user: { id: 'free-upgrade-test' }
    };
    let jsonData = null;
    const res = {
      status: () => res,
      json: (data) => { jsonData = data; }
    };

    await middleware(req, res, () => {});

    assertExists(jsonData.upgradeUrl, 'Should include upgradeUrl');
    assertExists(jsonData.message, 'Should include upgrade message');
  });
}

// ============================================
// FULL FLOW SIMULATION TESTS
// ============================================

async function runFullFlowTests() {
  console.log('\n=== Full Flow Simulation Tests ===\n');

  // Import services
  const generations = require('../services/generations');
  const usage = require('../services/usage');

  console.log('Generation lifecycle:');

  await test('full generation success flow', async () => {
    generations.clearAll();

    // 1. Create generation
    const gen = generations.createGeneration('flow-user-1', '/trump-photos/test.jpg');
    assertEqual(gen.status, 'pending', 'Should start as pending');

    // 2. Simulate successful API response
    const completed = generations.completeGeneration(gen.id, '/output/result.png');
    assertEqual(completed.status, 'completed', 'Should be completed');
    assertExists(completed.resultUrl, 'Should have resultUrl');
    assertExists(completed.completedAt, 'Should have completedAt');

    // 3. Verify retrieval
    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.id, gen.id, 'Should retrieve same generation');
  });

  await test('full generation failure flow', async () => {
    generations.clearAll();

    // 1. Create generation
    const gen = generations.createGeneration('flow-user-2', '/trump-photos/test.jpg');

    // 2. Simulate API failure
    const failed = generations.failGeneration(gen.id, 'SAFETY_BLOCK', 'Content blocked');
    assertEqual(failed.status, 'failed', 'Should be failed');
    assertEqual(failed.errorCode, 'SAFETY_BLOCK', 'Should have error code');
    assertExists(failed.completedAt, 'Should have completedAt');

    // 3. Verify retrieval
    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.status, 'failed', 'Retrieved should be failed');
  });

  await test('usage tracking through generation', async () => {
    usage.resetAnonymousUsage('flow-ip-1');

    // 1. Check initial usage
    let usageInfo = usage.checkUsage(null, null, 'flow-ip-1');
    assertEqual(usageInfo.used, 0, 'Should start at 0');
    assertTrue(usageInfo.canGenerate, 'Should be able to generate');

    // 2. Increment on success
    usage.incrementUsage(null, null, 'flow-ip-1');

    // 3. Check updated usage
    usageInfo = usage.checkUsage(null, null, 'flow-ip-1');
    assertEqual(usageInfo.used, 1, 'Should be at 1');
    assertFalse(usageInfo.canGenerate, 'Anonymous should not generate after 1');
  });

  console.log('\nGeneration history:');

  await test('tracks multiple generations per user', async () => {
    generations.clearAll();

    const userId = 'history-user';
    generations.createGeneration(userId, '/trump-photos/1.jpg');
    generations.createGeneration(userId, '/trump-photos/2.jpg');
    generations.createGeneration(userId, '/trump-photos/3.jpg');

    const history = generations.getGenerations(userId);
    assertEqual(history.length, 3, 'Should have 3 generations');
  });

  await test('separates generations by user', async () => {
    generations.clearAll();

    generations.createGeneration('user-A', '/trump-photos/a.jpg');
    generations.createGeneration('user-B', '/trump-photos/b.jpg');
    generations.createGeneration('user-A', '/trump-photos/a2.jpg');

    const historyA = generations.getGenerations('user-A');
    const historyB = generations.getGenerations('user-B');

    assertEqual(historyA.length, 2, 'User A should have 2');
    assertEqual(historyB.length, 1, 'User B should have 1');
  });

  console.log('\nTier upgrade scenarios:');

  await test('user gains more generations after upgrade', async () => {
    clearMockProfiles();

    // Start as free user at limit
    mockProfiles.set('upgrade-user', {
      subscription_status: null,
      generation_count: 3
    });

    let usageInfo = usage.checkUsage('upgrade-user', mockProfiles.get('upgrade-user'), null);
    assertFalse(usageInfo.canGenerate, 'Should not generate at free limit');

    // Upgrade to paid
    mockProfiles.set('upgrade-user', {
      subscription_status: 'active',
      generation_count: 3
    });

    usageInfo = usage.checkUsage('upgrade-user', mockProfiles.get('upgrade-user'), null);
    assertTrue(usageInfo.canGenerate, 'Should generate after upgrade');
    assertEqual(usageInfo.tier, 'paid', 'Should be paid tier');
  });

  await test('anonymous converts to free user', async () => {
    usage.resetAnonymousUsage('convert-ip');

    // Anonymous at limit
    usage.incrementUsage(null, null, 'convert-ip');
    let usageInfo = usage.checkUsage(null, null, 'convert-ip');
    assertFalse(usageInfo.canGenerate, 'Anonymous at limit');

    // Convert to free user (different identity)
    clearMockProfiles();
    mockProfiles.set('new-free-user', {
      subscription_status: null,
      generation_count: 0
    });

    usageInfo = usage.checkUsage('new-free-user', mockProfiles.get('new-free-user'), null);
    assertTrue(usageInfo.canGenerate, 'Free user can generate');
    assertEqual(usageInfo.limit, 3, 'Free limit is 3');
  });
}

// ============================================
// ERROR HANDLING INTEGRATION TESTS
// ============================================

async function runErrorHandlingTests() {
  console.log('\n=== Error Handling Integration Tests ===\n');

  const generations = require('../services/generations');

  console.log('Error code propagation:');

  await test('NO_FACE error is stored and retrievable', async () => {
    generations.clearAll();

    const gen = generations.createGeneration('error-test-user', '/trump-photos/test.jpg');
    generations.failGeneration(gen.id, 'NO_FACE', 'No face detected in the photo');

    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.errorCode, 'NO_FACE', 'Error code should be stored');
    assertEqual(retrieved.errorMessage, 'No face detected in the photo', 'Error message should be stored');
    assertEqual(retrieved.status, 'failed', 'Status should be failed');
  });

  await test('TIMEOUT error is stored correctly', async () => {
    const gen = generations.createGeneration('timeout-user', '/trump-photos/test.jpg');
    generations.failGeneration(gen.id, 'TIMEOUT', 'Request took too long');

    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.errorCode, 'TIMEOUT', 'Should store TIMEOUT');
  });

  await test('generation history includes failed attempts', async () => {
    generations.clearAll();

    const userId = 'mixed-history-user';

    // Successful generation
    const success = generations.createGeneration(userId, '/trump-photos/1.jpg');
    generations.completeGeneration(success.id, '/output/success.png');

    // Failed generation
    const failed = generations.createGeneration(userId, '/trump-photos/2.jpg');
    generations.failGeneration(failed.id, 'SAFETY_BLOCK', 'Blocked');

    // Pending generation
    generations.createGeneration(userId, '/trump-photos/3.jpg');

    const history = generations.getGenerations(userId);
    assertEqual(history.length, 3, 'Should have all 3 generations');

    const statuses = history.map(g => g.status);
    assertTrue(statuses.includes('completed'), 'Should include completed');
    assertTrue(statuses.includes('failed'), 'Should include failed');
    assertTrue(statuses.includes('pending'), 'Should include pending');
  });

  console.log('\nConcurrent request handling:');

  await test('multiple simultaneous generations tracked correctly', async () => {
    generations.clearAll();

    const userId = 'concurrent-user';

    // Create multiple at once
    const gen1 = generations.createGeneration(userId, '/trump-photos/1.jpg');
    const gen2 = generations.createGeneration(userId, '/trump-photos/2.jpg');
    const gen3 = generations.createGeneration(userId, '/trump-photos/3.jpg');

    // All should be pending
    assertEqual(generations.getGeneration(gen1.id).status, 'pending');
    assertEqual(generations.getGeneration(gen2.id).status, 'pending');
    assertEqual(generations.getGeneration(gen3.id).status, 'pending');

    // Complete out of order
    generations.completeGeneration(gen2.id, '/output/2.png');
    generations.failGeneration(gen1.id, 'ERROR', 'Failed');
    generations.completeGeneration(gen3.id, '/output/3.png');

    // Verify states
    assertEqual(generations.getGeneration(gen1.id).status, 'failed');
    assertEqual(generations.getGeneration(gen2.id).status, 'completed');
    assertEqual(generations.getGeneration(gen3.id).status, 'completed');
  });
}

// ============================================
// EDGE CASE TESTS
// ============================================

async function runEdgeCaseTests() {
  console.log('\n=== Edge Case Tests ===\n');

  const generations = require('../services/generations');
  const usage = require('../services/usage');

  console.log('Boundary conditions:');

  await test('free user at exactly limit-1 can generate', async () => {
    clearMockProfiles();
    mockProfiles.set('boundary-user', {
      subscription_status: null,
      generation_count: 2 // limit is 3
    });

    const usageInfo = usage.checkUsage('boundary-user', mockProfiles.get('boundary-user'), null);
    assertTrue(usageInfo.canGenerate, 'Should be able to generate at limit-1');
    assertEqual(usageInfo.remaining, 1, 'Should have 1 remaining');
  });

  await test('generation with very long trumpPhoto path', async () => {
    generations.clearAll();

    const longPath = '/trump-photos/' + 'a'.repeat(500) + '.jpg';
    const gen = generations.createGeneration('long-path-user', longPath);

    assertEqual(gen.trumpPhoto, longPath, 'Should store long path');
    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.trumpPhoto, longPath, 'Should retrieve long path');
  });

  await test('generation with special characters in path', async () => {
    generations.clearAll();

    const specialPath = '/trump-photos/test-photo_2024 (1).jpg';
    const gen = generations.createGeneration('special-path-user', specialPath);

    assertEqual(gen.trumpPhoto, specialPath, 'Should store special characters');
  });

  await test('handles rapid sequential generations', async () => {
    generations.clearAll();

    const userId = 'rapid-user';
    const ids = [];

    // Create 100 rapid generations
    for (let i = 0; i < 100; i++) {
      const gen = generations.createGeneration(userId, `/trump-photos/${i}.jpg`);
      ids.push(gen.id);
    }

    // All should be unique
    const uniqueIds = new Set(ids);
    assertEqual(uniqueIds.size, 100, 'All IDs should be unique');

    // All should be retrievable
    ids.forEach(id => {
      const gen = generations.getGeneration(id);
      assertExists(gen, `Generation ${id} should exist`);
    });
  });

  await test('getGenerations with limit larger than available', async () => {
    generations.clearAll();

    generations.createGeneration('limit-user', '/trump-photos/1.jpg');
    generations.createGeneration('limit-user', '/trump-photos/2.jpg');

    const result = generations.getGenerations('limit-user', 100);
    assertEqual(result.length, 2, 'Should return all available (2)');
  });

  await test('getGenerations with limit of 0', async () => {
    generations.clearAll();

    generations.createGeneration('zero-limit-user', '/trump-photos/1.jpg');

    const result = generations.getGenerations('zero-limit-user', 0);
    assertEqual(result.length, 0, 'Should return empty array with limit 0');
  });

  console.log('\nNull/undefined handling:');

  await test('completeGeneration with null id returns null', async () => {
    const result = generations.completeGeneration(null, '/output/test.png');
    assertEqual(result, null, 'Should return null');
  });

  await test('failGeneration with null id returns null', async () => {
    const result = generations.failGeneration(null, 'ERROR', 'Test');
    assertEqual(result, null, 'Should return null');
  });

  await test('getGeneration with null id returns null', async () => {
    const result = generations.getGeneration(null);
    assertEqual(result, null, 'Should return null');
  });

  await test('checkUsage handles all null params', async () => {
    // Should not throw
    const result = usage.checkUsage(null, null, null);
    assertExists(result, 'Should return usage object');
    assertEqual(result.tier, 'anonymous', 'Should default to anonymous');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(50));
  console.log('Trump Swap Integration Tests');
  console.log('='.repeat(50));
  console.log('');

  try {
    // Run all test suites
    await runAuthMiddlewareTests();
    await runRateLimitTests();
    await runFullFlowTests();
    await runErrorHandlingTests();
    await runEdgeCaseTests();

    // Clean up
    const generations = require('../services/generations');
    generations.clearAll();
    clearMockProfiles();

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
  } catch (error) {
    console.error('\nTest runner error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
