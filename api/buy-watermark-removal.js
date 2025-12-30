const stripeService = require('../services/stripe');
const { verifyToken } = require('../lib/supabase');

// Allowed origins for CORS (configure via environment variable)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://pimpmyepstein.lol', 'https://www.pimpmyepstein.lol'];

/**
 * Get CORS origin - returns the request origin if allowed, otherwise null
 */
function getCorsOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  // Allow localhost and 127.0.0.1 in development
  if (process.env.NODE_ENV !== 'production') {
    if (requestOrigin.startsWith('http://localhost') || requestOrigin.startsWith('http://127.0.0.1')) {
      return requestOrigin;
    }
  }
  return null;
}

/**
 * Set CORS headers with origin validation
 */
function setCorsHeaders(req, res) {
  const origin = getCorsOrigin(req.headers.origin);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Verify JWT token from Authorization header
 * Returns { user, error }
 */
async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return { user: null, error: 'Authorization header required' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { user: null, error: 'Invalid Authorization header format. Use: Bearer <token>' };
  }

  const token = parts[1];
  if (!token) {
    return { user: null, error: 'Token is empty' };
  }

  const { user, error } = await verifyToken(token);

  if (error) {
    return { user: null, error: `Token verification failed: ${error.message}` };
  }

  if (!user) {
    return { user: null, error: 'Invalid or expired token' };
  }

  return { user, error: null };
}

/**
 * POST /api/buy-watermark-removal
 * Creates a Stripe checkout session for watermark removal + 1 premium generation ($2.99)
 *
 * REQUIRES AUTHENTICATION
 * - Must provide valid JWT in Authorization header
 * - userId and email are derived from the authenticated user token
 */
module.exports = async function handler(req, res) {
  // Set CORS headers (restricted to allowed origins)
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate the request
    const { user, error: authError } = await authenticateRequest(req);

    if (authError || !user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: authError || 'Please log in to access this resource'
      });
    }

    // Derive userId and email from the authenticated user token
    const userId = user.id;
    const email = user.email;

    if (!email) {
      return res.status(400).json({
        error: 'User email not available',
        message: 'Your account does not have an email address associated with it'
      });
    }

    // Validate email format (defensive check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format in user profile'
      });
    }

    const { url, sessionId } = await stripeService.createWatermarkRemovalSession(userId, email);

    res.json({
      success: true,
      checkoutUrl: url,
      sessionId
    });
  } catch (error) {
    console.error('Watermark removal checkout creation error:', error.message);
    res.status(500).json({
      error: 'Failed to create watermark removal checkout session',
      details: error.message, // Temporarily show error in production for debugging
      hasWatermarkPrice: !!process.env.STRIPE_PRICE_WATERMARK
    });
  }
};
