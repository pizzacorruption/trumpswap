const fs = require('fs');
const path = require('path');

/**
 * Get list of Trump photos for gallery
 */
function getTrumpPhotos() {
  // In Vercel, static files are at process.cwd()/public
  const photosDir = path.join(process.cwd(), 'public', 'trump-photos');

  if (!fs.existsSync(photosDir)) {
    return [];
  }

  const files = fs.readdirSync(photosDir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => ({
      name: f.replace(/\.[^.]+$/, '').replace(/-/g, ' '),
      path: `/trump-photos/${f}`,
      filename: f
    }));

  return files;
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

  const photos = getTrumpPhotos();
  res.json({ photos });
};
