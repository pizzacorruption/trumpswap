const stripeService = require('../services/stripe');
const { verifyToken, createAdminClient } = require('../lib/supabase');
const { getNextResetDate } = require('../services/usage');

// Allowed origins for CORS (configure via environment variable)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['https://pimpmyepstein.lol', 'https://www.pimpmyepstein.lol'];

/**
 * Get CORS origin - returns the request origin if allowed, otherwise null
 */
function getCorsOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
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

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let sessionId = null;
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        sessionId = parsed?.sessionId || null;
      } catch (error) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    } else {
      sessionId = req.body.sessionId;
    }
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  try {
    const { user, error: authError } = await authenticateRequest(req);

    if (authError || !user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: authError || 'Please log in to access this resource'
      });
    }

    const supabaseAdmin = createAdminClient();
    if (!supabaseAdmin) {
      console.error('Supabase admin client not configured - cannot update profile');
      return res.status(500).json({ error: 'Supabase admin client not configured' });
    }

    const result = await stripeService.verifyCheckoutSession(sessionId);

    if (!result.success) {
      return res.status(400).json({ error: result.message || 'Payment not completed' });
    }

    if (result.userId && result.userId !== user.id) {
      console.warn(`Session user mismatch: expected ${user.id}, got ${result.userId}`);
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    // SECURITY: Check if this session was already processed (prevent replay attacks)
    // Try to atomically mark it as processed - returns false if already exists
    const { data: isNewSession, error: sessionError } = await supabaseAdmin.rpc('mark_session_processed', {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_session_type: result.type,
      p_credits_added: result.creditsAdded || 0
    });

    // If RPC doesn't exist yet, fall back to manual check
    if (sessionError && sessionError.message.includes('function')) {
      // Fallback: check if session exists in processed_sessions table
      const { data: existing } = await supabaseAdmin
        .from('processed_sessions')
        .select('session_id')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (existing) {
        console.warn(`Session replay attempt: ${sessionId} already processed for user ${user.id}`);
        return res.status(400).json({ error: 'Session already processed' });
      }

      // If table doesn't exist, log warning but continue (for backwards compatibility)
      if (sessionError.message.includes('relation')) {
        console.warn('processed_sessions table not found - session replay protection disabled');
      }
    } else if (isNewSession === false) {
      console.warn(`Session replay blocked: ${sessionId} already processed`);
      return res.status(400).json({ error: 'Session already processed' });
    }

    const updateData = {
      stripe_customer_id: result.customerId,
      updated_at: new Date().toISOString()
    };

    if (result.type === 'subscription') {
      updateData.tier = 'base';
      updateData.stripe_subscription_id = result.subscriptionId;
      updateData.subscription_status = 'active';
      updateData.monthly_generation_count = 0;
      updateData.monthly_reset_at = getNextResetDate().toISOString();
    } else if (result.type === 'credit' || result.type === 'watermark_removal') {
      // Use atomic increment_credits RPC if available, fallback to manual update
      const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('increment_credits', {
        p_user_id: user.id,
        p_credits_to_add: result.creditsAdded,
        p_customer_id: result.customerId
      });

      if (rpcError && rpcError.message.includes('function')) {
        // Fallback to non-atomic update if RPC doesn't exist
        console.warn('increment_credits RPC not found - using non-atomic fallback');
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('credit_balance')
          .eq('id', user.id)
          .single();

        if (profileError) {
          console.error('Failed to fetch credit balance:', profileError.message);
          return res.status(500).json({ error: 'Failed to fetch credit balance' });
        }

        updateData.credit_balance = (profile?.credit_balance || 0) + result.creditsAdded;
      } else if (rpcError) {
        console.error('increment_credits RPC error:', rpcError.message);
        return res.status(500).json({ error: 'Failed to add credits' });
      }
      // If RPC succeeded, credit_balance is already updated - skip it in updateData
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', user.id);

    if (updateError) {
      console.error('Failed to update profile:', updateError.message);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    res.json({
      success: true,
      type: result.type,
      tier: result.type === 'subscription' ? 'base' : undefined,
      creditsAdded: result.creditsAdded
    });
  } catch (error) {
    console.error('Verify session error:', error.message);
    res.status(500).json({ error: 'Failed to verify session' });
  }
};
