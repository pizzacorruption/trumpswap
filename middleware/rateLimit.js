/**
 * Rate Limiting Middleware for Pimp My Epstein
 * Enforces generation limits based on user tier
 */

const { checkUsage, checkModelUsage, incrementUsage, updateAnonCache } = require('../services/usage');
const tiers = require('../config/tiers');
const { getOrCreateAnonId, getAnonUsage, incrementAnonUsage } = require('../lib/anon');

/**
 * Get client IP address from request
 * SECURITY: Uses req.ip which respects Express's 'trust proxy' setting
 * When 'trust proxy' is configured, Express properly validates x-forwarded-for
 * headers from trusted proxies only (e.g., Vercel's infrastructure)
 * @param {object} req - Express request object
 * @returns {string} IP address
 */
function getClientIP(req) {
  // SECURITY: Use req.ip which respects 'trust proxy' setting
  // This prevents IP spoofing via x-forwarded-for from untrusted sources
  // The 'trust proxy' setting must be configured in server.js
  return req.ip || req.socket?.remoteAddress || 'unknown';
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
    updateProfile = async () => { }
  } = options;

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const userId = req.user?.id || null;
      const ipAddress = getClientIP(req);
      let anonId = null;

      if (req.isDevDebug) {
        req.usage = {
          tier: 'dev',
          tierName: 'Dev Debug',
          used: 0,
          limit: Infinity,
          remaining: Infinity,
          canGenerate: true
        };
        req.clientIP = ipAddress;
        return next();
      }

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

      // Test mode users bypass rate limits (for automated/agent testing)
      // Requires X-Test-Mode header matching TEST_MODE_SECRET env var
      if (req.isTestMode) {
        console.log('[TEST] Rate limit bypassed for test mode');
        req.usage = {
          tier: 'test',
          tierName: 'Test Mode',
          used: 0,
          limit: Infinity,
          remaining: Infinity,
          canGenerate: true
        };
        req.clientIP = ipAddress;
        return next();
      }

      // Get or create anon ID for anonymous users (persistent tracking)
      if (!userId) {
        const anonSession = getOrCreateAnonId(req, res);
        anonId = anonSession.anonId;

        const anonUsage = await getAnonUsage(anonId);
        updateAnonCache(anonId, anonUsage.quickCount, anonUsage.premiumCount);
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
      const usage = checkUsage(userId, profile, ipAddress, 'quick', anonId);

      // Attach usage info to request for downstream use
      req.usage = usage;
      req.clientIP = ipAddress;

      // Check if user can generate - MUST reject BEFORE any API call
      if (!usage.canGenerate) {
        const tierConfig = tiers[usage.tier];

        // Return 429 Too Many Requests to prevent API key abuse
        return res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          tier: usage.tier,
          tierName: tierConfig.name,
          limit: usage.limit,
          used: usage.used,
          remaining: 0,
          resetAt: new Date(Date.now() + 60000).toISOString(),
          upgradeUrl,
          message: getUpgradeMessage(usage.tier)
        });
      }

      // Store original json method to intercept successful responses
      const originalJson = res.json.bind(res);
      res.json = async function (data) {
        // Only increment usage on successful generation
        if (data && data.success === true) {
          try {
            // Get and validate modelType from request body (parsed by multer before handler runs)
            // SECURITY: server.js always uses premium model (gemini-3-pro-image-preview)
            // so we force 'premium' to prevent client-side quota manipulation
            let modelType = (req.body?.modelType || 'quick').toLowerCase().trim();

            // Validate modelType - only allow 'quick' or 'premium'
            if (modelType !== 'quick' && modelType !== 'premium') {
              modelType = 'premium';  // Default to premium (more restrictive)
            }

            // IMPORTANT: Re-check usage with actual modelType for correct credit charging
            // The initial check at line 70 was done without modelType (before body parse)
            const actualUsage = checkModelUsage(userId, profile, modelType, ipAddress, anonId);

            // Pass correct args with recalculated useCredit/creditCost
            const result = incrementUsage(userId, profile, ipAddress, modelType, actualUsage.useCredit, actualUsage.creditCost || 0, anonId);

            // Update database if needed - update ALL usage fields
            if (result.shouldUpdateDb && userId) {
              const updateData = {
                generation_count: result.newCount,
                monthly_generation_count: result.newMonthlyCount,
                credit_balance: result.newCredits,
                // Model-specific counts for free tier tracking
                quick_count: result.newQuickCount,
                premium_count: result.newPremiumCount
              };

              // Reset monthly_reset_at if monthly counter was reset
              if (result.resetMonthly) {
                const { getNextResetDate } = require('../services/usage');
                updateData.monthly_reset_at = getNextResetDate().toISOString();
              }

              await updateProfile(userId, updateData);
            }

            // Add usage info to response
            const updatedProfile = profile ? {
              ...profile,
              generation_count: result.newCount,
              monthly_generation_count: result.newMonthlyCount,
              credit_balance: result.newCredits,
              quick_count: result.newQuickCount,
              premium_count: result.newPremiumCount
            } : null;

            if (!userId && anonId) {
              const persist = await incrementAnonUsage(anonId, modelType, {
                ipAddress,
                userAgent: req.headers['user-agent']
              });
              if (persist.success) {
                updateAnonCache(anonId, persist.quickCount, persist.premiumCount);
              }
            }

            const updatedUsage = checkUsage(userId, updatedProfile, ipAddress, modelType, anonId);

            data.usage = {
              used: updatedUsage.used,
              limit: updatedUsage.limit,
              remaining: updatedUsage.remaining,
              tier: updatedUsage.tier,
              tierName: updatedUsage.tierName,
              // Model-specific remaining counts for button display
              quickRemaining: updatedUsage.quickRemaining,
              premiumRemaining: updatedUsage.premiumRemaining,
              quickUsed: updatedUsage.quickUsed,
              premiumUsed: updatedUsage.premiumUsed
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
      return 'Sign up for free to track your creations!';
    case 'free':
      return 'Upgrade to Base for 100 watermark-free images/month!';
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
