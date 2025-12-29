#!/usr/bin/env node
/**
 * Test Environment Setup Script
 *
 * Sets up the test environment, generates test fixtures, and validates
 * the configuration before running tests.
 *
 * Usage:
 *   node tests/setup-test-env.js          # Full setup
 *   node tests/setup-test-env.js --check  # Check only (no modifications)
 *   node tests/setup-test-env.js --clean  # Clean and reset test environment
 */

const fs = require('fs');
const path = require('path');

// ============================================
// PATHS
// ============================================

const PROJECT_ROOT = path.join(__dirname, '..');
const TESTS_DIR = __dirname;
const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');
const TEST_ENV_FILE = path.join(PROJECT_ROOT, '.env.test');

// ============================================
// CLI ARGUMENTS
// ============================================

const args = process.argv.slice(2);
const options = {
  check: args.includes('--check'),
  clean: args.includes('--clean'),
  verbose: args.includes('--verbose'),
  help: args.includes('--help') || args.includes('-h'),
};

// ============================================
// HELP
// ============================================

if (options.help) {
  console.log(`
Test Environment Setup
======================

Usage: node tests/setup-test-env.js [options]

Options:
  --check     Check environment only (no modifications)
  --clean     Clean test artifacts and reset environment
  --verbose   Show detailed output
  --help, -h  Show this help message

What this script does:
  1. Creates necessary directories (fixtures, output)
  2. Generates test image fixtures if missing
  3. Creates .env.test file with test-specific configuration
  4. Validates required dependencies
  5. Checks for running services (optional)
`);
  process.exit(0);
}

// ============================================
// LOGGING
// ============================================

function log(message, type = 'info') {
  const icons = {
    info: '\x1b[34mi\x1b[0m',
    success: '\x1b[32m✓\x1b[0m',
    warning: '\x1b[33m!\x1b[0m',
    error: '\x1b[31m✗\x1b[0m',
  };
  console.log(`  ${icons[type]} ${message}`);
}

function heading(title) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(50));
}

// ============================================
// DIRECTORY SETUP
// ============================================

function setupDirectories() {
  heading('Directories');

  const directories = [
    { path: FIXTURES_DIR, name: 'Test fixtures' },
    { path: OUTPUT_DIR, name: 'Output directory' },
  ];

  for (const dir of directories) {
    if (fs.existsSync(dir.path)) {
      log(`${dir.name} exists: ${path.relative(PROJECT_ROOT, dir.path)}`, 'success');
    } else if (options.check) {
      log(`${dir.name} missing: ${path.relative(PROJECT_ROOT, dir.path)}`, 'warning');
    } else {
      fs.mkdirSync(dir.path, { recursive: true });
      log(`${dir.name} created: ${path.relative(PROJECT_ROOT, dir.path)}`, 'success');
    }
  }
}

// ============================================
// TEST FIXTURES
// ============================================

function setupFixtures() {
  heading('Test Fixtures');

  const fixtureFiles = [
    'minimal.png',
    'test-face-256.png',
    'test-face-512.png',
    'too-small.png',
    'test-face-256.jpg',
    'test-face-256.webp',
    'gradient-256.png',
  ];

  const existingFixtures = fixtureFiles.filter(f =>
    fs.existsSync(path.join(FIXTURES_DIR, f))
  );

  log(`Found ${existingFixtures.length}/${fixtureFiles.length} fixture images`, 'info');

  if (existingFixtures.length < fixtureFiles.length) {
    if (options.check) {
      log('Some fixtures missing. Run without --check to generate.', 'warning');
    } else {
      log('Generating missing fixtures...', 'info');

      try {
        // Try to generate fixtures using the generate script
        const generateScript = path.join(FIXTURES_DIR, 'generate-test-images.js');
        if (fs.existsSync(generateScript)) {
          require(generateScript);
          log('Fixtures generated successfully', 'success');
        } else {
          // Create minimal PNG manually
          const minimalPng = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
            0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xFE,
            0xD4, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
            0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
          ]);
          fs.writeFileSync(path.join(FIXTURES_DIR, 'minimal.png'), minimalPng);
          log('Created minimal.png (other fixtures require Sharp)', 'success');
        }
      } catch (err) {
        log(`Fixture generation failed: ${err.message}`, 'error');
      }
    }
  } else {
    log('All fixtures present', 'success');
  }

  // Check mock data
  const mockDataPath = path.join(FIXTURES_DIR, 'mock-data.js');
  if (fs.existsSync(mockDataPath)) {
    log('Mock data file present', 'success');
  } else {
    log('Mock data file missing', 'warning');
  }
}

// ============================================
// ENVIRONMENT FILES
// ============================================

function setupEnvFiles() {
  heading('Environment Configuration');

  // Check .env file
  if (fs.existsSync(ENV_FILE)) {
    log('.env file exists', 'success');

    // Check for required variables
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const requiredVars = ['GEMINI_API_KEY'];
    const optionalVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'STRIPE_SECRET_KEY', 'ADMIN_PASSWORD'];

    for (const v of requiredVars) {
      if (envContent.includes(`${v}=`) && !envContent.includes(`${v}=\n`) && !envContent.includes(`${v}= `)) {
        log(`${v} is set`, 'success');
      } else {
        log(`${v} is not set (required for full tests)`, 'warning');
      }
    }

    if (options.verbose) {
      for (const v of optionalVars) {
        if (envContent.includes(`${v}=`) && !envContent.includes(`${v}=\n`)) {
          log(`${v} is set (optional)`, 'info');
        }
      }
    }
  } else {
    log('.env file not found', 'warning');
    log('Copy .env.example to .env and configure', 'info');
  }

  // Create/update .env.test
  const testEnvContent = `# Test Environment Configuration
# Generated by setup-test-env.js

# Override these for testing
TEST_BASE_URL=http://localhost:3000
TEST_TIMEOUT=30000
TEST_VERBOSE=false
TEST_COVERAGE=false

# Use mock services for testing
MOCK_SUPABASE=true
MOCK_STRIPE=true

# Test-specific settings
NODE_ENV=test
`;

  if (options.check) {
    if (fs.existsSync(TEST_ENV_FILE)) {
      log('.env.test exists', 'success');
    } else {
      log('.env.test missing', 'warning');
    }
  } else {
    fs.writeFileSync(TEST_ENV_FILE, testEnvContent);
    log('.env.test created/updated', 'success');
  }
}

// ============================================
// DEPENDENCIES CHECK
// ============================================

function checkDependencies() {
  heading('Dependencies');

  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules');

  // Check if node_modules exists
  if (!fs.existsSync(nodeModulesPath)) {
    log('node_modules not found. Run: npm install', 'error');
    return false;
  }

  // Read package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  // Check key dependencies
  const keyDeps = ['express', 'sharp', 'dotenv'];
  let allPresent = true;

  for (const dep of keyDeps) {
    const depPath = path.join(nodeModulesPath, dep);
    if (fs.existsSync(depPath)) {
      if (options.verbose) log(`${dep} installed`, 'success');
    } else {
      log(`${dep} not installed`, 'error');
      allPresent = false;
    }
  }

  if (allPresent) {
    log('All key dependencies installed', 'success');
  } else {
    log('Some dependencies missing. Run: npm install', 'warning');
  }

  return allPresent;
}

// ============================================
// CLEAN FUNCTION
// ============================================

function cleanTestEnvironment() {
  heading('Cleaning Test Environment');

  // Clean test output files
  if (fs.existsSync(OUTPUT_DIR)) {
    const files = fs.readdirSync(OUTPUT_DIR);
    const testFiles = files.filter(f => f.startsWith('epstein_test_') || f.startsWith('temp_'));
    let cleaned = 0;

    for (const file of testFiles) {
      fs.unlinkSync(path.join(OUTPUT_DIR, file));
      cleaned++;
    }

    log(`Cleaned ${cleaned} test output files`, 'success');
  }

  // Clean test results
  const resultFiles = ['test-results.json', 'test-report.html'];
  for (const file of resultFiles) {
    const filePath = path.join(TESTS_DIR, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log(`Removed ${file}`, 'success');
    }
  }

  // Clean temp fixtures
  if (fs.existsSync(FIXTURES_DIR)) {
    const files = fs.readdirSync(FIXTURES_DIR);
    const tempFiles = files.filter(f => f.startsWith('temp_'));
    for (const file of tempFiles) {
      fs.unlinkSync(path.join(FIXTURES_DIR, file));
    }
    if (tempFiles.length > 0) {
      log(`Cleaned ${tempFiles.length} temp fixture files`, 'success');
    }
  }

  log('Test environment cleaned', 'success');
}

// ============================================
// SERVER CHECK
// ============================================

async function checkServer() {
  heading('Server Status');

  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';

  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      log(`Server running at ${baseUrl}`, 'success');
      log(`API key configured: ${data.apiKeySet}`, data.apiKeySet ? 'success' : 'warning');
      log(`Epstein photos: ${data.epsteinPhotosCount}`, 'info');
      return true;
    } else {
      log(`Server returned ${response.status}`, 'warning');
      return false;
    }
  } catch (err) {
    log(`Server not running at ${baseUrl}`, 'warning');
    log('API tests will be skipped without a running server', 'info');
    log('Start server with: npm run server', 'info');
    return false;
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('\n' + '═'.repeat(50));
  console.log('  PIMP MY EPSTEIN TEST ENVIRONMENT SETUP');
  console.log('═'.repeat(50));

  if (options.check) {
    console.log('  Mode: Check only (no modifications)');
  } else if (options.clean) {
    console.log('  Mode: Clean');
  } else {
    console.log('  Mode: Full setup');
  }

  if (options.clean) {
    cleanTestEnvironment();
    console.log('\nClean complete.\n');
    process.exit(0);
  }

  // Run setup steps
  setupDirectories();
  setupFixtures();
  setupEnvFiles();
  const depsOk = checkDependencies();
  await checkServer();

  // Summary
  heading('Summary');

  if (options.check) {
    log('Environment check complete', 'info');
    log('Run without --check to make changes', 'info');
  } else {
    log('Test environment setup complete', 'success');
    log('Run tests with: npm run test:all', 'info');
  }

  console.log('\n');
}

main().catch((err) => {
  console.error('Setup error:', err);
  process.exit(1);
});
