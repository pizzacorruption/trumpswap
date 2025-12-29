/**
 * Admin Cookie Security Tests for Pimp My Epstein
 *
 * Tests the httpOnly cookie security implementation for admin authentication.
 * Uses curl via child_process to properly handle cookies with a cookie jar.
 *
 * Run with:
 *   ADMIN_PASSWORD=<your-admin-password> node tests/security-admin-cookie.test.js
 *
 * Example:
 *   ADMIN_PASSWORD=miracularspectacular node tests/security-admin-cookie.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 * - ADMIN_PASSWORD env var must match server's .env ADMIN_PASSWORD
 *
 * IMPORTANT: These tests are designed to minimize login attempts to avoid
 * hitting the rate limiter (5 attempts per 15 minutes). Tests share sessions
 * where possible. If you hit the rate limit, wait 15 minutes before retrying.
 *
 * What this tests:
 * 1. POST /api/admin/login sets an httpOnly cookie (not returned in JSON)
 * 2. Cookie has Secure (in production), SameSite=Strict, HttpOnly, Path=/
 * 3. GET /api/admin/debug works with the cookie
 * 4. POST /api/admin/logout clears the cookie
 * 5. X-Admin-Token header still works for backwards compatibility
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword';

// Cookie jar files for curl
const COOKIE_JAR = path.join(os.tmpdir(), `epswag-test-cookies-${Date.now()}.txt`);
const tempFiles = [COOKIE_JAR];

// Shared session token (extracted from first login)
let sharedToken = null;

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

/**
 * Execute curl command and return result
 */
function curlSync(args) {
  try {
    const stdout = execSync(`curl -s ${args}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status || 1,
    };
  }
}

/**
 * Execute curl with headers included in output
 */
function curlWithHeaders(args) {
  try {
    const output = execSync(`curl -s -i ${args}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });

    // Split headers and body (handle both \r\n and \n line endings)
    const separator = output.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const parts = output.split(separator);
    const headers = parts[0] || '';
    const body = parts.slice(1).join(separator);

    return { headers, body, exitCode: 0 };
  } catch (error) {
    return {
      headers: '',
      body: error.stdout || '',
      exitCode: error.status || 1,
    };
  }
}

/**
 * Parse Set-Cookie header and extract cookie properties
 */
function parseSetCookie(setCookieHeader) {
  const result = {
    name: null,
    value: null,
    httpOnly: false,
    secure: false,
    sameSite: null,
    maxAge: null,
    path: null,
  };

  if (!setCookieHeader) return result;

  const parts = setCookieHeader.split(';').map(p => p.trim());

  // First part is name=value
  if (parts[0]) {
    const [name, ...valueParts] = parts[0].split('=');
    result.name = name;
    result.value = valueParts.join('=');
  }

  // Parse attributes
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();

    if (part === 'httponly') {
      result.httpOnly = true;
    } else if (part === 'secure') {
      result.secure = true;
    } else if (part.startsWith('samesite=')) {
      result.sameSite = parts[i].split('=')[1];
    } else if (part.startsWith('max-age=')) {
      result.maxAge = parseInt(parts[i].split('=')[1], 10);
    } else if (part.startsWith('path=')) {
      result.path = parts[i].split('=')[1];
    }
  }

  return result;
}

/**
 * Find Set-Cookie header for adminToken
 */
function findSetCookieHeader(headers) {
  return headers
    .split('\n')
    .find(line => line.toLowerCase().startsWith('set-cookie:') &&
                  line.toLowerCase().includes('admintoken'));
}

/**
 * Extract token from cookie jar file
 */
function extractTokenFromJar(jarPath) {
  if (!fs.existsSync(jarPath)) return null;
  const content = fs.readFileSync(jarPath, 'utf-8');
  const match = content.match(/adminToken\s+(\S+)/);
  return match ? match[1] : null;
}

/**
 * Simple test runner
 */
async function test(name, fn) {
  try {
    await fn();
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
  if (!value) {
    throw new Error(message || `Expected true, got ${value}`);
  }
}

function assertContains(str, substr, message) {
  if (!str || !str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to contain "${substr}"`);
  }
}

// ============================================
// CLEANUP
// ============================================

function cleanup() {
  for (const file of tempFiles) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// ============================================
// INITIAL LOGIN - Creates shared session
// ============================================

async function performInitialLogin() {
  console.log('\n--- Initial Login (creates shared session) ---\n');

  // Login and capture full response with headers
  const result = curlWithHeaders(
    `-X POST -c "${COOKIE_JAR}" -H "Content-Type: application/json" -d '{"password":"${ADMIN_PASSWORD}"}' "${BASE_URL}/api/admin/login"`
  );

  // Check if rate limited
  if (result.headers.includes('429')) {
    console.error('ERROR: Rate limited by server. Wait 15 minutes and try again.');
    console.error('The admin login rate limiter allows 5 attempts per 15 minutes.');
    process.exit(1);
  }

  let body;
  try {
    body = JSON.parse(result.body);
  } catch (e) {
    console.error('ERROR: Could not parse login response');
    console.error('Response:', result.body);
    process.exit(1);
  }

  if (!body.success) {
    console.error('ERROR: Login failed. Check ADMIN_PASSWORD matches server .env');
    console.error('Response:', body);
    process.exit(1);
  }

  // Extract token from cookie jar
  sharedToken = extractTokenFromJar(COOKIE_JAR);
  if (!sharedToken) {
    console.error('ERROR: No token found in cookie jar after login');
    process.exit(1);
  }

  console.log('  [OK] Login successful, session created');
  console.log(`  [OK] Token extracted: ${sharedToken.substring(0, 16)}...`);

  return { result, body };
}

// ============================================
// TEST SUITES
// ============================================

async function runLoginResponseTests(loginResult) {
  console.log('\n--- Login Response Tests ---\n');

  await test('Login returns success=true', async () => {
    const body = JSON.parse(loginResult.result.body);
    assertEqual(body.success, true, 'Login should succeed');
  });

  await test('Token is NOT returned in JSON body (security)', async () => {
    const body = JSON.parse(loginResult.result.body);
    assertEqual(body.token, undefined, 'Token should NOT be in JSON response');
  });

  await test('expiresAt is set to future timestamp', async () => {
    const body = JSON.parse(loginResult.result.body);
    assertTrue(body.expiresAt > Date.now(), 'expiresAt should be in the future');
  });
}

async function runCookieAttributeTests(loginResult) {
  console.log('\n--- Cookie Attribute Tests ---\n');

  const headers = loginResult.result.headers;
  const setCookieLine = findSetCookieHeader(headers);

  await test('Response has Set-Cookie header', async () => {
    assertTrue(!!setCookieLine, 'Response should have Set-Cookie header');
  });

  if (!setCookieLine) return; // Skip remaining tests if no cookie

  const cookieValue = setCookieLine.replace(/^set-cookie:\s*/i, '');
  const parsed = parseSetCookie(cookieValue);

  await test('Cookie name is "adminToken"', async () => {
    assertEqual(parsed.name, 'adminToken', 'Cookie name should be adminToken');
  });

  await test('Cookie has HttpOnly flag (XSS protection)', async () => {
    assertTrue(parsed.httpOnly, 'Cookie should have HttpOnly flag');
  });

  await test('Cookie has SameSite=Strict (CSRF protection)', async () => {
    assertEqual(parsed.sameSite?.toLowerCase(), 'strict', 'Cookie should have SameSite=Strict');
  });

  await test('Cookie has Path=/', async () => {
    assertEqual(parsed.path, '/', 'Cookie path should be /');
  });

  await test('Cookie has Max-Age=86400 (24 hours)', async () => {
    assertEqual(parsed.maxAge, 86400, 'Cookie Max-Age should be 86400 (24 hours)');
  });
}

async function runCookieAuthTests() {
  console.log('\n--- Cookie-based Authentication Tests ---\n');

  await test('Debug endpoint works with cookie', async () => {
    const result = curlSync(`-b "${COOKIE_JAR}" "${BASE_URL}/api/admin/debug"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.admin, true, 'Debug response should indicate admin access');
    assertTrue(!!body.config, 'Debug response should have config object');
    assertTrue(!!body.stats, 'Debug response should have stats object');
    assertTrue(!!body.server, 'Debug response should have server info');
  });

  await test('Status endpoint shows isAdmin=true with cookie', async () => {
    const result = curlSync(`-b "${COOKIE_JAR}" "${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.isAdmin, true, 'isAdmin should be true with valid cookie');
  });

  await test('Debug endpoint fails without cookie', async () => {
    const result = curlWithHeaders(`"${BASE_URL}/api/admin/debug"`);

    assertContains(result.headers, '401', 'Should return 401 status');
    const body = JSON.parse(result.body);
    assertTrue(!!body.error, 'Should return error message');
  });

  await test('Status endpoint shows isAdmin=false without cookie', async () => {
    const result = curlSync(`"${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.isAdmin, false, 'isAdmin should be false without cookie');
  });
}

async function runHeaderBackwardsCompatibilityTests() {
  console.log('\n--- X-Admin-Token Header Backwards Compatibility ---\n');

  await test('Debug endpoint works with X-Admin-Token header', async () => {
    const result = curlSync(`-H "X-Admin-Token: ${sharedToken}" "${BASE_URL}/api/admin/debug"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.admin, true, 'Debug should work with X-Admin-Token header');
  });

  await test('Status endpoint works with X-Admin-Token header', async () => {
    const result = curlSync(`-H "X-Admin-Token: ${sharedToken}" "${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.isAdmin, true, 'isAdmin should be true with X-Admin-Token header');
  });

  await test('Invalid X-Admin-Token returns isAdmin=false', async () => {
    const result = curlSync(`-H "X-Admin-Token: invalid-token-12345" "${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.isAdmin, false, 'isAdmin should be false with invalid token');
  });
}

async function runSecurityEdgeCases() {
  console.log('\n--- Security Edge Cases ---\n');

  await test('Cookie takes precedence over invalid query param', async () => {
    const result = curlSync(`-b "${COOKIE_JAR}" "${BASE_URL}/api/admin/status?adminToken=invalid-query-token"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.isAdmin, true, 'Cookie should take precedence over query param');
  });

  await test('Expired/invalid cookie returns isAdmin=false', async () => {
    const fakeJar = path.join(os.tmpdir(), `epswag-fake-cookies-${Date.now()}.txt`);
    tempFiles.push(fakeJar);

    fs.writeFileSync(fakeJar, `# Netscape HTTP Cookie File
localhost\tFALSE\t/\tFALSE\t9999999999\tadminToken\tfake-invalid-token-xyz
`);

    const result = curlSync(`-b "${fakeJar}" "${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);

    assertEqual(body.isAdmin, false, 'Invalid cookie token should return isAdmin=false');
  });
}

async function runLogoutTests() {
  console.log('\n--- Logout Tests ---\n');

  // Create a new session just for logout tests (uses 1 login attempt)
  const logoutJar = path.join(os.tmpdir(), `epswag-logout-test-${Date.now()}.txt`);
  tempFiles.push(logoutJar);

  // Login
  const loginResult = curlSync(
    `-X POST -c "${logoutJar}" -H "Content-Type: application/json" -d '{"password":"${ADMIN_PASSWORD}"}' "${BASE_URL}/api/admin/login"`
  );

  let loginBody;
  try {
    loginBody = JSON.parse(loginResult.stdout);
  } catch (e) {
    // Rate limited or other error
    console.log('  [SKIP] Logout tests skipped (rate limited or login failed)');
    return;
  }

  if (!loginBody.success) {
    console.log('  [SKIP] Logout tests skipped (login failed, possibly rate limited)');
    return;
  }

  const logoutToken = extractTokenFromJar(logoutJar);

  await test('Verify logged in before logout', async () => {
    const result = curlSync(`-b "${logoutJar}" "${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);
    assertEqual(body.isAdmin, true, 'Should be admin before logout');
  });

  await test('Logout returns success=true', async () => {
    const result = curlWithHeaders(`-X POST -b "${logoutJar}" -c "${logoutJar}" "${BASE_URL}/api/admin/logout"`);
    const body = JSON.parse(result.body);
    assertEqual(body.success, true, 'Logout should succeed');
  });

  await test('Logout clears the cookie (Set-Cookie with empty value)', async () => {
    // We need to login again to test logout's Set-Cookie header
    const jar2 = path.join(os.tmpdir(), `epswag-logout-test2-${Date.now()}.txt`);
    tempFiles.push(jar2);

    const login2 = curlSync(
      `-X POST -c "${jar2}" -H "Content-Type: application/json" -d '{"password":"${ADMIN_PASSWORD}"}' "${BASE_URL}/api/admin/login"`
    );

    let body2;
    try {
      body2 = JSON.parse(login2.stdout);
    } catch (e) {
      throw new Error('Rate limited during logout test');
    }

    if (!body2.success) {
      throw new Error('Login failed during logout test (possibly rate limited)');
    }

    const logoutResult = curlWithHeaders(`-X POST -b "${jar2}" -c "${jar2}" "${BASE_URL}/api/admin/logout"`);
    const setCookieLine = findSetCookieHeader(logoutResult.headers);

    assertTrue(!!setCookieLine, 'Should have Set-Cookie header to clear adminToken');
    assertContains(setCookieLine.toLowerCase(), 'admintoken=;', 'Cookie should be cleared');
  });

  await test('Debug endpoint fails after logout', async () => {
    const result = curlWithHeaders(`-b "${logoutJar}" "${BASE_URL}/api/admin/debug"`);
    assertContains(result.headers, '401', 'Should return 401 after logout');
  });

  await test('Token is invalidated after logout (using header)', async () => {
    if (!logoutToken) {
      throw new Error('No token to test');
    }
    const result = curlSync(`-H "X-Admin-Token: ${logoutToken}" "${BASE_URL}/api/admin/status"`);
    const body = JSON.parse(result.stdout);
    assertEqual(body.isAdmin, false, 'Token should be invalid after logout');
  });
}

async function runErrorHandlingTests() {
  console.log('\n--- Error Handling Tests ---\n');

  // Note: These tests may be skipped if rate limited (tests use 5 login attempts total)

  await test('Login with wrong password returns 401 (or 429 if rate limited)', async () => {
    const result = curlWithHeaders(
      `-X POST -H "Content-Type: application/json" -d '{"password":"wrongpassword"}' "${BASE_URL}/api/admin/login"`
    );

    // Accept both 401 (wrong password) and 429 (rate limited)
    const is401 = result.headers.includes('401');
    const is429 = result.headers.includes('429');

    assertTrue(is401 || is429, 'Should return 401 or 429 status');

    const body = JSON.parse(result.body);
    assertTrue(!!body.error, 'Should return error message');

    if (is429) {
      console.log('         (Rate limited - expected 401, got 429)');
    }
  });

  await test('Login without password returns 400 (or 429 if rate limited)', async () => {
    const result = curlWithHeaders(
      `-X POST -H "Content-Type: application/json" -d '{}' "${BASE_URL}/api/admin/login"`
    );

    // Accept both 400 (missing password) and 429 (rate limited)
    const is400 = result.headers.includes('400');
    const is429 = result.headers.includes('429');

    assertTrue(is400 || is429, 'Should return 400 or 429 status');

    const body = JSON.parse(result.body);
    assertTrue(!!body.error, 'Should return error message');

    if (is429) {
      console.log('         (Rate limited - expected 400, got 429)');
    }
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Admin Cookie Security Tests - Pimp My Epstein');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);
  console.log(`Cookie jar: ${COOKIE_JAR}`);
  console.log('');
  console.log('NOTE: Tests are optimized to minimize login attempts');
  console.log('(Rate limit: 5 attempts per 15 minutes)');
  console.log('');

  // Check if curl is available
  try {
    execSync('curl --version', { encoding: 'utf-8' });
  } catch {
    console.error('ERROR: curl is not installed or not in PATH');
    process.exit(1);
  }

  // Check if server is running
  try {
    const healthResult = curlSync(`"${BASE_URL}/api/health"`);
    const health = JSON.parse(healthResult.stdout);
    if (health.status !== 'ok') {
      throw new Error('Server health check failed');
    }
    console.log('Server is running and healthy');
  } catch (error) {
    console.error('ERROR: Server is not running or not accessible');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error(`Run: npm run server`);
    console.error('');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Check if admin is configured
  const statusResult = curlSync(`"${BASE_URL}/api/admin/status"`);
  const statusBody = JSON.parse(statusResult.stdout);
  if (!statusBody.adminConfigured) {
    console.error('ERROR: ADMIN_PASSWORD is not configured on the server');
    console.error('Set ADMIN_PASSWORD in .env file');
    process.exit(1);
  }
  console.log('Admin mode is configured');
  console.log('');

  // Run all test suites
  try {
    // Initial login creates shared session (uses 1 login attempt)
    const loginResult = await performInitialLogin();

    // These tests use the shared session (no additional logins)
    await runLoginResponseTests(loginResult);
    await runCookieAttributeTests(loginResult);
    await runCookieAuthTests();
    await runHeaderBackwardsCompatibilityTests();
    await runSecurityEdgeCases();

    // Logout tests need their own sessions (uses 2-3 login attempts)
    await runLogoutTests();

    // Error handling tests (uses 2 login attempts - failed ones don't count same)
    await runErrorHandlingTests();

  } finally {
    cleanup();
  }

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

main().catch(error => {
  cleanup();
  console.error('Test runner error:', error);
  process.exit(1);
});
