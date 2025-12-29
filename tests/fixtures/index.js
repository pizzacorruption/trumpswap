/**
 * Test Fixtures Index
 *
 * Exports all test fixtures and mock data for easy importing.
 */

const mockData = require('./mock-data');
const path = require('path');
const fs = require('fs');

// ============================================
// FIXTURE PATHS
// ============================================

const FIXTURES_DIR = __dirname;

/**
 * Get the path to a fixture file
 */
function getFixturePath(filename) {
  return path.join(FIXTURES_DIR, filename);
}

/**
 * Check if a fixture file exists
 */
function fixtureExists(filename) {
  return fs.existsSync(getFixturePath(filename));
}

/**
 * Read a fixture file as a buffer
 */
function readFixture(filename) {
  const filepath = getFixturePath(filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Fixture not found: ${filename}`);
  }
  return fs.readFileSync(filepath);
}

/**
 * Read a fixture file as JSON
 */
function readJsonFixture(filename) {
  const content = readFixture(filename);
  return JSON.parse(content.toString());
}

// ============================================
// IMAGE FIXTURES
// ============================================

const images = {
  // Minimal valid PNG (always available)
  minimal: {
    path: getFixturePath('minimal.png'),
    exists: () => fixtureExists('minimal.png'),
    read: () => readFixture('minimal.png'),
  },

  // 256x256 face image (valid size)
  face256: {
    path: getFixturePath('test-face-256.png'),
    exists: () => fixtureExists('test-face-256.png'),
    read: () => readFixture('test-face-256.png'),
  },

  // 512x512 face image
  face512: {
    path: getFixturePath('test-face-512.png'),
    exists: () => fixtureExists('test-face-512.png'),
    read: () => readFixture('test-face-512.png'),
  },

  // Too small image (100x100)
  tooSmall: {
    path: getFixturePath('too-small.png'),
    exists: () => fixtureExists('too-small.png'),
    read: () => readFixture('too-small.png'),
  },

  // JPEG test image
  jpeg: {
    path: getFixturePath('test-face-256.jpg'),
    exists: () => fixtureExists('test-face-256.jpg'),
    read: () => readFixture('test-face-256.jpg'),
  },

  // WebP test image
  webp: {
    path: getFixturePath('test-face-256.webp'),
    exists: () => fixtureExists('test-face-256.webp'),
    read: () => readFixture('test-face-256.webp'),
  },

  // Gradient test image
  gradient: {
    path: getFixturePath('gradient-256.png'),
    exists: () => fixtureExists('gradient-256.png'),
    read: () => readFixture('gradient-256.png'),
  },
};

/**
 * Get a valid test image buffer (falls back to minimal if others don't exist)
 */
function getValidTestImage() {
  if (images.face256.exists()) {
    return images.face256.read();
  }
  if (images.minimal.exists()) {
    return images.minimal.read();
  }
  // Create minimal PNG on the fly
  return Buffer.from([
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
}

/**
 * Get a too-small test image buffer
 */
function getTooSmallTestImage() {
  if (images.tooSmall.exists()) {
    return images.tooSmall.read();
  }
  // Return minimal PNG as fallback (it's also too small)
  return getValidTestImage();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Fixture utilities
  FIXTURES_DIR,
  getFixturePath,
  fixtureExists,
  readFixture,
  readJsonFixture,

  // Image fixtures
  images,
  getValidTestImage,
  getTooSmallTestImage,

  // Re-export mock data
  ...mockData,
};
