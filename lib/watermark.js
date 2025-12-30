/**
 * Watermark utility - Font-independent implementation
 *
 * Uses a pre-rendered watermark image to avoid font rendering issues
 * on serverless platforms where system fonts may not be available.
 *
 * The watermark PNG is embedded as base64 to ensure it works everywhere.
 * This completely bypasses libvips SVG font rendering which can fail
 * on Vercel serverless containers that lack system fonts.
 */

const sharp = require('sharp');

// Pre-rendered "pimpmyepstein.lol" watermark text (400x50 PNG, white text on transparent)
// Generated locally where fonts are available, then embedded here
const WATERMARK_TEXT_BASE64 = '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';

// Decode the base64 watermark once at module load
const WATERMARK_BUFFER = Buffer.from(WATERMARK_TEXT_BASE64, 'base64');

/**
 * Add watermark to image buffer - visible but not obnoxious
 * Uses pre-rendered PNG for reliable font-independent rendering
 *
 * @param {Buffer} inputBuffer - The image buffer to watermark
 * @param {string} watermarkText - Ignored (kept for API compatibility)
 * @returns {Promise<Buffer>} - The watermarked image buffer
 */
async function addWatermark(inputBuffer, watermarkText = 'pimpmyepstein.lol') {
  try {
    const metadata = await sharp(inputBuffer).metadata();
    const { width, height } = metadata;

    // Calculate watermark size based on image dimensions
    const watermarkWidth = Math.floor(width * 0.6);  // 60% of image width
    const watermarkHeight = Math.floor(watermarkWidth * 0.125);  // Maintain aspect ratio (50/400)

    // Resize the pre-rendered watermark to fit this image
    const centerWatermark = await sharp(WATERMARK_BUFFER)
      .resize(watermarkWidth, watermarkHeight, { fit: 'contain' })
      .png()
      .toBuffer();

    // Create smaller watermarks for the tiled pattern
    const smallWidth = Math.floor(width * 0.35);
    const smallHeight = Math.floor(smallWidth * 0.125);
    const smallWatermark = await sharp(WATERMARK_BUFFER)
      .resize(smallWidth, smallHeight, { fit: 'contain' })
      .ensureAlpha()
      .modulate({ brightness: 0.3 })  // Make pattern watermarks more subtle
      .png()
      .toBuffer();

    // Calculate positions for tiled pattern
    const positions = [];

    // Add semi-transparent tiles across the image
    const tileSpacingX = Math.floor(width * 0.45);
    const tileSpacingY = Math.floor(height * 0.25);

    for (let y = Math.floor(height * 0.1); y < height - smallHeight; y += tileSpacingY) {
      for (let x = Math.floor(width * 0.05); x < width - smallWidth; x += tileSpacingX) {
        positions.push({
          input: smallWatermark,
          top: y,
          left: x,
          blend: 'over'
        });
      }
    }

    // Add center watermark (more visible)
    const centerX = Math.floor((width - watermarkWidth) / 2);
    const centerY = Math.floor((height - watermarkHeight) / 2);

    // Create shadow effect for center watermark
    const shadowWatermark = await sharp(WATERMARK_BUFFER)
      .resize(watermarkWidth, watermarkHeight, { fit: 'contain' })
      .ensureAlpha()
      .modulate({ brightness: 0 })  // Make it black for shadow
      .png()
      .toBuffer();

    positions.push({
      input: shadowWatermark,
      top: centerY + 3,  // Offset for shadow
      left: centerX + 3,
      blend: 'over'
    });

    positions.push({
      input: centerWatermark,
      top: centerY,
      left: centerX,
      blend: 'over'
    });

    // Composite all watermarks onto the image
    const watermarkedBuffer = await sharp(inputBuffer)
      .composite(positions)
      .png()
      .toBuffer();

    return watermarkedBuffer;
  } catch (watermarkError) {
    console.error('Watermark application failed:', watermarkError.message);
    // Return original image if watermarking fails rather than crashing
    return inputBuffer;
  }
}

module.exports = { addWatermark };
