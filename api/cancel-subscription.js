const stripeService = require('../services/stripe');
const { verifyToken, createAdminClient } = require('../lib/supabase');

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
 * POST /api/cancel-subscription
 * Cancels a user's subscription (at period end)
 *
 * REQUIRES AUTHENTICATION
 * - Must provide valid JWT in Authorization header
 * - Stripe customer ID is looked up from user's profile in Supabase
 *
 * No request body required - uses authenticated user's profile to find subscription
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

    // Get user's profile from Supabase to find their Stripe customer ID
    // This is the source of truth - NOT in-memory state or request body
    // Use admin client to bypass RLS (we've already authenticated the user via JWT)
    const supabaseAdmin = createAdminClient();
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: 'Database not configured'
      });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError.message);
      return res.status(500).json({
        error: 'Failed to fetch user profile'
      });
    }

    if (!profile?.stripe_customer_id) {
      return res.status(404).json({
        error: 'No subscription found',
        message: 'No active subscription found for this user'
      });
    }

    // SECURITY: Use customerId from user's profile, not from request body
    // This prevents attackers from cancelling other users' subscriptions
    const result = await stripeService.cancelSubscription(profile.stripe_customer_id);

    res.json(result);
  } catch (error) {
    console.error('Subscription cancellation error:', error.message);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
