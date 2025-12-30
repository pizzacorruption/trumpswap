/**
 * Model Selection Tests for Pimp My Epstein
 *
 * Tests that the correct Gemini model is selected based on modelType:
 * - 'quick' should use 'gemini-2.5-flash-image-preview'
 * - 'premium' should use 'gemini-3-pro-image-preview'
 * - Invalid modelType should default to 'quick'
 *
 * Run with: node tests/model-selection.test.js
 */

const assert = require('assert');
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

// ============================================
// MODEL SELECTION LOGIC (mirrors server.js)
// ============================================

/**
 * Get model name based on modelType
 * This mirrors the logic in server.js /api/generate endpoint
 */
function getModelName(modelType) {
  // Validate modelType - only allow 'quick' or 'premium'
  const validModelType = ['quick', 'premium'].includes(modelType) ? modelType : 'quick';

  // Select model based on modelType
  const modelName = validModelType === 'premium'
    ? 'gemini-3-pro-image-preview'  // Nano Banana Pro (Gemini 3 Pro Image)
    : 'gemini-2.5-flash-image-preview';       // Nano Banana (Gemini 2.0 Flash)

  return modelName;
}

/**
 * Validate modelType and return the validated value
 */
function validateModelType(modelType) {
  return ['quick', 'premium'].includes(modelType) ? modelType : 'quick';
}

// ============================================
// TEST SUITES
// ============================================

function runModelSelectionTests() {
  console.log('\n=== Model Selection Tests ===\n');

  // -------------------------------------------
  // Quick Model Tests
  // -------------------------------------------
  console.log('Quick Model Selection:');

  test('quick modelType uses gemini-2.5-flash-image-preview', () => {
    const modelName = getModelName('quick');
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Quick should use gemini-2.5-flash-image-preview');
  });

  test('quick modelType is validated correctly', () => {
    const validated = validateModelType('quick');
    assertEqual(validated, 'quick', 'Should return quick');
  });

  // -------------------------------------------
  // Premium Model Tests
  // -------------------------------------------
  console.log('\nPremium Model Selection:');

  test('premium modelType uses gemini-3-pro-image-preview', () => {
    const modelName = getModelName('premium');
    assertEqual(modelName, 'gemini-3-pro-image-preview', 'Premium should use gemini-3-pro-image-preview');
  });

  test('premium modelType is validated correctly', () => {
    const validated = validateModelType('premium');
    assertEqual(validated, 'premium', 'Should return premium');
  });

  // -------------------------------------------
  // Invalid ModelType Defaults to Quick
  // -------------------------------------------
  console.log('\nInvalid ModelType Defaults:');

  test('null modelType defaults to quick model', () => {
    const modelName = getModelName(null);
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Null should default to quick model');
  });

  test('undefined modelType defaults to quick model', () => {
    const modelName = getModelName(undefined);
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Undefined should default to quick model');
  });

  test('empty string modelType defaults to quick model', () => {
    const modelName = getModelName('');
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Empty string should default to quick model');
  });

  test('invalid string modelType defaults to quick model', () => {
    const modelName = getModelName('invalid');
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Invalid string should default to quick model');
  });

  test('numeric modelType defaults to quick model', () => {
    const modelName = getModelName(123);
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Numeric should default to quick model');
  });

  test('object modelType defaults to quick model', () => {
    const modelName = getModelName({});
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Object should default to quick model');
  });

  test('array modelType defaults to quick model', () => {
    const modelName = getModelName([]);
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Array should default to quick model');
  });

  test('QUICK (uppercase) defaults to quick model', () => {
    const modelName = getModelName('QUICK');
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Uppercase QUICK should default to quick model');
  });

  test('PREMIUM (uppercase) defaults to quick model', () => {
    const modelName = getModelName('PREMIUM');
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Uppercase PREMIUM should default to quick model');
  });

  test('Quick (mixed case) defaults to quick model', () => {
    const modelName = getModelName('Quick');
    assertEqual(modelName, 'gemini-2.5-flash-image-preview', 'Mixed case Quick should default to quick model');
  });

  // -------------------------------------------
  // ModelType Validation Tests
  // -------------------------------------------
  console.log('\nModelType Validation:');

  test('null modelType validates to quick', () => {
    const validated = validateModelType(null);
    assertEqual(validated, 'quick', 'Null should validate to quick');
  });

  test('undefined modelType validates to quick', () => {
    const validated = validateModelType(undefined);
    assertEqual(validated, 'quick', 'Undefined should validate to quick');
  });

  test('invalid string validates to quick', () => {
    const validated = validateModelType('super-premium');
    assertEqual(validated, 'quick', 'Invalid string should validate to quick');
  });

  test('spaces around valid type validates to quick', () => {
    const validated = validateModelType(' premium ');
    assertEqual(validated, 'quick', 'Whitespace should not match, defaults to quick');
  });
}

function runTiersConfigModelTests() {
  console.log('\n=== Tiers Config Model Tests ===\n');

  console.log('Model Configuration in tiers.js:');

  test('tiers.models.quick exists', () => {
    assertExists(tiers.models?.quick, 'Quick model config should exist');
  });

  test('tiers.models.quick.modelId is gemini-2.5-flash-image-preview', () => {
    assertEqual(tiers.models.quick.modelId, 'gemini-2.5-flash-image-preview',
      'Quick modelId should be gemini-2.5-flash-image-preview');
  });

  test('tiers.models.premium exists', () => {
    assertExists(tiers.models?.premium, 'Premium model config should exist');
  });

  test('tiers.models.premium.modelId is gemini-3-pro-image-preview', () => {
    assertEqual(tiers.models.premium.modelId, 'gemini-3-pro-image-preview',
      'Premium modelId should be gemini-3-pro-image-preview');
  });

  test('quick model has name property', () => {
    assertEqual(tiers.models.quick.name, 'Quick', 'Quick model name should be Quick');
  });

  test('premium model has name property', () => {
    assertEqual(tiers.models.premium.name, 'Premium', 'Premium model name should be Premium');
  });

  test('quick model has description', () => {
    assertExists(tiers.models.quick.description, 'Quick model should have description');
  });

  test('premium model has description', () => {
    assertExists(tiers.models.premium.description, 'Premium model should have description');
  });

  test('quick model has avgTime', () => {
    assertExists(tiers.models.quick.avgTime, 'Quick model should have avgTime');
  });

  test('premium model has avgTime', () => {
    assertExists(tiers.models.premium.avgTime, 'Premium model should have avgTime');
  });

  test('both models use gemini provider', () => {
    assertEqual(tiers.models.quick.provider, 'gemini', 'Quick should use gemini provider');
    assertEqual(tiers.models.premium.provider, 'gemini', 'Premium should use gemini provider');
  });
}

function runCreditCostTests() {
  console.log('\n=== Credit Cost per Model Tests ===\n');

  console.log('Credit Configuration:');

  test('credit.quickCost is 1', () => {
    assertEqual(tiers.credit.quickCost, 1, 'Quick generation should cost 1 credit');
  });

  test('credit.premiumCost is 2', () => {
    assertEqual(tiers.credit.premiumCost, 2, 'Premium generation should cost 2 credits');
  });

  test('premium costs more credits than quick', () => {
    assertTrue(tiers.credit.premiumCost > tiers.credit.quickCost,
      'Premium should cost more credits than quick');
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

function main() {
  console.log('='.repeat(60));
  console.log('Model Selection Tests');
  console.log('='.repeat(60));
  console.log('');
  console.log('Tests that the correct Gemini model is selected based on modelType');
  console.log('');

  // Run all test suites
  runModelSelectionTests();
  runTiersConfigModelTests();
  runCreditCostTests();

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
