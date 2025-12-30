#!/usr/bin/env node
/**
 * Generate pre-rendered watermark PNG
 *
 * This creates a watermark image that can be embedded in lib/watermark.js
 * Run this locally (where fonts are available) to generate the base64 data.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const WATERMARK_TEXT = 'pimpmyepstein.lol';
const WIDTH = 400;
const HEIGHT = 50;
const FONT_SIZE = 28;

async function generateWatermark() {
  console.log('Generating watermark PNG...');

  // Create SVG with white text on transparent background
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%"
            dominant-baseline="middle"
            text-anchor="middle"
            font-size="${FONT_SIZE}px"
            font-family="Impact, Arial Black, Helvetica, sans-serif"
            font-weight="bold"
            fill="white">
        ${WATERMARK_TEXT}
      </text>
    </svg>
  `;

  try {
    // Convert SVG to PNG
    const pngBuffer = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();

    // Save PNG file
    const outputPath = path.join(__dirname, '..', 'lib', 'watermark-text.png');
    fs.writeFileSync(outputPath, pngBuffer);
    console.log(`Saved PNG to: ${outputPath}`);

    // Generate base64
    const base64 = pngBuffer.toString('base64');
    console.log(`\nBase64 length: ${base64.length} chars`);
    console.log('\nFirst 100 chars of base64:');
    console.log(base64.substring(0, 100) + '...');

    // Save base64 to file for easy copy
    const base64Path = path.join(__dirname, '..', 'lib', 'watermark-base64.txt');
    fs.writeFileSync(base64Path, base64);
    console.log(`\nSaved base64 to: ${base64Path}`);

    // Test that we can decode it
    const testBuffer = Buffer.from(base64, 'base64');
    const metadata = await sharp(testBuffer).metadata();
    console.log(`\nVerified: ${metadata.width}x${metadata.height} PNG, ${metadata.channels} channels`);

    return base64;
  } catch (error) {
    console.error('Error generating watermark:', error);
    process.exit(1);
  }
}

generateWatermark();
