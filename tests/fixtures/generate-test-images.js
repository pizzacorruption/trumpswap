/**
 * Generate Test Images
 *
 * Creates test images for use in tests. Run this script to regenerate fixtures.
 * Usage: node tests/fixtures/generate-test-images.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp not available, creating minimal test images only');
  sharp = null;
}

const FIXTURES_DIR = __dirname;

/**
 * Create a minimal valid PNG (1x1 pixel)
 */
function createMinimalPng() {
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
 * Create test images using Sharp
 */
async function createTestImages() {
  console.log('Creating test images in:', FIXTURES_DIR);

  // Always create minimal PNG (doesn't need sharp)
  const minimalPng = createMinimalPng();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'minimal.png'), minimalPng);
  console.log('  Created: minimal.png (1x1 pixel)');

  if (!sharp) {
    console.log('\nSharp not available. To generate full test images, install sharp:');
    console.log('  npm install sharp');
    return;
  }

  try {
    // Create 256x256 solid color PNG (minimum valid size for face detection)
    const solidColor = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 200, g: 180, b: 160 }, // Skin-like color
      },
    })
      .png()
      .toBuffer();

    fs.writeFileSync(path.join(FIXTURES_DIR, 'test-face-256.png'), solidColor);
    console.log('  Created: test-face-256.png (256x256)');

    // Create 512x512 PNG
    const mediumPng = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer();

    fs.writeFileSync(path.join(FIXTURES_DIR, 'test-face-512.png'), mediumPng);
    console.log('  Created: test-face-512.png (512x512)');

    // Create 100x100 PNG (too small - for testing size validation)
    const tooSmall = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer();

    fs.writeFileSync(path.join(FIXTURES_DIR, 'too-small.png'), tooSmall);
    console.log('  Created: too-small.png (100x100 - below minimum)');

    // Create 256x256 JPEG
    const jpegImage = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();

    fs.writeFileSync(path.join(FIXTURES_DIR, 'test-face-256.jpg'), jpegImage);
    console.log('  Created: test-face-256.jpg (256x256)');

    // Create 256x256 WebP
    const webpImage = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .webp({ quality: 80 })
      .toBuffer();

    fs.writeFileSync(path.join(FIXTURES_DIR, 'test-face-256.webp'), webpImage);
    console.log('  Created: test-face-256.webp (256x256)');

    // Create a gradient image for visual testing
    const width = 256;
    const height = 256;
    const channels = 3;
    const gradientData = Buffer.alloc(width * height * channels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        gradientData[idx] = Math.floor((x / width) * 255); // R
        gradientData[idx + 1] = Math.floor((y / height) * 255); // G
        gradientData[idx + 2] = 128; // B
      }
    }

    const gradientPng = await sharp(gradientData, {
      raw: { width, height, channels },
    })
      .png()
      .toBuffer();

    fs.writeFileSync(path.join(FIXTURES_DIR, 'gradient-256.png'), gradientPng);
    console.log('  Created: gradient-256.png (256x256 gradient)');

    console.log('\nAll test images created successfully!');
  } catch (error) {
    console.error('Error creating test images:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  createTestImages();
}

module.exports = {
  createMinimalPng,
  createTestImages,
  FIXTURES_DIR,
};
