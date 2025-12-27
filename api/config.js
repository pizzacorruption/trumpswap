/**
 * GET /api/config
 * Returns public configuration for the frontend
 * (Only non-secret values that are safe to expose)
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
