const fs = require('fs');
const path = require('path');

/**
 * Get list of Epstein photos for count
 */
function getEpsteinPhotos() {
  const photosDir = path.join(process.cwd(), 'public', 'epstein-photos');

  if (!fs.existsSync(photosDir)) {
    return [];
  }

  return fs.readdirSync(photosDir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
}

module.exports = function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const photos = getEpsteinPhotos();
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.GEMINI_API_KEY,
    epsteinPhotosCount: photos.length
  });
};
