const stripeService = require('../services/stripe');
const { verifyToken } = require('../lib/supabase');
const crypto = require('crypto');

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
 * Verify JWT token from Authorization header (optional)
 * Returns { user, error } - error is null if no auth header present
 */
async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;

  // No auth header is OK for anonymous users
  if (!authHeader) {
    return { user: null, error: null };
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
 * Get anon_id from cookie
 */
function getAnonIdFromCookie(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/anon_id=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * POST /api/buy-watermark-removal
 * Creates a Stripe checkout session for watermark removal + 1 premium generation ($2.99)
 *
 * Supports both authenticated AND anonymous users:
 * - Authenticated: Uses userId/email from JWT token
 * - Anonymous: Uses generationId + viewToken from request body, Stripe collects email
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
    // Try to authenticate (optional for anonymous users)
    const { user, error: authError } = await authenticateRequest(req);

    // If auth was attempted but failed, reject
    if (authError) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: authError
      });
    }

    // Parse request body
    const body = req.body || {};
    const { generationId, viewToken } = body;

    // AUTHENTICATED USER PATH
    if (user) {
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

      const { url, sessionId } = await stripeService.createWatermarkRemovalSession({
        userId,
        email,
        generationId
      });

      return res.json({
        success: true,
        checkoutUrl: url,
        sessionId
      });
    }

    // ANONYMOUS USER PATH
    // For anonymous users, we need generationId to track the purchase
    if (!generationId) {
      return res.status(400).json({
        error: 'Generation required',
        message: 'Generate an image first to unlock watermark removal'
      });
    }

    // Get anon_id from cookie for tracking
    const anonId = getAnonIdFromCookie(req);

    // Generate a unique purchase token for this anonymous purchase
    const purchaseToken = crypto.randomUUID();

    const { url, sessionId } = await stripeService.createWatermarkRemovalSession({
      anonId,
      generationId,
      viewToken,
      purchaseToken
    });

    return res.json({
      success: true,
      checkoutUrl: url,
      sessionId,
      purchaseToken
    });

  } catch (error) {
    console.error('Watermark removal checkout creation error:', error.message);
    res.status(500).json({
      error: 'Failed to create watermark removal checkout session',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
