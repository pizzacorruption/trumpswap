/**
 * Anonymous Session Management for Pimp My Epstein
 *
 * Manages anonymous user sessions using httpOnly cookies and Supabase persistence.
 * This replaces the in-memory Map which resets on Vercel serverless cold starts.
 *
 * Key Features:
 * - Server-issued anon_id stored in httpOnly cookie (XSS-proof)
 * - Persistent usage tracking in Supabase usage_counters table
 * - Abuse detection signals: IP prefix, UA hash, fingerprint hash
 * - 24-hour rolling window for anonymous quota
 */

const crypto = require('crypto');
const { createAdminClient } = require('./supabase');

// Cookie configuration
const ANON_COOKIE_NAME = 'anon_id';
const ANON_COOKIE_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds
const WINDOW_SECONDS = 24 * 60 * 60; // 24 hours for anonymous quota window

/**
 * Generate a new anonymous ID (UUID v4)
 */
function generateAnonId() {
  return crypto.randomUUID();
}

/**
 * Hash a value for privacy (SHA-256, truncated)
 * @param {string} value - Value to hash
 * @returns {string} Truncated hash
 */
function hashValue(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 32);
}

/**
 * Extract IP prefix for abuse detection
 * @param {string} ip - Full IP address
 * @returns {string} IP prefix (/24 for IPv4, /64 for IPv6)
 */
function getIpPrefix(ip) {
  if (!ip) return null;

  // IPv4: keep first 3 octets (xxx.xxx.xxx.0)
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6: keep first 4 groups
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) {
      return parts.slice(0, 4).join(':') + '::';
    }
  }

  return ip;
}

/**
 * Get or create anonymous session ID from request
 * Sets httpOnly cookie if new session created
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {{ anonId: string, isNew: boolean }}
 */
function getOrCreateAnonId(req, res) {
  // Check for existing cookie
  const existingId = req.cookies?.[ANON_COOKIE_NAME];

  if (existingId && isValidUUID(existingId)) {
    return { anonId: existingId, isNew: false };
  }

  // Generate new anon_id
  const newId = generateAnonId();

  // Set httpOnly cookie
  res.cookie(ANON_COOKIE_NAME, newId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ANON_COOKIE_MAX_AGE * 1000, // Convert to milliseconds
    path: '/'
  });

  return { anonId: newId, isNew: true };
}

/**
 * Validate UUID format
 * @param {string} str - String to validate
 * @returns {boolean}
 */
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Get anonymous usage from Supabase
 * Falls back to zeros if not found or Supabase not available
 *
 * @param {string} anonId - Anonymous session ID
 * @returns {Promise<{ quickCount: number, premiumCount: number, windowStartedAt: Date|null }>}
 */
async function getAnonUsage(anonId) {
  const supabaseAdmin = createAdminClient();

  if (!supabaseAdmin) {
    console.warn('[anon] Supabase not configured, returning zeros');
    return { quickCount: 0, premiumCount: 0, windowStartedAt: null };
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('get_usage_counter', {
      p_user_id: null,
      p_anon_id: anonId
    });

    if (error) {
      console.error('[anon] Error getting usage:', error.message);
      return { quickCount: 0, premiumCount: 0, windowStartedAt: null };
    }

    if (!data || data.length === 0) {
      return { quickCount: 0, premiumCount: 0, windowStartedAt: null };
    }

    const row = data[0];
    return {
      quickCount: row.quick_count || 0,
      premiumCount: row.premium_count || 0,
      windowStartedAt: row.window_started_at ? new Date(row.window_started_at) : null
    };
  } catch (err) {
    console.error('[anon] Exception getting usage:', err.message);
    return { quickCount: 0, premiumCount: 0, windowStartedAt: null };
  }
}

/**
 * Increment anonymous usage in Supabase
 * Uses atomic increment_usage_counter RPC function
 *
 * @param {string} anonId - Anonymous session ID
 * @param {'quick' | 'premium'} modelType - Model type used
 * @param {object} signals - Abuse detection signals
 * @param {string} signals.ipAddress - Client IP address
 * @param {string} signals.userAgent - User-Agent header
 * @param {string} signals.fingerprint - FingerprintJS visitorId (optional)
 * @returns {Promise<{ success: boolean, quickCount: number, premiumCount: number }>}
 */
async function incrementAnonUsage(anonId, modelType, signals = {}) {
  const supabaseAdmin = createAdminClient();

  if (!supabaseAdmin) {
    console.warn('[anon] Supabase not configured, cannot persist usage');
    return { success: false, quickCount: 0, premiumCount: 0 };
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('increment_usage_counter', {
      p_user_id: null,
      p_anon_id: anonId,
      p_model_type: modelType,
      p_ip_prefix: getIpPrefix(signals.ipAddress),
      p_ua_hash: hashValue(signals.userAgent),
      p_fp_hash: signals.fingerprint ? hashValue(signals.fingerprint) : null,
      p_window_seconds: WINDOW_SECONDS
    });

    if (error) {
      console.error('[anon] Error incrementing usage:', error.message);
      return { success: false, quickCount: 0, premiumCount: 0 };
    }

    if (!data || data.length === 0) {
      console.error('[anon] No data returned from increment');
      return { success: false, quickCount: 0, premiumCount: 0 };
    }

    const row = data[0];
    return {
      success: true,
      quickCount: row.new_quick || 0,
      premiumCount: row.new_premium || 0,
      windowStartedAt: row.window_started_at
    };
  } catch (err) {
    console.error('[anon] Exception incrementing usage:', err.message);
    return { success: false, quickCount: 0, premiumCount: 0 };
  }
}

/**
 * Check if anonymous user can generate
 * @param {string} anonId - Anonymous session ID
 * @param {'quick' | 'premium'} modelType - Model type requested
 * @param {object} limits - Tier limits
 * @param {number} limits.quickLimit - Max quick generations
 * @param {number} limits.premiumLimit - Max premium generations
 * @returns {Promise<{ canGenerate: boolean, quickRemaining: number, premiumRemaining: number, reason: string }>}
 */
async function checkAnonCanGenerate(anonId, modelType, limits) {
  const usage = await getAnonUsage(anonId);

  const quickRemaining = Math.max(0, limits.quickLimit - usage.quickCount);
  const premiumRemaining = Math.max(0, limits.premiumLimit - usage.premiumCount);

  if (modelType === 'quick') {
    if (quickRemaining > 0) {
      return {
        canGenerate: true,
        quickRemaining,
        premiumRemaining,
        reason: `${quickRemaining} quick generations remaining`
      };
    }
    return {
      canGenerate: false,
      quickRemaining: 0,
      premiumRemaining,
      reason: 'Quick generation limit reached. Sign up for more!'
    };
  }

  // Premium
  if (premiumRemaining > 0) {
    return {
      canGenerate: true,
      quickRemaining,
      premiumRemaining,
      reason: `${premiumRemaining} premium generation(s) remaining`
    };
  }

  return {
    canGenerate: false,
    quickRemaining,
    premiumRemaining: 0,
    reason: 'Premium generation used. Sign up for more!'
  };
}

module.exports = {
  generateAnonId,
  getOrCreateAnonId,
  getAnonUsage,
  incrementAnonUsage,
  checkAnonCanGenerate,
  hashValue,
  getIpPrefix,
  isValidUUID,
  ANON_COOKIE_NAME,
  WINDOW_SECONDS
};
