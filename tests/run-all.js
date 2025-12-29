#!/usr/bin/env node
/**
 * Run All Tests
 *
 * Executes all test files in sequence and generates a comprehensive report.
 *
 * Usage:
 *   node tests/run-all.js                    # Run all tests
 *   node tests/run-all.js --unit             # Run only unit tests
 *   node tests/run-all.js --integration      # Run only integration tests
 *   node tests/run-all.js --api              # Run only API tests
 *   node tests/run-all.js --report           # Generate HTML report
 *   node tests/run-all.js --verbose          # Verbose output
 *   node tests/run-all.js --bail             # Stop on first failure
 *   node tests/run-all.js --coverage         # Track coverage info
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================

const TESTS_DIR = __dirname;
const PROJECT_ROOT = path.join(__dirname, '..');

// Test files in order of execution (organized by category)
const TEST_FILES = [
  // Unit tests (no server required, test individual modules)
  { name: 'unit', file: 'unit.test.js', description: 'Unit Tests', category: 'unit' },
  { name: 'services-usage', file: 'services-usage.test.js', description: 'Usage Service Tests', category: 'unit' },
  { name: 'services-generations', file: 'services-generations.test.js', description: 'Generations Service Tests', category: 'unit' },
  { name: 'services-stripe', file: 'services-stripe.test.js', description: 'Stripe Service Tests', category: 'unit' },
  { name: 'lib-supabase', file: 'lib-supabase.test.js', description: 'Supabase Library Tests', category: 'unit' },

  // Middleware tests
  { name: 'middleware-auth', file: 'middleware-auth.test.js', description: 'Auth Middleware Tests', category: 'middleware' },
  { name: 'middleware-ratelimit', file: 'middleware-ratelimit.test.js', description: 'Rate Limit Middleware Tests', category: 'middleware' },

  // Integration tests (test modules working together)
  { name: 'integration', file: 'integration.test.js', description: 'Integration Tests', category: 'integration' },
  { name: 'error-handling', file: 'error-handling.test.js', description: 'Error Handling Tests', category: 'integration' },

  // Security tests
  { name: 'security-rate-limit', file: 'security-rate-limit.test.js', description: 'Rate Limit Security Tests', category: 'security' },
  { name: 'security-payment-auth', file: 'security-payment-auth.test.js', description: 'Payment Auth Security Tests', category: 'security' },
  { name: 'security-file-upload', file: 'security-file-upload.test.js', description: 'File Upload Security Tests', category: 'security' },
  { name: 'security-admin-cookie', file: 'security-admin-cookie.test.js', description: 'Admin Cookie Security Tests', category: 'security' },
  { name: 'security-path-traversal', file: 'security-path-traversal.test.js', description: 'Path Traversal Security Tests', category: 'security' },
  { name: 'security-cors', file: 'security-cors.test.js', description: 'CORS Security Tests', category: 'security' },
  { name: 'security-headers', file: 'security-headers.test.js', description: 'Security Headers Tests', category: 'security' },
  { name: 'security-output-access', file: 'security-output-access.test.js', description: 'Output Access Security Tests', category: 'security' },

  // API tests (require running server)
  { name: 'api', file: 'api.test.js', description: 'API Endpoint Tests', category: 'api', requiresServer: true },
  { name: 'api-functionality', file: 'api-functionality.test.js', description: 'API Functionality Tests', category: 'api', requiresServer: true },

  // E2E tests (full workflow tests)
  { name: 'e2e-full', file: 'e2e-full.test.js', description: 'End-to-End Tests', category: 'e2e', requiresServer: true },
];

// ============================================
// CLI ARGUMENT PARSING
// ============================================

const args = process.argv.slice(2);

const options = {
  unit: args.includes('--unit'),
  middleware: args.includes('--middleware'),
  integration: args.includes('--integration'),
  security: args.includes('--security'),
  api: args.includes('--api'),
  e2e: args.includes('--e2e'),
  report: args.includes('--report'),
  verbose: args.includes('--verbose'),
  bail: args.includes('--bail'),
  coverage: args.includes('--coverage'),
  help: args.includes('--help') || args.includes('-h'),
};

// If no specific tests selected, run all
const runAll = !options.unit && !options.middleware && !options.integration &&
               !options.security && !options.api && !options.e2e;

// ============================================
// HELP TEXT
// ============================================

function showHelp() {
  console.log(`
Pimp My Epstein Test Runner
===========================

Usage: node tests/run-all.js [options]

Test Categories:
  --unit          Run unit tests (services, libs)
  --middleware    Run middleware tests (auth, rate-limit)
  --integration   Run integration tests (module interactions)
  --security      Run security tests (CORS, headers, path traversal, etc.)
  --api           Run API endpoint tests (requires running server)
  --e2e           Run end-to-end tests (requires running server)

Options:
  --report        Generate HTML test report
  --verbose       Show detailed output
  --bail          Stop on first test failure
  --coverage      Track test coverage information
  --help, -h      Show this help message

Examples:
  node tests/run-all.js                    # Run all tests
  node tests/run-all.js --unit             # Run only unit tests
  node tests/run-all.js --security         # Run only security tests
  node tests/run-all.js --api --verbose    # Run API tests with verbose output
  node tests/run-all.js --report           # Run all tests and generate report
  node tests/run-all.js --unit --security  # Run unit and security tests
`);
}

if (options.help) {
  showHelp();
  process.exit(0);
}

// ============================================
// TEST RUNNER
// ============================================

/**
 * Run a single test file
 */
function runTestFile(testInfo) {
  return new Promise((resolve) => {
    const testPath = path.join(TESTS_DIR, testInfo.file);

    if (!fs.existsSync(testPath)) {
      console.log(`  [SKIP] ${testInfo.description} - file not found: ${testInfo.file}`);
      resolve({
        name: testInfo.name,
        description: testInfo.description,
        status: 'skipped',
        reason: 'File not found',
        duration: 0,
        output: '',
        passed: 0,
        failed: 0,
      });
      return;
    }

    const startTime = Date.now();
    let output = '';
    let passed = 0;
    let failed = 0;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${testInfo.description}`);
    console.log(`File: ${testInfo.file}`);
    console.log('='.repeat(60));

    const env = {
      ...process.env,
      TEST_VERBOSE: options.verbose ? 'true' : 'false',
      TEST_COVERAGE: options.coverage ? 'true' : 'false',
    };

    const child = spawn('node', [testPath], {
      cwd: PROJECT_ROOT,
      env,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });

    if (!options.verbose) {
      child.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);

        // Count passes and failures from output
        const passMatches = text.match(/✓/g);
        const failMatches = text.match(/✗/g);
        if (passMatches) passed += passMatches.length;
        if (failMatches) failed += failMatches.length;
      });

      child.stderr.on('data', (data) => {
        output += data.toString();
        process.stderr.write(data);
      });
    }

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      const status = code === 0 ? 'passed' : 'failed';

      resolve({
        name: testInfo.name,
        description: testInfo.description,
        status,
        exitCode: code,
        duration,
        output,
        passed,
        failed,
      });
    });

    child.on('error', (err) => {
      const duration = Date.now() - startTime;
      resolve({
        name: testInfo.name,
        description: testInfo.description,
        status: 'error',
        error: err.message,
        duration,
        output,
        passed,
        failed,
      });
    });
  });
}

/**
 * Check if server is running (for API tests)
 */
async function checkServerRunning() {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  PIMP MY EPSTEIN TEST SUITE');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);

  if (options.verbose) console.log('Verbose mode: ON');
  if (options.bail) console.log('Bail mode: ON');
  if (options.coverage) console.log('Coverage tracking: ON');

  const results = [];
  const startTime = Date.now();

  // Determine which tests to run
  const testsToRun = TEST_FILES.filter((test) => {
    if (runAll) return true;
    if (options.unit && test.category === 'unit') return true;
    if (options.middleware && test.category === 'middleware') return true;
    if (options.integration && test.category === 'integration') return true;
    if (options.security && test.category === 'security') return true;
    if (options.api && test.category === 'api') return true;
    if (options.e2e && test.category === 'e2e') return true;
    return false;
  });

  console.log(`\nTests to run: ${testsToRun.map(t => t.name).join(', ')}`);

  // Check server for API tests
  const needsServer = testsToRun.some(t => t.requiresServer);
  if (needsServer) {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      console.log('\n[WARNING] API tests require a running server.');
      console.log('Start the server with: npm run server');
      console.log('Skipping API tests...\n');

      // Remove API tests from the list
      const index = testsToRun.findIndex(t => t.requiresServer);
      if (index !== -1) {
        results.push({
          name: testsToRun[index].name,
          description: testsToRun[index].description,
          status: 'skipped',
          reason: 'Server not running',
          duration: 0,
          output: '',
          passed: 0,
          failed: 0,
        });
        testsToRun.splice(index, 1);
      }
    }
  }

  // Run each test file
  for (const test of testsToRun) {
    const result = await runTestFile(test);
    results.push(result);

    // Bail on first failure if requested
    if (options.bail && result.status === 'failed') {
      console.log('\n[BAIL] Stopping due to test failure');
      break;
    }
  }

  const totalDuration = Date.now() - startTime;

  // Calculate summary
  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errored: results.filter(r => r.status === 'error').length,
    duration: totalDuration,
    timestamp: new Date().toISOString(),
    results,
  };

  // Print summary
  printSummary(summary);

  // Generate report if requested
  if (options.report) {
    generateReport(summary);
  }

  // Save results to JSON
  const resultsPath = path.join(TESTS_DIR, 'test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);

  // Exit with appropriate code
  const exitCode = summary.failed > 0 || summary.errored > 0 ? 1 : 0;
  process.exit(exitCode);
}

// ============================================
// SUMMARY OUTPUT
// ============================================

function printSummary(summary) {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST SUMMARY');
  console.log('='.repeat(60));

  console.log('\nResults by Suite:');
  console.log('-'.repeat(40));

  for (const result of summary.results) {
    const icon = result.status === 'passed' ? '\x1b[32m✓\x1b[0m' :
      result.status === 'failed' ? '\x1b[31m✗\x1b[0m' :
        result.status === 'skipped' ? '\x1b[33m○\x1b[0m' :
          '\x1b[31m!\x1b[0m';

    const statusColor = result.status === 'passed' ? '\x1b[32m' :
      result.status === 'failed' ? '\x1b[31m' :
        result.status === 'skipped' ? '\x1b[33m' :
          '\x1b[31m';

    console.log(`  ${icon} ${result.description}: ${statusColor}${result.status.toUpperCase()}\x1b[0m (${result.duration}ms)`);

    if (result.status === 'skipped' && result.reason) {
      console.log(`      Reason: ${result.reason}`);
    }
    if (result.status === 'error' && result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }

  console.log('\n' + '-'.repeat(40));
  console.log('Overall:');
  console.log(`  Total:   ${summary.total}`);
  console.log(`  \x1b[32mPassed:  ${summary.passed}\x1b[0m`);
  console.log(`  \x1b[31mFailed:  ${summary.failed}\x1b[0m`);
  console.log(`  \x1b[33mSkipped: ${summary.skipped}\x1b[0m`);
  console.log(`  Duration: ${(summary.duration / 1000).toFixed(2)}s`);
  console.log('');

  if (summary.failed === 0 && summary.errored === 0) {
    console.log('\x1b[32m✓ All tests passed!\x1b[0m');
  } else {
    console.log('\x1b[31m✗ Some tests failed\x1b[0m');
  }
}

// ============================================
// REPORT GENERATION
// ============================================

function generateReport(summary) {
  const reportPath = path.join(TESTS_DIR, 'test-report.html');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report - Pimp My Epstein</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    h1 { color: #ff6b6b; margin-bottom: 1rem; }
    h2 { color: #4ecdc4; margin: 2rem 0 1rem; }
    .timestamp { color: #888; font-size: 0.9rem; }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin: 2rem 0;
    }
    .card {
      background: #16213e;
      border-radius: 8px;
      padding: 1.5rem;
      text-align: center;
    }
    .card-value { font-size: 2.5rem; font-weight: bold; }
    .card-label { color: #888; margin-top: 0.5rem; }
    .card.passed .card-value { color: #4ecdc4; }
    .card.failed .card-value { color: #ff6b6b; }
    .card.skipped .card-value { color: #ffd93d; }

    .results-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    .results-table th, .results-table td {
      padding: 1rem;
      text-align: left;
      border-bottom: 1px solid #333;
    }
    .results-table th {
      background: #16213e;
      color: #4ecdc4;
    }
    .results-table tr:hover { background: #16213e; }

    .status {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: bold;
    }
    .status.passed { background: rgba(78, 205, 196, 0.2); color: #4ecdc4; }
    .status.failed { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
    .status.skipped { background: rgba(255, 217, 61, 0.2); color: #ffd93d; }
    .status.error { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }

    .duration { color: #888; font-size: 0.9rem; }

    .footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid #333;
      color: #666;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Report</h1>
    <p class="timestamp">Generated: ${summary.timestamp}</p>

    <div class="summary-cards">
      <div class="card">
        <div class="card-value">${summary.total}</div>
        <div class="card-label">Total Suites</div>
      </div>
      <div class="card passed">
        <div class="card-value">${summary.passed}</div>
        <div class="card-label">Passed</div>
      </div>
      <div class="card failed">
        <div class="card-value">${summary.failed}</div>
        <div class="card-label">Failed</div>
      </div>
      <div class="card skipped">
        <div class="card-value">${summary.skipped}</div>
        <div class="card-label">Skipped</div>
      </div>
      <div class="card">
        <div class="card-value">${(summary.duration / 1000).toFixed(1)}s</div>
        <div class="card-label">Duration</div>
      </div>
    </div>

    <h2>Test Results</h2>
    <table class="results-table">
      <thead>
        <tr>
          <th>Suite</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${summary.results.map(r => `
        <tr>
          <td><strong>${r.description}</strong><br><span class="duration">${r.name}.test.js</span></td>
          <td><span class="status ${r.status}">${r.status.toUpperCase()}</span></td>
          <td class="duration">${r.duration}ms</td>
          <td>${r.reason || r.error || (r.passed !== undefined ? `${r.passed} passed` : '-')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="footer">
      <p>Pimp My Epstein Test Suite - ${summary.total} suites, ${(summary.duration / 1000).toFixed(2)}s total</p>
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(reportPath, html);
  console.log(`\nHTML report generated: ${reportPath}`);
}

// ============================================
// RUN
// ============================================

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
