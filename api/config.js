const fs = require('fs');
const path = require('path');

/**
 * GET /api/config
 * Returns public configuration for the frontend
 * (Only non-secret values that are safe to expose)
 *
 * Also handles /api/config?health=true for health check (consolidated from api/health.js)
 */
module.exports = async function handler(req, res) {
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

  // Health check mode (consolidated from api/health.js)
  if (req.query.health === 'true') {
    const photosDir = path.join(process.cwd(), 'public', 'epstein-photos');
    let photoCount = 0;
    if (fs.existsSync(photosDir)) {
      photoCount = fs.readdirSync(photosDir)
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
    }
    return res.json({
      status: 'ok',
      apiKeySet: !!process.env.GEMINI_API_KEY,
      epsteinPhotosCount: photoCount
    });
  }

  // Return public config (these are safe to expose - they're public keys)
  res.json({
    supabase: {
      url: process.env.SUPABASE_URL || '',
      anonKey: process.env.SUPABASE_ANON_KEY || ''
    },
    stripe: {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
    }
  });
};
