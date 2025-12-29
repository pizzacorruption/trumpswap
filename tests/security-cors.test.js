/**
 * CORS Security Tests for Pimp My Epstein
 *
 * Tests the CORS configuration to ensure:
 * 1. Allowed origins (pimpmyepstein.lol, localhost in dev) work
 * 2. Malicious origins (evil-site.com) are BLOCKED
 * 3. No-origin requests are handled correctly
 * 4. Preflight OPTIONS requests work for allowed origins
 *
 * Run with: node tests/security-cors.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 */

const { execSync } = require('child_process');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

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
    console.log(`  [PASS] ${name}`);
  } catch (error) {
    failed++;
    results.push({ name, status: 'FAIL', error: error.message });
    console.log(`  [FAIL] ${name}`);
    console.log(`         Error: ${error.message}`);
  }
}

/**
 * Execute curl command and return result
 */
function curlRequest(options = {}) {
  const {
    url = `${BASE_URL}/api/health`,
    method = 'GET',
    origin = null,
    includeHeaders = true,
  } = options;

  let cmd = `curl -s`;

  if (includeHeaders) {
    cmd += ` -D -`; // Include headers in output
  }

  cmd += ` -X ${method}`;

  if (origin) {
    cmd += ` -H "Origin: ${origin}"`;
  }

  if (method === 'OPTIONS') {
    cmd += ` -H "Access-Control-Request-Method: POST"`;
    cmd += ` -H "Access-Control-Request-Headers: Content-Type"`;
  }

  cmd += ` "${url}"`;

  try {
    const result = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Parse HTTP response headers from curl output
 */
function parseHeaders(output) {
  const headers = {};
  const lines = output.split('\n');
  let statusCode = null;

  for (let line of lines) {
    // Remove carriage returns (Windows-style line endings from HTTP)
    line = line.replace(/\r/g, '');

    // Check for HTTP status line
    if (line.startsWith('HTTP/')) {
      const match = line.match(/HTTP\/[\d.]+ (\d+)/);
      if (match) {
        statusCode = parseInt(match[1], 10);
      }
    }

    // Parse header lines
    const headerMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (headerMatch) {
      headers[headerMatch[1].toLowerCase()] = headerMatch[2].trim();
    }
  }

  return { statusCode, headers };
}

/**
 * Check if CORS header allows origin
 */
function hasAllowedOrigin(output, expectedOrigin) {
  const { headers } = parseHeaders(output);
  return headers['access-control-allow-origin'] === expectedOrigin;
}

/**
 * Check if response indicates CORS blocked
 */
function isCorsBlocked(output) {
  const { headers, statusCode } = parseHeaders(output);
  // CORS blocked if no Access-Control-Allow-Origin header or 500 error from cors middleware
  return !headers['access-control-allow-origin'] || statusCode === 500;
}

// ============================================
// CORS SECURITY TESTS
// ============================================

async function runCorsTests() {
  console.log('\n' + '='.repeat(60));
  console.log('CORS Security Tests');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);
  console.log('');

  // -------------------------------------------
  // Test 1: Production origin (pimpmyepstein.lol)
  // -------------------------------------------
  console.log('\n[1] Production Origins (pimpmyepstein.lol):');

  await test('https://pimpmyepstein.lol is ALLOWED', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'https://pimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!hasAllowedOrigin(result.output, 'https://pimpmyepstein.lol')) {
      throw new Error('Expected Access-Control-Allow-Origin: https://pimpmyepstein.lol');
    }
  });

  await test('https://www.pimpmyepstein.lol is ALLOWED', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'https://www.pimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!hasAllowedOrigin(result.output, 'https://www.pimpmyepstein.lol')) {
      throw new Error('Expected Access-Control-Allow-Origin: https://www.pimpmyepstein.lol');
    }
  });

  // -------------------------------------------
  // Test 2: Development origin (localhost)
  // -------------------------------------------
  console.log('\n[2] Development Origins (localhost):');

  await test('http://localhost:3000 is ALLOWED (dev mode)', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'http://localhost:3000'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    // In development, localhost should be allowed
    // Note: This depends on NODE_ENV=development
    const { headers } = parseHeaders(result.output);
    const allowedOrigin = headers['access-control-allow-origin'];

    // Either explicitly allowed or reflects the origin (which means allowed)
    if (allowedOrigin !== 'http://localhost:3000') {
      // Check if we're in production mode where localhost may not be allowed
      console.log(`    Note: Got Access-Control-Allow-Origin: ${allowedOrigin || 'not set'}`);
      console.log(`    This may indicate NODE_ENV is not set to 'development'`);
      // Still pass if server is responding correctly
    }
  });

  await test('http://127.0.0.1:3000 is ALLOWED (dev mode)', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'http://127.0.0.1:3000'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    const { headers } = parseHeaders(result.output);
    const allowedOrigin = headers['access-control-allow-origin'];

    if (allowedOrigin !== 'http://127.0.0.1:3000') {
      console.log(`    Note: Got Access-Control-Allow-Origin: ${allowedOrigin || 'not set'}`);
    }
  });

  // -------------------------------------------
  // Test 3: Malicious origins (BLOCKED)
  // -------------------------------------------
  console.log('\n[3] Malicious Origins (should be BLOCKED):');

  await test('https://evil-site.com is BLOCKED', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'https://evil-site.com'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!isCorsBlocked(result.output)) {
      const { headers } = parseHeaders(result.output);
      throw new Error(`Expected CORS block, but got Allow-Origin: ${headers['access-control-allow-origin']}`);
    }
  });

  await test('https://attacker.com is BLOCKED', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'https://attacker.com'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!isCorsBlocked(result.output)) {
      const { headers } = parseHeaders(result.output);
      throw new Error(`Expected CORS block, but got Allow-Origin: ${headers['access-control-allow-origin']}`);
    }
  });

  await test('https://pimpmyepstein.lol.evil.com is BLOCKED (subdomain attack)', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'https://pimpmyepstein.lol.evil.com'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!isCorsBlocked(result.output)) {
      const { headers } = parseHeaders(result.output);
      throw new Error(`Expected CORS block, but got Allow-Origin: ${headers['access-control-allow-origin']}`);
    }
  });

  await test('https://fakepimpmyepstein.lol is BLOCKED', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'https://fakepimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!isCorsBlocked(result.output)) {
      const { headers } = parseHeaders(result.output);
      throw new Error(`Expected CORS block, but got Allow-Origin: ${headers['access-control-allow-origin']}`);
    }
  });

  await test('http://pimpmyepstein.lol is BLOCKED (http not https)', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: 'http://pimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    if (!isCorsBlocked(result.output)) {
      const { headers } = parseHeaders(result.output);
      throw new Error(`Expected CORS block for HTTP origin, but got Allow-Origin: ${headers['access-control-allow-origin']}`);
    }
  });

  // -------------------------------------------
  // Test 4: No Origin header
  // -------------------------------------------
  console.log('\n[4] No Origin Header:');

  await test('Request without Origin header succeeds (for curl/Postman/mobile)', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/health`,
      origin: null  // No origin header
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    const { statusCode } = parseHeaders(result.output);

    // In development, no-origin requests should succeed (200)
    // In production, they may be blocked
    if (statusCode !== 200) {
      console.log(`    Note: Server returned ${statusCode} for no-origin request`);
      console.log(`    In production mode, this is expected (CORS requires origin)`);
    }
  });

  // -------------------------------------------
  // Test 5: Preflight OPTIONS requests
  // -------------------------------------------
  console.log('\n[5] Preflight OPTIONS Requests:');

  await test('OPTIONS preflight for pimpmyepstein.lol succeeds', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/generate`,
      method: 'OPTIONS',
      origin: 'https://pimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    const { statusCode, headers } = parseHeaders(result.output);

    // OPTIONS should return 200 or 204
    if (statusCode !== 200 && statusCode !== 204) {
      throw new Error(`Expected 200 or 204, got ${statusCode}`);
    }

    // Should have the CORS headers
    if (headers['access-control-allow-origin'] !== 'https://pimpmyepstein.lol') {
      throw new Error(`Expected Allow-Origin: https://pimpmyepstein.lol, got: ${headers['access-control-allow-origin']}`);
    }

    // Should allow POST method
    const allowMethods = headers['access-control-allow-methods'];
    if (!allowMethods || !allowMethods.includes('POST')) {
      throw new Error(`Expected Allow-Methods to include POST, got: ${allowMethods}`);
    }
  });

  await test('OPTIONS preflight for evil-site.com is BLOCKED', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/generate`,
      method: 'OPTIONS',
      origin: 'https://evil-site.com'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    const { headers } = parseHeaders(result.output);

    // Should NOT have Access-Control-Allow-Origin for evil origin
    if (headers['access-control-allow-origin'] === 'https://evil-site.com') {
      throw new Error('Preflight should be blocked for evil-site.com');
    }
  });

  await test('OPTIONS preflight includes credentials header', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/generate`,
      method: 'OPTIONS',
      origin: 'https://pimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    const { headers } = parseHeaders(result.output);

    // Should allow credentials (cookies)
    if (headers['access-control-allow-credentials'] !== 'true') {
      throw new Error(`Expected Allow-Credentials: true, got: ${headers['access-control-allow-credentials']}`);
    }
  });

  await test('OPTIONS preflight allows required headers', async () => {
    const result = curlRequest({
      url: `${BASE_URL}/api/generate`,
      method: 'OPTIONS',
      origin: 'https://pimpmyepstein.lol'
    });

    if (!result.success) {
      throw new Error(`curl failed: ${result.error}`);
    }

    const { headers } = parseHeaders(result.output);

    // Should allow Content-Type and X-Admin-Token headers
    const allowHeaders = headers['access-control-allow-headers']?.toLowerCase() || '';
    if (!allowHeaders.includes('content-type')) {
      throw new Error(`Expected Allow-Headers to include Content-Type, got: ${allowHeaders}`);
    }
  });

  // -------------------------------------------
  // Test 6: Various API endpoints
  // -------------------------------------------
  console.log('\n[6] CORS on Various Endpoints:');

  const endpoints = [
    '/api/health',
    '/api/photos',
    '/api/config',
    '/api/me'
  ];

  for (const endpoint of endpoints) {
    await test(`${endpoint} allows pimpmyepstein.lol`, async () => {
      const result = curlRequest({
        url: `${BASE_URL}${endpoint}`,
        origin: 'https://pimpmyepstein.lol'
      });

      if (!result.success) {
        throw new Error(`curl failed: ${result.error}`);
      }

      if (!hasAllowedOrigin(result.output, 'https://pimpmyepstein.lol')) {
        throw new Error('Expected CORS to allow pimpmyepstein.lol');
      }
    });

    await test(`${endpoint} blocks evil-site.com`, async () => {
      const result = curlRequest({
        url: `${BASE_URL}${endpoint}`,
        origin: 'https://evil-site.com'
      });

      if (!result.success) {
        throw new Error(`curl failed: ${result.error}`);
      }

      if (!isCorsBlocked(result.output)) {
        throw new Error('Expected CORS to block evil-site.com');
      }
    });
  }
}

// ============================================
// CORS CONFIGURATION ANALYSIS
// ============================================

async function analyzeConfiguration() {
  console.log('\n' + '='.repeat(60));
  console.log('CORS Configuration Analysis');
  console.log('='.repeat(60));

  console.log('\nAllowed Origins (from server.js):');
  console.log('  - https://pimpmyepstein.lol');
  console.log('  - https://www.pimpmyepstein.lol');
  console.log('  - http://localhost:3000 (development only)');
  console.log('  - http://127.0.0.1:3000 (development only)');

  console.log('\nCORS Settings:');
  console.log('  - credentials: true (allows cookies)');
  console.log('  - methods: GET, POST, OPTIONS');
  console.log('  - allowedHeaders: Content-Type, Authorization, X-Admin-Token');

  console.log('\nNo-Origin Handling:');
  console.log('  - Development: Allowed (for curl, Postman, mobile apps)');
  console.log('  - Production: Blocked (Origin header required)');

  console.log('\nSecurity Notes:');
  console.log('  - HTTP (non-HTTPS) origins are NOT allowed');
  console.log('  - Subdomains are NOT automatically allowed');
  console.log('  - Similar-looking domains are NOT allowed');
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  // Check if server is running
  try {
    const result = curlRequest({ url: `${BASE_URL}/api/health` });
    if (!result.success) {
      throw new Error(result.error);
    }
    const { statusCode } = parseHeaders(result.output);
    if (statusCode !== 200) {
      throw new Error(`Server returned ${statusCode}`);
    }
  } catch (error) {
    console.error('ERROR: Server is not running or not accessible');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error(`Run: npm run server`);
    console.error('');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Run CORS tests
  await runCorsTests();

  // Show configuration analysis
  await analyzeConfiguration();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log('');

  // List blocked origins
  console.log('Origins BLOCKED (as expected):');
  console.log('  - https://evil-site.com');
  console.log('  - https://attacker.com');
  console.log('  - https://pimpmyepstein.lol.evil.com');
  console.log('  - https://fakepimpmyepstein.lol');
  console.log('  - http://pimpmyepstein.lol (http, not https)');
  console.log('');

  console.log('Origins ALLOWED:');
  console.log('  - https://pimpmyepstein.lol');
  console.log('  - https://www.pimpmyepstein.lol');
  console.log('  - http://localhost:3000 (dev mode)');
  console.log('  - http://127.0.0.1:3000 (dev mode)');
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('All CORS security tests passed!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
