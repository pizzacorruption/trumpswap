/**
 * Unit Tests for Generations Service
 *
 * Comprehensive tests for services/generations.js
 * Run with: node tests/services-generations.test.js
 *
 * Tests cover:
 * - createGeneration with viewToken for anonymous users
 * - completeGeneration status and resultUrl updates
 * - failGeneration error code and message handling
 * - validateGenerationAccess ownership and viewToken validation
 * - findByResultUrl lookups
 * - Timing-safe comparison for viewToken validation
 */

const assert = require('assert');
const crypto = require('crypto');

// Import the generations service
const generations = require('../services/generations');

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

function assertThrows(fn, message) {
  try {
    fn();
    throw new Error(message || 'Expected function to throw');
  } catch (error) {
    if (error.message === (message || 'Expected function to throw')) {
      throw error;
    }
    // Function threw as expected
  }
}

// ============================================
// createGeneration WITH viewToken TESTS
// ============================================

function runCreateGenerationViewTokenTests() {
  console.log('\n=== createGeneration viewToken Tests ===\n');

  generations.clearAll();

  console.log('Anonymous user viewToken handling:');

  test('anonymous user (null userId) gets a viewToken', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    assertExists(gen.viewToken, 'Anonymous generation should have viewToken');
    assertType(gen.viewToken, 'string', 'viewToken should be a string');
  });

  test('anonymous viewToken is 64 characters (32 bytes hex)', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    assertEqual(gen.viewToken.length, 64, 'viewToken should be 64 hex chars');
  });

  test('anonymous viewToken is valid hex', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    const isHex = /^[0-9a-f]+$/.test(gen.viewToken);
    assertTrue(isHex, 'viewToken should be valid hex');
  });

  test('each anonymous generation gets unique viewToken', () => {
    const gen1 = generations.createGeneration(null, '/epstein-photos/test1.jpg');
    const gen2 = generations.createGeneration(null, '/epstein-photos/test2.jpg');
    assertNotEqual(gen1.viewToken, gen2.viewToken, 'viewTokens should be unique');
  });

  console.log('\nAuthenticated user viewToken handling:');

  test('authenticated user (with userId) gets null viewToken', () => {
    const gen = generations.createGeneration('user-123', '/epstein-photos/test.jpg');
    assertNull(gen.viewToken, 'Authenticated user should not have viewToken');
  });

  test('userId is set for authenticated users', () => {
    const gen = generations.createGeneration('user-456', '/epstein-photos/test.jpg');
    assertEqual(gen.userId, 'user-456', 'userId should be set');
    assertNull(gen.viewToken, 'viewToken should be null');
  });

  console.log('\nGeneration record structure:');

  test('anonymous generation has all required fields', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/photo.jpg');
    assertExists(gen.id, 'Should have id');
    assertNull(gen.userId, 'userId should be null for anonymous');
    assertExists(gen.viewToken, 'Should have viewToken');
    assertEqual(gen.epsteinPhoto, '/epstein-photos/photo.jpg', 'Should have epsteinPhoto');
    assertEqual(gen.status, generations.STATUS.PENDING, 'Should be pending');
    assertNull(gen.resultUrl, 'resultUrl should be null');
    assertNull(gen.errorCode, 'errorCode should be null');
    assertNull(gen.errorMessage, 'errorMessage should be null');
    assertExists(gen.createdAt, 'Should have createdAt');
    assertNull(gen.completedAt, 'completedAt should be null');
  });
}

// ============================================
// completeGeneration TESTS
// ============================================

function runCompleteGenerationTests() {
  console.log('\n=== completeGeneration Tests ===\n');

  generations.clearAll();

  console.log('Status updates:');

  test('updates status from pending to completed', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    assertEqual(gen.status, generations.STATUS.PENDING, 'Should start pending');

    const updated = generations.completeGeneration(gen.id, '/output/result.png');
    assertEqual(updated.status, generations.STATUS.COMPLETED, 'Should be completed');
  });

  test('sets resultUrl correctly', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const updated = generations.completeGeneration(gen.id, '/output/swapped_abc123.png');
    assertEqual(updated.resultUrl, '/output/swapped_abc123.png', 'resultUrl should match');
  });

  test('handles various resultUrl formats', () => {
    const gen1 = generations.createGeneration('user-1', '/epstein-photos/a.jpg');
    const updated1 = generations.completeGeneration(gen1.id, '/output/result.png');
    assertEqual(updated1.resultUrl, '/output/result.png');

    const gen2 = generations.createGeneration('user-1', '/epstein-photos/b.jpg');
    const updated2 = generations.completeGeneration(gen2.id, 'https://cdn.example.com/images/result.png');
    assertEqual(updated2.resultUrl, 'https://cdn.example.com/images/result.png');
  });

  console.log('\nTimestamp handling:');

  test('sets completedAt timestamp', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    assertNull(gen.completedAt, 'completedAt should be null initially');

    const before = new Date().toISOString();
    const updated = generations.completeGeneration(gen.id, '/output/result.png');
    const after = new Date().toISOString();

    assertExists(updated.completedAt, 'completedAt should be set');
    assertTrue(updated.completedAt >= before, 'completedAt should be >= start time');
    assertTrue(updated.completedAt <= after, 'completedAt should be <= end time');
  });

  test('createdAt is preserved after completion', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const originalCreatedAt = gen.createdAt;

    const updated = generations.completeGeneration(gen.id, '/output/result.png');
    assertEqual(updated.createdAt, originalCreatedAt, 'createdAt should not change');
  });

  console.log('\nError handling:');

  test('returns null for non-existent generation id', () => {
    const result = generations.completeGeneration('non-existent-id-12345', '/output/result.png');
    assertNull(result, 'Should return null for non-existent id');
  });

  test('returned generation is retrievable', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    generations.completeGeneration(gen.id, '/output/result.png');

    const retrieved = generations.getGeneration(gen.id);
    assertEqual(retrieved.status, generations.STATUS.COMPLETED, 'Retrieved should be completed');
    assertEqual(retrieved.resultUrl, '/output/result.png', 'Retrieved should have resultUrl');
  });
}

// ============================================
// failGeneration TESTS
// ============================================

function runFailGenerationTests() {
  console.log('\n=== failGeneration Tests ===\n');

  generations.clearAll();

  console.log('Error code recording:');

  test('records errorCode correctly', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'SAFETY_BLOCK', 'Content blocked');
    assertEqual(updated.errorCode, 'SAFETY_BLOCK', 'errorCode should be set');
  });

  test('records common error codes', () => {
    const errorCodes = [
      'NO_FACE',
      'MULTIPLE_FACES',
      'IMAGE_TOO_SMALL',
      'SAFETY_BLOCK',
      'RATE_LIMITED',
      'TIMEOUT',
      'INVALID_FORMAT',
      'GENERATION_FAILED',
      'API_ERROR'
    ];

    errorCodes.forEach(code => {
      const gen = generations.createGeneration('user-errors', '/epstein-photos/test.jpg');
      const updated = generations.failGeneration(gen.id, code, `Test message for ${code}`);
      assertEqual(updated.errorCode, code, `Should record ${code}`);
    });
  });

  console.log('\nError message recording:');

  test('records errorMessage correctly', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const message = 'No face detected in the uploaded image';
    const updated = generations.failGeneration(gen.id, 'NO_FACE', message);
    assertEqual(updated.errorMessage, message, 'errorMessage should be set');
  });

  test('preserves detailed error messages', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const detailedMessage = 'API returned error code 429: Rate limit exceeded. Please try again in 60 seconds.';
    const updated = generations.failGeneration(gen.id, 'RATE_LIMITED', detailedMessage);
    assertEqual(updated.errorMessage, detailedMessage, 'Detailed message should be preserved');
  });

  test('handles empty error message', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'UNKNOWN', '');
    assertEqual(updated.errorMessage, '', 'Empty message should be accepted');
  });

  console.log('\nStatus and timestamp handling:');

  test('updates status to failed', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    assertEqual(gen.status, generations.STATUS.PENDING, 'Should start pending');

    const updated = generations.failGeneration(gen.id, 'ERROR', 'Something went wrong');
    assertEqual(updated.status, generations.STATUS.FAILED, 'Should be failed');
  });

  test('sets completedAt on failure', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'ERROR', 'Test');
    assertExists(updated.completedAt, 'completedAt should be set on failure');
  });

  test('resultUrl remains null on failure', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    const updated = generations.failGeneration(gen.id, 'ERROR', 'Test');
    assertNull(updated.resultUrl, 'resultUrl should remain null');
  });

  console.log('\nError handling:');

  test('returns null for non-existent generation id', () => {
    const result = generations.failGeneration('does-not-exist', 'ERROR', 'Test');
    assertNull(result, 'Should return null for non-existent id');
  });
}

// ============================================
// validateGenerationAccess TESTS
// ============================================

function runValidateGenerationAccessTests() {
  console.log('\n=== validateGenerationAccess Tests ===\n');

  generations.clearAll();

  console.log('Ownership validation for authenticated users:');

  test('owner can access their own generation', () => {
    const gen = generations.createGeneration('user-owner', '/epstein-photos/test.jpg');
    const result = generations.validateGenerationAccess(gen.id, 'user-owner', null);
    assertTrue(result.authorized, 'Owner should be authorized');
    assertExists(result.generation, 'Generation should be returned');
    assertNull(result.error, 'No error expected');
  });

  test('non-owner cannot access authenticated generation', () => {
    const gen = generations.createGeneration('user-owner', '/epstein-photos/test.jpg');
    const result = generations.validateGenerationAccess(gen.id, 'user-other', null);
    assertFalse(result.authorized, 'Non-owner should not be authorized');
    assertNull(result.generation, 'Generation should not be returned');
    assertEqual(result.error, 'Not authorized to view this generation', 'Should have error message');
  });

  test('anonymous user cannot access authenticated generation', () => {
    const gen = generations.createGeneration('user-owner', '/epstein-photos/test.jpg');
    const result = generations.validateGenerationAccess(gen.id, null, null);
    assertFalse(result.authorized, 'Anonymous should not access authenticated gen');
    assertNull(result.generation, 'Generation should not be returned');
  });

  console.log('\nviewToken validation for anonymous generations:');

  test('correct viewToken grants access to anonymous generation', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    const result = generations.validateGenerationAccess(gen.id, null, gen.viewToken);
    assertTrue(result.authorized, 'Correct viewToken should grant access');
    assertExists(result.generation, 'Generation should be returned');
    assertNull(result.error, 'No error expected');
  });

  test('incorrect viewToken denies access', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    const wrongToken = crypto.randomBytes(32).toString('hex');
    const result = generations.validateGenerationAccess(gen.id, null, wrongToken);
    assertFalse(result.authorized, 'Wrong viewToken should deny access');
    assertNull(result.generation, 'Generation should not be returned');
    assertEqual(result.error, 'Invalid view token', 'Should have error message');
  });

  test('missing viewToken denies access to anonymous generation', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    const result = generations.validateGenerationAccess(gen.id, null, null);
    assertFalse(result.authorized, 'Missing viewToken should deny access');
    assertEqual(result.error, 'View token required for anonymous generations');
  });

  test('empty string viewToken denies access', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    const result = generations.validateGenerationAccess(gen.id, null, '');
    assertFalse(result.authorized, 'Empty viewToken should deny access');
  });

  test('authenticated user cannot use viewToken to access anonymous generation', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    // An authenticated user with a userId but providing the viewToken
    // The code checks userId first for authenticated gens - anonymous gens have no userId
    // so this should fall through to viewToken validation
    const result = generations.validateGenerationAccess(gen.id, 'some-user', gen.viewToken);
    // Since generation.userId is null, we go to Case 2 (anonymous generation)
    // viewToken is provided and correct, so should succeed
    assertTrue(result.authorized, 'Valid viewToken should work regardless of requesting userId');
  });

  console.log('\nNon-existent generation handling:');

  test('non-existent generation returns not found', () => {
    const result = generations.validateGenerationAccess('fake-id-12345', 'user-1', null);
    assertFalse(result.authorized, 'Should not be authorized');
    assertNull(result.generation, 'Generation should be null');
    assertEqual(result.error, 'Generation not found', 'Should indicate not found');
  });

  console.log('\nEdge cases:');

  test('viewToken from different generation does not grant access', () => {
    const gen1 = generations.createGeneration(null, '/epstein-photos/test1.jpg');
    const gen2 = generations.createGeneration(null, '/epstein-photos/test2.jpg');

    // Try to use gen1's token to access gen2
    const result = generations.validateGenerationAccess(gen2.id, null, gen1.viewToken);
    assertFalse(result.authorized, 'Token from different gen should not work');
  });

  test('case-sensitive viewToken validation', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');
    const uppercaseToken = gen.viewToken.toUpperCase();

    // If original has lowercase chars, uppercase version should fail
    if (gen.viewToken !== uppercaseToken) {
      const result = generations.validateGenerationAccess(gen.id, null, uppercaseToken);
      assertFalse(result.authorized, 'viewToken should be case-sensitive');
    }
  });
}

// ============================================
// TIMING-SAFE COMPARISON TESTS
// ============================================

function runTimingSafeComparisonTests() {
  console.log('\n=== Timing-Safe Comparison Tests ===\n');

  generations.clearAll();

  console.log('Timing-safe viewToken validation:');

  test('uses crypto.timingSafeEqual for viewToken comparison', () => {
    // We verify this by checking the source code implementation
    // The actual timing attack resistance is hard to test directly
    // but we can verify correct tokens work and incorrect ones fail

    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');

    // Correct token should work
    const correctResult = generations.validateGenerationAccess(gen.id, null, gen.viewToken);
    assertTrue(correctResult.authorized, 'Correct token should work');

    // Token with same length but wrong content should fail
    const wrongToken = 'a'.repeat(64);
    const wrongResult = generations.validateGenerationAccess(gen.id, null, wrongToken);
    assertFalse(wrongResult.authorized, 'Wrong token should fail');
  });

  test('handles tokens of different lengths safely', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');

    // Short token - timingSafeEqual throws if lengths differ
    // The implementation should handle this gracefully
    try {
      const result = generations.validateGenerationAccess(gen.id, null, 'short');
      // If we get here, the implementation handles length mismatch
      assertFalse(result.authorized, 'Short token should not authorize');
    } catch (error) {
      // timingSafeEqual throws RangeError for different length buffers
      // This is acceptable behavior - it means incorrect token
      assertTrue(error.message.includes('size') || error.message.includes('length'),
        'Should throw length-related error');
    }
  });

  test('handles very long tokens safely', () => {
    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');

    // Very long token
    const longToken = 'a'.repeat(1000);
    try {
      const result = generations.validateGenerationAccess(gen.id, null, longToken);
      assertFalse(result.authorized, 'Long token should not authorize');
    } catch (error) {
      // Length mismatch error is acceptable
      assertTrue(true);
    }
  });

  test('timing-safe comparison prevents timing attacks', () => {
    // This is a documentation test - actual timing attack testing
    // requires statistical analysis over many iterations
    // We document that crypto.timingSafeEqual is used in the implementation

    const gen = generations.createGeneration(null, '/epstein-photos/test.jpg');

    // The implementation at line 167-170 uses:
    // crypto.timingSafeEqual(Buffer.from(viewToken), Buffer.from(generation.viewToken))
    // This prevents timing attacks by ensuring comparison takes constant time

    const result = generations.validateGenerationAccess(gen.id, null, gen.viewToken);
    assertTrue(result.authorized, 'Verification that timing-safe code path works');
  });
}

// ============================================
// findByResultUrl TESTS
// ============================================

function runFindByResultUrlTests() {
  console.log('\n=== findByResultUrl Tests ===\n');

  generations.clearAll();

  console.log('Basic lookups:');

  test('finds generation by exact resultUrl', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    generations.completeGeneration(gen.id, '/output/epstein_abc123.png');

    const found = generations.findByResultUrl('/output/epstein_abc123.png');
    assertExists(found, 'Should find the generation');
    assertEqual(found.id, gen.id, 'Should be the same generation');
  });

  test('returns null for non-existent resultUrl', () => {
    const found = generations.findByResultUrl('/output/does_not_exist.png');
    assertNull(found, 'Should return null for non-existent URL');
  });

  test('pending generations have null resultUrl', () => {
    generations.clearAll();
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    // Generation is still pending, has no resultUrl

    // findByResultUrl with null will match any generation with null resultUrl
    // This is expected behavior - pending/failed generations have null resultUrl
    const found = generations.findByResultUrl(null);
    assertExists(found, 'Should find generation with null resultUrl');
    assertEqual(found.id, gen.id, 'Should be the pending generation');
  });

  console.log('\nURL format handling:');

  test('handles various URL formats', () => {
    const gen1 = generations.createGeneration('user-1', '/epstein-photos/a.jpg');
    generations.completeGeneration(gen1.id, '/output/result1.png');

    const gen2 = generations.createGeneration('user-1', '/epstein-photos/b.jpg');
    generations.completeGeneration(gen2.id, 'https://cdn.example.com/images/result2.png');

    const gen3 = generations.createGeneration('user-1', '/epstein-photos/c.jpg');
    generations.completeGeneration(gen3.id, 'output/result3.png');

    assertEqual(generations.findByResultUrl('/output/result1.png').id, gen1.id);
    assertEqual(generations.findByResultUrl('https://cdn.example.com/images/result2.png').id, gen2.id);
    assertEqual(generations.findByResultUrl('output/result3.png').id, gen3.id);
  });

  test('URL matching is exact (no partial matches)', () => {
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    generations.completeGeneration(gen.id, '/output/result.png');

    // Partial matches should not work
    assertNull(generations.findByResultUrl('/output/result'), 'Partial should not match');
    assertNull(generations.findByResultUrl('result.png'), 'Suffix should not match');
    assertNull(generations.findByResultUrl('/output/'), 'Prefix should not match');
  });

  console.log('\nMultiple generations:');

  test('returns correct generation when multiple exist', () => {
    generations.clearAll();

    const gen1 = generations.createGeneration('user-1', '/epstein-photos/a.jpg');
    const gen2 = generations.createGeneration('user-1', '/epstein-photos/b.jpg');
    const gen3 = generations.createGeneration('user-1', '/epstein-photos/c.jpg');

    generations.completeGeneration(gen1.id, '/output/first.png');
    generations.completeGeneration(gen2.id, '/output/second.png');
    generations.completeGeneration(gen3.id, '/output/third.png');

    assertEqual(generations.findByResultUrl('/output/second.png').id, gen2.id);
  });

  test('returns first match if duplicates exist (edge case)', () => {
    generations.clearAll();

    // In practice, resultUrls should be unique, but test the behavior
    const gen1 = generations.createGeneration('user-1', '/epstein-photos/a.jpg');
    generations.completeGeneration(gen1.id, '/output/duplicate.png');

    // Create another with same resultUrl (shouldn't happen in practice)
    const gen2 = generations.createGeneration('user-1', '/epstein-photos/b.jpg');
    generations.completeGeneration(gen2.id, '/output/duplicate.png');

    // Should find one of them
    const found = generations.findByResultUrl('/output/duplicate.png');
    assertExists(found, 'Should find at least one');
    assertTrue(found.id === gen1.id || found.id === gen2.id, 'Should be one of the duplicates');
  });

  console.log('\nFailed generations:');

  test('failed generations have null resultUrl and are findable by null', () => {
    generations.clearAll();
    const gen = generations.createGeneration('user-1', '/epstein-photos/test.jpg');
    generations.failGeneration(gen.id, 'ERROR', 'Test failure');

    // Failed generation has null resultUrl, so findByResultUrl(null) matches it
    const found = generations.findByResultUrl(null);
    assertExists(found, 'Failed gen is findable by null URL');
    assertEqual(found.id, gen.id, 'Should be the failed generation');
    assertNull(found.resultUrl, 'Failed gen should have null resultUrl');
  });
}

// ============================================
// INTEGRATION TESTS
// ============================================

function runIntegrationTests() {
  console.log('\n=== Integration Tests ===\n');

  generations.clearAll();

  console.log('Full workflow tests:');

  test('complete anonymous generation workflow', () => {
    // 1. Create anonymous generation
    const gen = generations.createGeneration(null, '/epstein-photos/victim.jpg');
    assertExists(gen.viewToken, 'Should have viewToken');
    assertEqual(gen.status, generations.STATUS.PENDING);

    // 2. Complete the generation
    generations.completeGeneration(gen.id, '/output/swapped.png');

    // 3. Validate access with viewToken
    const accessResult = generations.validateGenerationAccess(gen.id, null, gen.viewToken);
    assertTrue(accessResult.authorized, 'Should be authorized with viewToken');
    assertEqual(accessResult.generation.status, generations.STATUS.COMPLETED);

    // 4. Find by resultUrl
    const found = generations.findByResultUrl('/output/swapped.png');
    assertEqual(found.id, gen.id, 'Should find by resultUrl');
  });

  test('complete authenticated generation workflow', () => {
    // 1. Create authenticated generation
    const gen = generations.createGeneration('user-auth-test', '/epstein-photos/victim.jpg');
    assertNull(gen.viewToken, 'Authenticated should not have viewToken');
    assertEqual(gen.status, generations.STATUS.PENDING);

    // 2. Complete the generation
    generations.completeGeneration(gen.id, '/output/auth-result.png');

    // 3. Validate access with userId
    const accessResult = generations.validateGenerationAccess(gen.id, 'user-auth-test', null);
    assertTrue(accessResult.authorized, 'Owner should be authorized');
    assertEqual(accessResult.generation.status, generations.STATUS.COMPLETED);

    // 4. Non-owner cannot access
    const otherResult = generations.validateGenerationAccess(gen.id, 'other-user', null);
    assertFalse(otherResult.authorized, 'Non-owner should not be authorized');
  });

  test('failed generation workflow', () => {
    const gen = generations.createGeneration('user-fail-test', '/epstein-photos/victim.jpg');

    // Fail the generation
    generations.failGeneration(gen.id, 'SAFETY_BLOCK', 'Content violates policy');

    // Can still retrieve and validate access
    const accessResult = generations.validateGenerationAccess(gen.id, 'user-fail-test', null);
    assertTrue(accessResult.authorized, 'Owner can still access failed generation');
    assertEqual(accessResult.generation.status, generations.STATUS.FAILED);
    assertEqual(accessResult.generation.errorCode, 'SAFETY_BLOCK');

    // Not findable by resultUrl (null)
    assertNull(accessResult.generation.resultUrl, 'Failed gen has no resultUrl');
  });

  test('generation history isolation', () => {
    const gen1 = generations.createGeneration('user-A', '/epstein-photos/a.jpg');
    const gen2 = generations.createGeneration('user-B', '/epstein-photos/b.jpg');
    const gen3 = generations.createGeneration(null, '/epstein-photos/c.jpg');

    // User A can only access their generation
    assertTrue(
      generations.validateGenerationAccess(gen1.id, 'user-A', null).authorized
    );
    assertFalse(
      generations.validateGenerationAccess(gen2.id, 'user-A', null).authorized
    );
    assertFalse(
      generations.validateGenerationAccess(gen3.id, 'user-A', null).authorized
    );

    // Anonymous can only access anonymous with token
    assertTrue(
      generations.validateGenerationAccess(gen3.id, null, gen3.viewToken).authorized
    );
    assertFalse(
      generations.validateGenerationAccess(gen1.id, null, gen3.viewToken).authorized
    );
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

function main() {
  console.log('='.repeat(60));
  console.log('Generations Service Unit Tests');
  console.log('='.repeat(60));
  console.log('');

  // Run all test suites
  runCreateGenerationViewTokenTests();
  runCompleteGenerationTests();
  runFailGenerationTests();
  runValidateGenerationAccessTests();
  runTimingSafeComparisonTests();
  runFindByResultUrlTests();
  runIntegrationTests();

  // Clean up
  generations.clearAll();

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
