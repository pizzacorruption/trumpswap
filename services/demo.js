const samples = require('../config/demo-results.json');

const siteOrigins = ['https://pimpmyepstein.lol', 'https://www.pimpmyepstein.lol'];

function setCorsHeaders(req, res, origins = siteOrigins) {
  const allowed = [...origins];
  if (process.env.NODE_ENV !== 'production') {
    allowed.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }
  if (allowed.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function generate(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return res.status(415).json({ error: 'This demo accepts a sample selection as JSON. Photo uploads are not supported.' });
  }

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Object.hasOwn(body, 'sampleId') ||
      typeof body.sampleId !== 'string' || req.file || (req.files && Object.keys(req.files).length)) {
    return res.status(400).json({ error: 'Select a sample using only sampleId. Photo uploads are not supported.' });
  }

  const sample = samples.find(item => item.id === body.sampleId);
  if (!sample) return res.status(400).json({ error: 'Unknown demo sample' });

  return res.json({
    success: true,
    demo: true,
    imageUrl: sample.imageUrl,
    sampleLabel: sample.label,
    modelType: 'demo'
  });
}

function purchasesUnavailable(req, res) {
  const origins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : siteOrigins;
  setCorsHeaders(req, res, origins);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(410).json({
    error: 'Purchases are unavailable',
    message: 'This is a free demo with pre-generated examples. New subscriptions, credits, and watermark removal are not sold.'
  });
}

module.exports = { generate, purchasesUnavailable };
