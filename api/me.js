/**
 * /api/me - Get current user or anonymous session usage
 *
 * For anonymous users: Returns usage from Supabase usage_counters table
 * For authenticated users: Returns profile with usage info
 *
 * This endpoint is critical for persistent usage tracking across page refreshes.
 */

const { verifyToken, createAdminClient } = require('../lib/supabase');
const { getAnonUsage, getOrCreateAnonId, isValidUUID } = require('../lib/anon');
const { checkUsage, updateAnonCache } = require('../services/usage');
const tiers = require('../config/tiers');
const crypto = require('crypto');

// SECURITY: Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://pimpmyepstein.lol',
  'https://www.pimpmyepstein.lol',
];

// Allow localhost in development
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

/**
 * Get CORS origin - returns origin if allowed, null otherwise
 */
function getCorsOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return null;
}

/**
 * Parse cookies from request header
 */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const pairs = header.split(';').map((c) => c.trim()).filter(Boolean);
  const cookies = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

/**
 * Get or create anonymous session ID
 */
function getOrCreateAnonIdFromReq(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies.anon_id;

  if (existing && isValidUUID(existing)) {
    return { anonId: existing, isNew: false };
  }

  // Generate new anon_id
  const anonId = crypto.randomUUID();
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `anon_id=${anonId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`);

  return { anonId, isNew: true };
}

module.exports = async function handler(req, res) {
  // SECURITY: Restrict CORS to allowed origins only
  const origin = req.headers.origin;
  const corsOrigin = getCorsOrigin(origin);

  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check for authenticated user first
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { user, error } = await verifyToken(token);

      if (!error && user) {
        // Authenticated user - get profile from database
        const supabaseAdmin = createAdminClient();

        if (supabaseAdmin) {
          const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (!profileError && profile) {
            const usage = checkUsage(user.id, profile, null, 'quick');

            return res.json({
              authenticated: true,
              user: {
                id: user.id,
                email: user.email
              },
              profile: {
                tier: usage.tier,
                tierName: usage.tierName
              },
              usage: {
                used: usage.used,
                limit: usage.limit,
                remaining: usage.remaining,
                tier: usage.tier,
                quickUsed: usage.quickUsed,
                quickRemaining: usage.quickRemaining,
                quickLimit: usage.quickLimit,
                premiumUsed: usage.premiumUsed,
                premiumRemaining: usage.premiumRemaining,
                premiumLimit: usage.premiumLimit,
                credits: usage.credits,
                watermarkFree: usage.watermarkFree,
                monthlyUsed: usage.monthlyUsed,
                monthlyLimit: usage.monthlyLimit,
                monthlyRemaining: usage.monthlyRemaining
              }
            });
          }
        }
      }
    }

    // Anonymous user - get or create anon_id and fetch usage from Supabase
    const { anonId, isNew } = getOrCreateAnonIdFromReq(req, res);

    // Get usage from Supabase (persistent storage)
    const anonUsage = await getAnonUsage(anonId);

    // Update local cache for faster subsequent checks
    updateAnonCache(anonId, anonUsage.quickCount, anonUsage.premiumCount);

    // Get tier config for limits
    const tierConfig = tiers.anonymous;

    const quickRemaining = Math.max(0, tierConfig.quickLimit - anonUsage.quickCount);
    const premiumRemaining = Math.max(0, tierConfig.premiumLimit - anonUsage.premiumCount);
    const totalUsed = anonUsage.quickCount + anonUsage.premiumCount;
    const totalLimit = tierConfig.quickLimit + tierConfig.premiumLimit;

    return res.json({
      authenticated: false,
      anonymous: true,
      anonId: isNew ? 'new' : 'existing', // Don't expose actual ID
      usage: {
        used: totalUsed,
        limit: totalLimit,
        remaining: totalLimit - totalUsed,
        tier: 'anonymous',
        quickUsed: anonUsage.quickCount,
        quickRemaining,
        quickLimit: tierConfig.quickLimit,
        premiumUsed: anonUsage.premiumCount,
        premiumRemaining,
        premiumLimit: tierConfig.premiumLimit,
        credits: 0,
        watermarkFree: false
      }
    });

  } catch (error) {
    console.error('/api/me error:', error.message);

    // Return safe defaults on error
    const tierConfig = tiers.anonymous;
    return res.json({
      authenticated: false,
      anonymous: true,
      error: 'Failed to fetch usage',
      usage: {
        used: 0,
        limit: tierConfig.quickLimit + tierConfig.premiumLimit,
        remaining: tierConfig.quickLimit + tierConfig.premiumLimit,
        tier: 'anonymous',
        quickUsed: 0,
        quickRemaining: tierConfig.quickLimit,
        quickLimit: tierConfig.quickLimit,
        premiumUsed: 0,
        premiumRemaining: tierConfig.premiumLimit,
        premiumLimit: tierConfig.premiumLimit,
        credits: 0,
        watermarkFree: false
      }
    });
  }
};
