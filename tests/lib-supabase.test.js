/**
 * Tests for lib/supabase.js - Supabase Client Configuration
 *
 * Run with: node tests/lib-supabase.test.js
 *
 * TESTING WITH SUPABASE CONFIGURATION:
 * =====================================
 *
 * 1. WITHOUT Supabase configured (default behavior in CI/CD):
 *    - The SUPABASE_URL and SUPABASE_ANON_KEY environment variables are NOT set
 *    - createServerClient() returns null
 *    - getClientConfig() returns empty strings
 *    - verifyToken() returns error "Supabase not configured"
 *    - The app gracefully degrades to anonymous-only mode
 *
 * 2. WITH Supabase configured (for integration testing):
 *    - Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file
 *    - createServerClient() returns a valid Supabase client
 *    - getClientConfig() returns the URL and anon key
 *    - verifyToken() attempts to verify tokens with Supabase
 *    - Full authentication and profile features are available
 *
 * ENVIRONMENT VARIABLES REQUIRED FOR FULL TESTING:
 * - SUPABASE_URL: Your Supabase project URL (e.g., https://xxxxx.supabase.co)
 * - SUPABASE_ANON_KEY: Your Supabase anonymous/public key
 *
 * TESTING STRATEGY:
 * - These tests can run in both configured and unconfigured modes
 * - The tests detect the current configuration state
 * - Some tests are skipped when Supabase is not configured
 * - Connection tests only run when Supabase IS configured
 */

require('dotenv').config();

// Test results tracking
let passed = 0;
let failed = 0;
let skipped = 0;
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
 * Async test runner
 */
async function testAsync(name, fn) {
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
}

/**
 * Skip a test with a reason
 */
function skip(name, reason) {
  skipped++;
  results.push({ name, status: 'SKIP', reason });
  console.log(`  [SKIP] ${name} - ${reason}`);
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

function assertHasProperty(obj, prop, message) {
  if (!Object.prototype.hasOwnProperty.call(obj, prop)) {
    throw new Error(message || `Expected object to have property '${prop}'`);
  }
}

// ============================================
// DETECT CONFIGURATION STATE
// ============================================

const isSupabaseConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

console.log('\n' + '='.repeat(60));
console.log('Supabase Library Tests (lib/supabase.js)');
console.log('='.repeat(60));
console.log('');
console.log(`Configuration Status: ${isSupabaseConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
if (!isSupabaseConfigured) {
  console.log('  -> Running in unconfigured mode');
  console.log('  -> Set SUPABASE_URL and SUPABASE_ANON_KEY to run connection tests');
}
console.log('');

// ============================================
// MODULE LOADING TESTS
// ============================================

function runModuleLoadingTests() {
  console.log('=== Module Loading Tests ===\n');

  test('supabase module exports required functions', () => {
    const supabaseModule = require('../lib/supabase');

    assertHasProperty(supabaseModule, 'supabase', 'Should export supabase client');
    assertHasProperty(supabaseModule, 'createServerClient', 'Should export createServerClient');
    assertHasProperty(supabaseModule, 'getClientConfig', 'Should export getClientConfig');
    assertHasProperty(supabaseModule, 'verifyToken', 'Should export verifyToken');
  });

  test('createServerClient is a function', () => {
    const { createServerClient } = require('../lib/supabase');
    assertType(createServerClient, 'function', 'createServerClient should be a function');
  });

  test('getClientConfig is a function', () => {
    const { getClientConfig } = require('../lib/supabase');
    assertType(getClientConfig, 'function', 'getClientConfig should be a function');
  });

  test('verifyToken is a function', () => {
    const { verifyToken } = require('../lib/supabase');
    assertType(verifyToken, 'function', 'verifyToken should be a function');
  });
}

// ============================================
// GET CLIENT CONFIG TESTS
// ============================================

function runGetClientConfigTests() {
  console.log('\n=== getClientConfig Tests ===\n');

  test('getClientConfig returns an object', () => {
    const { getClientConfig } = require('../lib/supabase');
    const config = getClientConfig();
    assertType(config, 'object', 'getClientConfig should return an object');
  });

  test('getClientConfig returns url property', () => {
    const { getClientConfig } = require('../lib/supabase');
    const config = getClientConfig();
    assertHasProperty(config, 'url', 'Config should have url property');
    assertType(config.url, 'string', 'url should be a string');
  });

  test('getClientConfig returns anonKey property', () => {
    const { getClientConfig } = require('../lib/supabase');
    const config = getClientConfig();
    assertHasProperty(config, 'anonKey', 'Config should have anonKey property');
    assertType(config.anonKey, 'string', 'anonKey should be a string');
  });

  if (isSupabaseConfigured) {
    test('getClientConfig returns non-empty url when configured', () => {
      const { getClientConfig } = require('../lib/supabase');
      const config = getClientConfig();
      assertTrue(config.url.length > 0, 'url should not be empty');
      assertTrue(config.url.includes('supabase'), 'url should contain supabase');
    });

    test('getClientConfig returns non-empty anonKey when configured', () => {
      const { getClientConfig } = require('../lib/supabase');
      const config = getClientConfig();
      assertTrue(config.anonKey.length > 0, 'anonKey should not be empty');
    });
  } else {
    test('getClientConfig returns empty url when not configured', () => {
      const { getClientConfig } = require('../lib/supabase');
      const config = getClientConfig();
      assertEqual(config.url, '', 'url should be empty when not configured');
    });

    test('getClientConfig returns empty anonKey when not configured', () => {
      const { getClientConfig } = require('../lib/supabase');
      const config = getClientConfig();
      assertEqual(config.anonKey, '', 'anonKey should be empty when not configured');
    });
  }

  test('getClientConfig does not expose sensitive values', () => {
    const { getClientConfig } = require('../lib/supabase');
    const config = getClientConfig();

    // Should not have service_role key (if we had one)
    assertFalse(Object.prototype.hasOwnProperty.call(config, 'serviceKey'),
      'Should not expose service key');

    // Should only have url and anonKey
    const keys = Object.keys(config);
    assertEqual(keys.length, 2, 'Should only have 2 properties (url and anonKey)');
    assertTrue(keys.includes('url'), 'Should have url');
    assertTrue(keys.includes('anonKey'), 'Should have anonKey');
  });
}

// ============================================
// CREATE SERVER CLIENT TESTS
// ============================================

function runCreateServerClientTests() {
  console.log('\n=== createServerClient Tests ===\n');

  if (isSupabaseConfigured) {
    test('createServerClient returns a Supabase client when configured', () => {
      const { createServerClient } = require('../lib/supabase');
      const client = createServerClient();
      assertExists(client, 'Should return a client');
    });

    test('supabase singleton is not null when configured', () => {
      const { supabase } = require('../lib/supabase');
      assertExists(supabase, 'Singleton supabase client should exist');
    });

    test('supabase client has auth property', () => {
      const { supabase } = require('../lib/supabase');
      assertHasProperty(supabase, 'auth', 'Client should have auth property');
    });

    test('supabase client has from method for database queries', () => {
      const { supabase } = require('../lib/supabase');
      assertType(supabase.from, 'function', 'Client should have from method');
    });

    test('supabase client has storage property', () => {
      const { supabase } = require('../lib/supabase');
      assertHasProperty(supabase, 'storage', 'Client should have storage property');
    });
  } else {
    test('createServerClient returns null when not configured', () => {
      const { createServerClient } = require('../lib/supabase');
      const client = createServerClient();
      assertNull(client, 'Should return null when not configured');
    });

    test('supabase singleton is null when not configured', () => {
      const { supabase } = require('../lib/supabase');
      assertNull(supabase, 'Singleton should be null when not configured');
    });
  }

  test('createServerClient can be called multiple times', () => {
    const { createServerClient } = require('../lib/supabase');

    // Should not throw when called multiple times
    const client1 = createServerClient();
    const client2 = createServerClient();

    if (isSupabaseConfigured) {
      assertExists(client1, 'First call should return client');
      assertExists(client2, 'Second call should return client');
    } else {
      assertNull(client1, 'First call should return null');
      assertNull(client2, 'Second call should return null');
    }
  });
}

// ============================================
// VERIFY TOKEN TESTS
// ============================================

async function runVerifyTokenTests() {
  console.log('\n=== verifyToken Tests ===\n');

  await testAsync('verifyToken returns an object with user and error properties', async () => {
    const { verifyToken } = require('../lib/supabase');
    const result = await verifyToken('fake-token');

    assertHasProperty(result, 'user', 'Result should have user property');
    assertHasProperty(result, 'error', 'Result should have error property');
  });

  if (!isSupabaseConfigured) {
    await testAsync('verifyToken returns error when Supabase not configured', async () => {
      const { verifyToken } = require('../lib/supabase');
      const result = await verifyToken('any-token');

      assertNull(result.user, 'user should be null');
      assertExists(result.error, 'error should exist');
      assertEqual(result.error.message, 'Supabase not configured',
        'Error message should indicate Supabase is not configured');
    });

    await testAsync('verifyToken handles empty token when not configured', async () => {
      const { verifyToken } = require('../lib/supabase');
      const result = await verifyToken('');

      assertNull(result.user, 'user should be null');
      assertExists(result.error, 'error should exist');
    });

    await testAsync('verifyToken handles null token when not configured', async () => {
      const { verifyToken } = require('../lib/supabase');
      const result = await verifyToken(null);

      assertNull(result.user, 'user should be null');
      assertExists(result.error, 'error should exist');
    });
  } else {
    await testAsync('verifyToken returns error for invalid token when configured', async () => {
      const { verifyToken } = require('../lib/supabase');
      const result = await verifyToken('definitely-not-a-valid-jwt-token');

      assertNull(result.user, 'user should be null for invalid token');
      assertExists(result.error, 'error should exist for invalid token');
    });

    await testAsync('verifyToken handles empty token when configured', async () => {
      const { verifyToken } = require('../lib/supabase');
      const result = await verifyToken('');

      assertNull(result.user, 'user should be null for empty token');
      assertExists(result.error, 'error should exist for empty token');
    });

    await testAsync('verifyToken handles malformed JWT when configured', async () => {
      const { verifyToken } = require('../lib/supabase');
      // A malformed JWT (wrong structure)
      const result = await verifyToken('not.a.valid.jwt.structure.at.all');

      assertNull(result.user, 'user should be null for malformed JWT');
      assertExists(result.error, 'error should exist for malformed JWT');
    });
  }
}

// ============================================
// SUPABASE CONNECTION TESTS (ONLY WHEN CONFIGURED)
// ============================================

async function runConnectionTests() {
  console.log('\n=== Connection Tests (Supabase Configured) ===\n');

  if (!isSupabaseConfigured) {
    skip('Connection to Supabase can be established', 'Supabase not configured');
    skip('Query to profiles table returns result structure', 'Supabase not configured');
    skip('Storage service is accessible', 'Supabase not configured');
    skip('Auth service is accessible', 'Supabase not configured');
    return;
  }

  await testAsync('Connection to Supabase can be established', async () => {
    const { supabase } = require('../lib/supabase');

    // Try a simple query to verify connection works
    // This doesn't need to return data, just needs to not throw a connection error
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    // If table doesn't exist, that's fine - we're testing connection
    // The error should NOT be a connection/network error
    if (error) {
      const isConnectionError = error.message.toLowerCase().includes('fetch') ||
        error.message.toLowerCase().includes('network') ||
        error.message.toLowerCase().includes('connection');

      assertFalse(isConnectionError,
        `Should not have connection error. Got: ${error.message}`);
    }
  });

  await testAsync('Query to profiles table returns result structure', async () => {
    const { supabase } = require('../lib/supabase');

    const result = await supabase
      .from('profiles')
      .select('id, email, generation_count')
      .limit(1);

    // Result should have data and error properties
    assertHasProperty(result, 'data', 'Result should have data property');
    assertHasProperty(result, 'error', 'Result should have error property');

    // data should be null or an array
    if (result.data !== null) {
      assertTrue(Array.isArray(result.data), 'data should be an array when not null');
    }
  });

  await testAsync('Storage service is accessible', async () => {
    const { supabase } = require('../lib/supabase');

    // Check that storage object exists and has expected methods
    assertExists(supabase.storage, 'Storage should exist');
    assertType(supabase.storage.from, 'function', 'storage.from should be a function');
  });

  await testAsync('Auth service is accessible', async () => {
    const { supabase } = require('../lib/supabase');

    // Check that auth object exists and has expected methods
    assertExists(supabase.auth, 'Auth should exist');
    assertType(supabase.auth.getUser, 'function', 'auth.getUser should be a function');
    assertType(supabase.auth.getSession, 'function', 'auth.getSession should be a function');
  });
}

// ============================================
// ERROR HANDLING TESTS
// ============================================

async function runErrorHandlingTests() {
  console.log('\n=== Error Handling Tests ===\n');

  test('Module handles missing environment variables gracefully', () => {
    // The module should load without throwing even when vars are missing
    // This is tested by the fact that we got here
    const { supabase, createServerClient, getClientConfig, verifyToken } = require('../lib/supabase');

    assertType(createServerClient, 'function', 'createServerClient should still be a function');
    assertType(getClientConfig, 'function', 'getClientConfig should still be a function');
    assertType(verifyToken, 'function', 'verifyToken should still be a function');
  });

  await testAsync('verifyToken does not throw on unexpected input types', async () => {
    const { verifyToken } = require('../lib/supabase');

    // These should not throw, just return appropriate error responses
    const results = await Promise.all([
      verifyToken(undefined),
      verifyToken(null),
      verifyToken(123),
      verifyToken({}),
      verifyToken([]),
    ]);

    // All should have returned objects with user and error properties
    for (const result of results) {
      assertHasProperty(result, 'user', 'Should have user property');
      assertHasProperty(result, 'error', 'Should have error property');
    }
  });

  test('getClientConfig does not throw on any state', () => {
    const { getClientConfig } = require('../lib/supabase');

    // Should never throw
    let config;
    try {
      config = getClientConfig();
    } catch (e) {
      throw new Error(`getClientConfig threw an error: ${e.message}`);
    }

    assertExists(config, 'Config should exist');
    assertType(config, 'object', 'Config should be an object');
  });
}

// ============================================
// SECURITY TESTS
// ============================================

function runSecurityTests() {
  console.log('\n=== Security Tests ===\n');

  test('getClientConfig only exposes public/safe values', () => {
    const { getClientConfig } = require('../lib/supabase');
    const config = getClientConfig();

    // The anon key IS public/safe to expose (it's meant for client-side use)
    // But service role key should NEVER be exposed

    const configStr = JSON.stringify(config).toLowerCase();

    // Should not contain service role indicators
    assertFalse(configStr.includes('service_role'), 'Should not expose service role key');
    assertFalse(configStr.includes('secret'), 'Should not expose secret values');
  });

  test('Environment variables are not directly exposed', () => {
    const supabaseModule = require('../lib/supabase');

    // Module should not expose raw env vars
    assertFalse(Object.prototype.hasOwnProperty.call(supabaseModule, 'supabaseUrl'),
      'Should not expose supabaseUrl directly');
    assertFalse(Object.prototype.hasOwnProperty.call(supabaseModule, 'supabaseAnonKey'),
      'Should not expose supabaseAnonKey directly');
  });

  test('Client config is safe to send to browser', () => {
    const { getClientConfig } = require('../lib/supabase');
    const config = getClientConfig();

    // Verify it only contains URL and anon key (both are public by design)
    const keys = Object.keys(config);
    const safeKeys = ['url', 'anonKey'];

    for (const key of keys) {
      assertTrue(safeKeys.includes(key),
        `Config contains unexpected key: ${key}`);
    }
  });
}

// ============================================
// PROFILE QUERY TESTS (WHEN CONFIGURED)
// ============================================

async function runProfileTests() {
  console.log('\n=== Profile Query Tests ===\n');

  if (!isSupabaseConfigured) {
    skip('Profile query structure is correct', 'Supabase not configured');
    skip('Profile query with non-existent ID returns null data', 'Supabase not configured');
    skip('Profile table has expected columns', 'Supabase not configured');
    return;
  }

  await testAsync('Profile query structure is correct', async () => {
    const { supabase } = require('../lib/supabase');

    // Query profile table structure (RLS may block actual data)
    const result = await supabase
      .from('profiles')
      .select('*')
      .limit(0);

    assertHasProperty(result, 'data', 'Result should have data');
    assertHasProperty(result, 'error', 'Result should have error');
  });

  await testAsync('Profile query with non-existent ID returns null data', async () => {
    const { supabase } = require('../lib/supabase');

    const result = await supabase
      .from('profiles')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000000')
      .single();

    // Either returns null data (not found) or error (RLS blocked)
    // Both are valid responses
    if (!result.error) {
      assertNull(result.data, 'Data should be null for non-existent ID');
    }
  });

  await testAsync('Profile table has expected columns based on schema', async () => {
    const { supabase } = require('../lib/supabase');

    // This tests that the table exists and has the expected structure
    // We select specific columns that should exist per schema.sql
    const result = await supabase
      .from('profiles')
      .select('id, email, generation_count, tier, created_at')
      .limit(0);

    // If error is about columns not existing, test fails
    // If error is RLS (denied access), that's okay - table exists
    if (result.error) {
      const isColumnError = result.error.message.toLowerCase().includes('column');
      assertFalse(isColumnError,
        `Table should have expected columns. Error: ${result.error.message}`);
    }
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  // Run all test suites
  runModuleLoadingTests();
  runGetClientConfigTests();
  runCreateServerClientTests();
  await runVerifyTokenTests();
  await runConnectionTests();
  await runErrorHandlingTests();
  runSecurityTests();
  await runProfileTests();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Passed:  ${passed}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total:   ${passed + failed + skipped}`);
  console.log('');

  // Show Supabase configuration info
  console.log('Supabase Configuration:');
  console.log(`  SUPABASE_URL:      ${process.env.SUPABASE_URL ? 'Set' : 'Not set'}`);
  console.log(`  SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'Set' : 'Not set'}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  } else if (skipped > 0) {
    console.log('Skipped Tests (configure Supabase to run these):');
    results
      .filter(r => r.status === 'SKIP')
      .forEach(r => console.log(`  - ${r.name}: ${r.reason}`));
    console.log('\nAll non-skipped tests passed!');
    process.exit(0);
  } else {
    console.log('All tests passed!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
