/**
 * Rate Limiting Middleware for Trump Swap
 * Enforces generation limits based on user tier
 */

const { checkUsage, incrementUsage } = require('../services/usage');
const tiers = require('../config/tiers');

/**
 * Get client IP address from request
 * Handles proxied requests (Vercel, Cloudflare, etc.)
 * @param {object} req - Express request object
 * @returns {string} IP address
 */
function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

/**
 * Rate limit middleware factory
 * @param {object} options - Middleware options
 * @param {string} options.upgradeUrl - URL to redirect for upgrade
 * @param {function} options.getProfile - Async function to get user profile from DB
 * @param {function} options.updateProfile - Async function to update user profile in DB
 * @returns {function} Express middleware
 */
function createRateLimitMiddleware(options = {}) {
  const {
    upgradeUrl = '/pricing',
    getProfile = async () => null,
    updateProfile = async () => {}
  } = options;

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const userId = req.user?.id || null;
      const ipAddress = getClientIP(req);

      // Admin users bypass rate limits entirely
      if (req.isAdmin) {
        console.log('[ADMIN] Rate limit bypassed for admin user');
        req.usage = {
          tier: 'admin',
          tierName: 'Admin',
          used: 0,
          limit: Infinity,
          remaining: Infinity,
          canGenerate: true
        };
        req.clientIP = ipAddress;
        return next();
      }

      // Get user profile if authenticated
      let profile = null;
      if (userId) {
        try {
          profile = await getProfile(userId);
        } catch (err) {
          console.error('Error fetching profile for rate limit:', err.message);
        }
      }

      // Check current usage
      const usage = checkUsage(userId, profile, ipAddress);

      // Attach usage info to request for downstream use
      req.usage = usage;
      req.clientIP = ipAddress;

      // Check if user can generate
      if (!usage.canGenerate) {
        const tierConfig = tiers[usage.tier];

        return res.status(402).json({
          error: 'Generation limit reached',
          code: 'LIMIT_REACHED',
          tier: usage.tier,
          tierName: tierConfig.name,
          used: usage.used,
          limit: usage.limit,
          upgradeUrl,
          message: getUpgradeMessage(usage.tier)
        });
      }

      // Store original json method to intercept successful responses
      const originalJson = res.json.bind(res);
      res.json = async function(data) {
        // Only increment usage on successful generation
        if (data && data.success === true) {
          try {
            const result = incrementUsage(userId, profile, ipAddress);

            // Update database if needed
            if (result.shouldUpdateDb && userId) {
              await updateProfile(userId, {
                generation_count: result.newCount
              });
            }

            // Add usage info to response
            const updatedUsage = checkUsage(
              userId,
              profile ? { ...profile, generation_count: result.newCount } : null,
              ipAddress
            );

            data.usage = {
              used: updatedUsage.used,
              limit: updatedUsage.limit,
              remaining: updatedUsage.remaining,
              tier: updatedUsage.tier,
              tierName: updatedUsage.tierName
            };
          } catch (err) {
            console.error('Error updating usage:', err.message);
          }
        }

        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('Rate limit middleware error:', error);
      // Don't block on rate limit errors, just log and continue
      next();
    }
  };
}

/**
 * Get upgrade message based on tier
 * @param {string} tier - Current tier
 * @returns {string} Upgrade message
 */
function getUpgradeMessage(tier) {
  switch (tier) {
    case 'anonymous':
      return 'Sign up for free to get 3 more generations!';
    case 'free':
      return 'Upgrade to Pro for unlimited generations!';
    default:
      return 'Upgrade your plan for more generations.';
  }
}

/**
 * Simple rate limit check middleware (no DB integration)
 * Use this for quick setup without Supabase
 */
function simpleRateLimitMiddleware(req, res, next) {
  const middleware = createRateLimitMiddleware();
  return middleware(req, res, next);
}

module.exports = {
  createRateLimitMiddleware,
  simpleRateLimitMiddleware,
  getClientIP
};
