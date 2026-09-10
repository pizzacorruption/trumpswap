const samples = require('../config/demo-results.json');
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.query.health === 'true') return res.json({ status: 'ok', mode: 'canned', sampleCount: samples.length });
  return res.json({
    supabase: { url: process.env.SUPABASE_URL || '', anonKey: process.env.SUPABASE_ANON_KEY || '' },
    demo: { samples }
  });
};
