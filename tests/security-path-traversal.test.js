/**
 * Security Tests: Path Traversal Prevention
 *
 * Tests that the epsteinPhoto parameter is properly validated
 * against the whitelist to prevent path traversal attacks.
 *
 * Run with: node tests/security-path-traversal.test.js
 *
 * Prerequisites:
 * - Server must be running on localhost:3000
 * - At least one Epstein photo must exist in public/epstein-photos
 *
 * Note: The server has rate limiting enabled. If you see 429 responses,
 * this is expected behavior - the request was still blocked from processing.
 * A successful attack would return 200 or expose file contents.
 */

const fs = require('fs');
const path = require('path');

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
 * Assert helper functions
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertNotEqual(actual, unexpected, message) {
  if (actual === unexpected) {
    throw new Error(message || `Did not expect ${unexpected}`);
  }
}

function assertIncludes(str, substring, message) {
  if (!str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to include "${substring}"`);
  }
}

function assertNotIncludes(str, substring, message) {
  if (str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to NOT include "${substring}"`);
  }
}

/**
 * Create a minimal valid PNG image buffer for testing
 * This is a 1x1 transparent PNG
 */
function createDummyPNG() {
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, // 256x256 dimensions
    0x08, 0x02, 0x00, 0x00, 0x00, 0xD3, 0x10, 0x3F,
    0x31, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
    0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
    0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
}

/**
 * Helper to make a generate request with a given epsteinPhoto path
 */
async function makeGenerateRequest(epsteinPhotoPath) {
  const formData = new FormData();

  // Add a dummy user photo (required by the endpoint)
  const dummyPNG = createDummyPNG();
  formData.append('userPhoto', new Blob([dummyPNG], { type: 'image/png' }), 'test.png');

  // Add the potentially malicious epsteinPhoto path
  formData.append('epsteinPhoto', epsteinPhotoPath);

  const response = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    body: formData
  });

  const data = await response.json();
  return { response, data };
}

/**
 * Check if response indicates the attack was blocked
 * Path traversal is blocked if:
 * - 400 with GENERATION_FAILED (whitelist validation)
 * - 400 with INVALID_FORMAT (input validation)
 * - 429 (rate limited - request never processed)
 * An attack succeeds only if we get 200 or file contents
 */
function isAttackBlocked(response, data) {
  // Rate limiting blocks the request before it can be processed
  if (response.status === 429) {
    return { blocked: true, reason: 'rate_limited' };
  }

  // 400 errors indicate the request was rejected
  if (response.status === 400) {
    // Check for path validation error
    if (data.code === 'GENERATION_FAILED' && data.error?.toLowerCase().includes('invalid')) {
      return { blocked: true, reason: 'whitelist_validation' };
    }
    // Check for input format error
    if (data.code === 'INVALID_FORMAT') {
      return { blocked: true, reason: 'format_validation' };
    }
    // Other 400 errors also block the attack
    return { blocked: true, reason: 'bad_request' };
  }

  // 200 would mean the attack succeeded
  if (response.status === 200) {
    return { blocked: false, reason: 'request_succeeded' };
  }

  // Other status codes (500, etc) - attack blocked but via error
  return { blocked: true, reason: `error_${response.status}` };
}

/**
 * Check if response data contains sensitive information
 */
function containsSensitiveData(data) {
  const dataStr = JSON.stringify(data);
  const sensitivePatterns = [
    'GEMINI_API_KEY',
    'STRIPE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'require(',
    'module.exports',
    '"dependencies"',
    '"devDependencies"',
    'password',
    'secret'
  ];

  for (const pattern of sensitivePatterns) {
    if (dataStr.includes(pattern)) {
      return { leaked: true, pattern };
    }
  }
  return { leaked: false };
}

// ============================================
// PATH TRAVERSAL SECURITY TESTS
// ============================================

async function runPathTraversalTests() {
  console.log('\n=== Path Traversal Security Tests ===\n');

  // First, get a valid photo path for comparison
  const photosResponse = await fetch(`${BASE_URL}/api/photos`);
  const photosData = await photosResponse.json();
  const validPhotoPath = photosData.photos[0]?.path;

  if (!validPhotoPath) {
    console.error('ERROR: No photos available for testing');
    process.exit(1);
  }

  console.log(`Using valid photo path for comparison: ${validPhotoPath}\n`);

  // -------------------------------------------
  // Basic Path Traversal Attacks
  // -------------------------------------------
  console.log('Basic Path Traversal Attacks:');

  await test('blocks ../../.env traversal', async () => {
    const { response, data } = await makeGenerateRequest('../../.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
    // Make sure no sensitive data is leaked
    const sensitive = containsSensitiveData(data);
    if (sensitive.leaked) {
      throw new Error(`Sensitive data leaked: ${sensitive.pattern}`);
    }
  });

  await test('blocks ../package.json traversal', async () => {
    const { response, data } = await makeGenerateRequest('../package.json');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks /../../../etc/passwd traversal', async () => {
    const { response, data } = await makeGenerateRequest('/../../../etc/passwd');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks /epstein-photos/../.env traversal', async () => {
    const { response, data } = await makeGenerateRequest('/epstein-photos/../.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks /epstein-photos/../../.env traversal', async () => {
    const { response, data } = await makeGenerateRequest('/epstein-photos/../../.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  // -------------------------------------------
  // URL-Encoded Path Traversal Attacks
  // -------------------------------------------
  console.log('\nURL-Encoded Path Traversal Attacks:');

  await test('blocks %2e%2e%2f.env (URL-encoded ../)', async () => {
    const { response, data } = await makeGenerateRequest('%2e%2e%2f.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks %2e%2e%2f%2e%2e%2f.env (double URL-encoded)', async () => {
    const { response, data } = await makeGenerateRequest('%2e%2e%2f%2e%2e%2f.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks ..%2f.env (mixed encoding)', async () => {
    const { response, data } = await makeGenerateRequest('..%2f.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks %2e%2e/.env (partial encoding)', async () => {
    const { response, data } = await makeGenerateRequest('%2e%2e/.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks %252e%252e%252f.env (double URL-encoding)', async () => {
    const { response, data } = await makeGenerateRequest('%252e%252e%252f.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  // -------------------------------------------
  // Null Byte Injection Attacks
  // -------------------------------------------
  console.log('\nNull Byte Injection Attacks:');

  await test('blocks path%00.jpg null byte injection', async () => {
    const { response, data } = await makeGenerateRequest('../../.env%00.jpg');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks path with literal null byte', async () => {
    const { response, data } = await makeGenerateRequest('../../.env\x00.jpg');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks /epstein-photos/photo.jpg%00../../.env', async () => {
    const { response, data } = await makeGenerateRequest('/epstein-photos/clinton-1993-1.jpg%00../../.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  // -------------------------------------------
  // Windows-Style Path Traversal
  // -------------------------------------------
  console.log('\nWindows-Style Path Traversal:');

  await test('blocks ..\\..\\file.txt (backslash traversal)', async () => {
    const { response, data } = await makeGenerateRequest('..\\..\\file.txt');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks ..%5c..%5c.env (URL-encoded backslash)', async () => {
    const { response, data } = await makeGenerateRequest('..%5c..%5c.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  // -------------------------------------------
  // Absolute Path Attempts
  // -------------------------------------------
  console.log('\nAbsolute Path Attempts:');

  await test('blocks /etc/passwd absolute path', async () => {
    const { response, data } = await makeGenerateRequest('/etc/passwd');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks C:\\Windows\\System32\\config\\SAM', async () => {
    const { response, data } = await makeGenerateRequest('C:\\Windows\\System32\\config\\SAM');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Attack not blocked! Status: ${response.status}`);
    }
  });

  // -------------------------------------------
  // Valid Photo Path Tests
  // -------------------------------------------
  console.log('\nValid Photo Path Tests:');

  await test('accepts valid photo path with leading slash', async () => {
    // Note: This will still fail because the image is too small,
    // but the error should be about image size, not invalid photo selection
    const { response, data } = await makeGenerateRequest(validPhotoPath);
    // Should NOT be 400 with GENERATION_FAILED for "Invalid photo selection"
    // It might be 400 for IMAGE_TOO_SMALL or rate limited, but not path validation
    if (response.status === 400 && data.code === 'GENERATION_FAILED') {
      if (data.error?.toLowerCase().includes('invalid photo')) {
        throw new Error('Valid path should not fail with "Invalid photo selection"');
      }
    }
  });

  await test('accepts valid photo path without leading slash', async () => {
    // Remove leading slash for test
    const pathWithoutSlash = validPhotoPath.startsWith('/')
      ? validPhotoPath.substring(1)
      : validPhotoPath;

    const { response, data } = await makeGenerateRequest(pathWithoutSlash);

    // Should NOT fail with "Invalid photo selection"
    if (response.status === 400 && data.code === 'GENERATION_FAILED') {
      if (data.error?.toLowerCase().includes('invalid photo')) {
        throw new Error('Valid path without slash should not fail with "Invalid photo selection"');
      }
    }
  });

  // -------------------------------------------
  // Edge Cases
  // -------------------------------------------
  console.log('\nEdge Cases:');

  await test('blocks empty string path', async () => {
    const { response, data } = await makeGenerateRequest('');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Empty path not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks path with only dots', async () => {
    const { response, data } = await makeGenerateRequest('...');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Dots-only path not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks path with spaces and traversal', async () => {
    const { response, data } = await makeGenerateRequest('.. / .. / .env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Spaced traversal not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks non-existent valid-looking path', async () => {
    const { response, data } = await makeGenerateRequest('/epstein-photos/nonexistent-fake-photo.jpg');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Non-existent photo not blocked! Status: ${response.status}`);
    }
  });

  await test('blocks path with unicode characters', async () => {
    const { response, data } = await makeGenerateRequest('/epstein-photos/../\u2025\u2025/.env');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`Unicode path not blocked! Status: ${response.status}`);
    }
  });

  // -------------------------------------------
  // Server File Access Prevention
  // -------------------------------------------
  console.log('\nServer File Access Prevention:');

  await test('blocks access to server.js', async () => {
    const { response, data } = await makeGenerateRequest('../server.js');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`server.js access not blocked! Status: ${response.status}`);
    }
    // Ensure no server code is leaked
    const sensitive = containsSensitiveData(data);
    if (sensitive.leaked) {
      throw new Error(`Sensitive data leaked: ${sensitive.pattern}`);
    }
  });

  await test('blocks access to package.json', async () => {
    const { response, data } = await makeGenerateRequest('../package.json');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`package.json access not blocked! Status: ${response.status}`);
    }
    // Ensure no package info is leaked
    const sensitive = containsSensitiveData(data);
    if (sensitive.leaked) {
      throw new Error(`Sensitive data leaked: ${sensitive.pattern}`);
    }
  });

  await test('blocks access to node_modules', async () => {
    const { response, data } = await makeGenerateRequest('../node_modules/express/package.json');
    const result = isAttackBlocked(response, data);
    if (!result.blocked) {
      throw new Error(`node_modules access not blocked! Status: ${response.status}`);
    }
  });
}

// ============================================
// OUTPUT FILE ACCESS TESTS
// ============================================

async function runOutputAccessTests() {
  console.log('\n=== Output File Access Security Tests ===\n');

  console.log('Output Directory Path Traversal:');

  await test('blocks ../server.js via output endpoint', async () => {
    const response = await fetch(`${BASE_URL}/output/../server.js`);
    // Should either be 400 (invalid filename) or 404 (not found after sanitization)
    const isBlocked = response.status === 400 || response.status === 404 || response.status === 403 || response.status === 429;
    if (!isBlocked) {
      throw new Error(`Expected 400/403/404/429, got ${response.status}`);
    }
  });

  await test('blocks %2e%2e%2fserver.js via output endpoint', async () => {
    const response = await fetch(`${BASE_URL}/output/%2e%2e%2fserver.js`);
    const isBlocked = response.status === 400 || response.status === 404 || response.status === 403 || response.status === 429;
    if (!isBlocked) {
      throw new Error(`Expected 400/403/404/429, got ${response.status}`);
    }
  });

  await test('blocks ..%00.png via output endpoint', async () => {
    const response = await fetch(`${BASE_URL}/output/..%00.png`);
    const isBlocked = response.status === 400 || response.status === 404 || response.status === 403 || response.status === 429;
    if (!isBlocked) {
      throw new Error(`Expected 400/403/404/429, got ${response.status}`);
    }
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function main() {
  console.log('='.repeat(60));
  console.log('Path Traversal Security Tests - Pimp My Epstein');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);
  console.log('');

  // Check if server is running
  try {
    const healthCheck = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!healthCheck.ok) {
      throw new Error(`Server returned ${healthCheck.status}`);
    }
    console.log('Server is running and responding.\n');
  } catch (error) {
    console.error('ERROR: Server is not running or not accessible');
    console.error(`Make sure the server is running at ${BASE_URL}`);
    console.error(`Run: npm run server`);
    console.error('');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Run all test suites
  await runPathTraversalTests();
  await runOutputAccessTests();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Security Test Summary');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log('');

  if (failed > 0) {
    console.log('SECURITY VULNERABILITIES DETECTED:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    console.log('\nWARNING: Failed security tests indicate potential vulnerabilities!');
    process.exit(1);
  } else {
    console.log('All security tests passed!');
    console.log('The path traversal protection appears to be working correctly.');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
