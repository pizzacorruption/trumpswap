/**
 * Usage Tracking Service for Pimp My Epstein
 * Handles generation counting, tier checks, and credit management
 *
 * Two-Tier Generation System:
 * - Quick (gemini-2.5-flash-image-preview): Fast, good quality
 * - Premium (gemini-3-pro-image-preview): Best quality
 *
 * Quotas:
 * - Anonymous: 3 quick + 1 premium (separate quotas, watermarked)
 * - Free (registered): 5 quick + 1 premium (separate quotas, watermarked)
 * - Base ($14.99/mo): 50 total from shared pool (any model, watermark-free)
 * - Credits: 1 credit = quick, 2 credits = premium
 *
 * Anonymous Tracking:
 * - Primary: Supabase usage_counters table (persistent, survives cold starts)
 * - Fallback: In-memory Map (for when Supabase unavailable)
 * - Session ID: httpOnly cookie with anon_id (XSS-proof)
 */

const tiers = require('../config/tiers');

// In-memory fallback for anonymous users (used when Supabase unavailable)
// Structure: { quickCount: number, premiumCount: number, createdAt: number }
const anonymousUsageFallback = new Map();

// TTL for anonymous usage entries (24 hours)
const ANONYMOUS_USAGE_TTL = 24 * 60 * 60 * 1000;

// Cleanup interval (run every hour)
const CLEANUP_INTERVAL = 60 * 60 * 1000;

// Cache for Supabase anonymous usage (reduces DB calls, 1 min TTL)
const anonUsageCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Clean up expired anonymous usage entries (fallback only)
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  const expiredBefore = now - ANONYMOUS_USAGE_TTL;

  for (const [ip, data] of anonymousUsageFallback.entries()) {
    if (data.createdAt < expiredBefore) {
      anonymousUsageFallback.delete(ip);
    }
  }

  // Also clean cache
  for (const [key, data] of anonUsageCache.entries()) {
    if (data.cachedAt < now - CACHE_TTL) {
      anonUsageCache.delete(key);
    }
  }
}

// Start periodic cleanup
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL);

/**
 * Get user's subscription tier
 */
function getUserTier(userId, profile = null) {
  if (!userId) {
    return 'anonymous';
  }

  if (profile) {
    if (profile.tier === 'base' || profile.tier === 'paid' || profile.subscription_status === 'active') {
      return profile.tier === 'base' ? 'base' : 'paid';
    }
  }

  return 'free';
}

/**
 * Check if a user's monthly usage should be reset
 */
function shouldResetMonthlyUsage(profile) {
  if (!profile || !profile.monthly_reset_at) {
    return false;
  }

  const resetDate = new Date(profile.monthly_reset_at);
  const now = new Date();

  return now >= resetDate;
}

/**
 * Calculate the next monthly reset date (1 month from now)
 */
function getNextResetDate() {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setMonth(nextReset.getMonth() + 1);
  return nextReset;
}

/**
 * Get user's credit balance
 */
function getCreditBalance(profile) {
  return profile?.credit_balance || 0;
}

/**
 * Get credit cost for a model type
 * @param {'quick' | 'premium'} modelType
 * @returns {number}
 */
function getCreditCost(modelType) {
  return modelType === 'premium' ? tiers.credit.premiumCost : tiers.credit.quickCost;
}

/**
 * Get anonymous usage from cache or fallback
 * @param {string|null} anonId - Anonymous session ID (from cookie)
 * @param {string|null} ipAddress - Fallback IP address
 * @returns {{ quickCount: number, premiumCount: number }}
 */
function getAnonymousUsageCounts(anonId, ipAddress) {
  const now = Date.now();

  // Try anon_id first (primary key for persistent tracking)
  if (anonId) {
    // Check cache
    const cached = anonUsageCache.get(anonId);
    if (cached && cached.cachedAt >= now - CACHE_TTL) {
      return { quickCount: cached.quickCount, premiumCount: cached.premiumCount };
    }
  }

  // Fallback to IP-based in-memory storage
  if (ipAddress) {
    const entry = anonymousUsageFallback.get(ipAddress);
    if (entry && entry.createdAt >= now - ANONYMOUS_USAGE_TTL) {
      return { quickCount: entry.quickCount || 0, premiumCount: entry.premiumCount || 0 };
    }
  }

  return { quickCount: 0, premiumCount: 0 };
}

/**
 * Update anonymous usage cache
 * @param {string} anonId - Anonymous session ID
 * @param {number} quickCount - Current quick count
 * @param {number} premiumCount - Current premium count
 */
function updateAnonCache(anonId, quickCount, premiumCount) {
  if (anonId) {
    anonUsageCache.set(anonId, {
      quickCount,
      premiumCount,
      cachedAt: Date.now()
    });
  }
}

/**
 * Check if user can generate with a specific model
 * @param {string|null} userId
 * @param {object|null} profile
 * @param {'quick' | 'premium'} modelType
 * @param {string|null} ipAddress
 * @param {string|null} anonId - Anonymous session ID (from cookie)
 * @returns {{ canGenerate: boolean, reason: string, useCredit: boolean, creditCost: number }}
 */
function checkModelUsage(userId, profile, modelType, ipAddress = null, anonId = null) {
  const tier = getUserTier(userId, profile);
  const tierConfig = tiers[tier];
  const creditCost = getCreditCost(modelType);
  const credits = getCreditBalance(profile);

  // Base/paid tier: shared pool of 50 (any model)
  if (tier === 'base' || tier === 'paid') {
    let monthlyUsed = profile?.monthly_generation_count || 0;

    if (shouldResetMonthlyUsage(profile)) {
      monthlyUsed = 0;
    }

    if (monthlyUsed < tierConfig.monthlyLimit) {
      const remaining = tierConfig.monthlyLimit - monthlyUsed;
      return {
        canGenerate: true,
        reason: `${remaining} of ${tierConfig.monthlyLimit} remaining`,
        useCredit: false,
        creditCost: 0
      };
    }

    // Monthly limit exceeded - check credits
    if (credits >= creditCost) {
      return {
        canGenerate: true,
        reason: `Using ${creditCost} credit(s)`,
        useCredit: true,
        creditCost
      };
    }

    return {
      canGenerate: false,
      reason: 'Monthly limit reached. Purchase credits for more.',
      useCredit: false,
      creditCost
    };
  }

  // Anonymous/Free tier: separate quick/premium quotas
  let quickUsed = 0;
  let premiumUsed = 0;

  if (tier === 'anonymous') {
    const usage = getAnonymousUsageCounts(anonId, ipAddress);
    quickUsed = usage.quickCount;
    premiumUsed = usage.premiumCount;
  } else if (profile) {
    quickUsed = profile.quick_count || 0;
    premiumUsed = profile.premium_count || 0;
  }

  const quickLimit = tierConfig.quickLimit;
  const premiumLimit = tierConfig.premiumLimit;

  if (modelType === 'quick') {
    if (quickUsed < quickLimit) {
      return {
        canGenerate: true,
        reason: `${quickLimit - quickUsed} quick generations remaining`,
        useCredit: false,
        creditCost: 0
      };
    }

    // Quick limit exceeded - check credits
    if (tierConfig.canPurchaseCredits && credits >= creditCost) {
      return {
        canGenerate: true,
        reason: `Using ${creditCost} credit`,
        useCredit: true,
        creditCost
      };
    }

    return {
      canGenerate: false,
      reason: 'Quick generation limit reached. Upgrade or buy credits.',
      useCredit: false,
      creditCost
    };
  }

  // Premium model
  if (premiumUsed < premiumLimit) {
    return {
      canGenerate: true,
      reason: `${premiumLimit - premiumUsed} premium generation(s) remaining`,
      useCredit: false,
      creditCost: 0
    };
  }

  // Premium limit exceeded - check credits
  if (tierConfig.canPurchaseCredits && credits >= creditCost) {
    return {
      canGenerate: true,
      reason: `Using ${creditCost} credits`,
      useCredit: true,
      creditCost
    };
  }

  return {
    canGenerate: false,
    reason: 'Premium generation used. Upgrade or buy credits.',
    useCredit: false,
    creditCost
  };
}

/**
 * Check usage for a user (enhanced with model-specific info)
 * @param {string|null} userId
 * @param {object|null} profile
 * @param {string|null} ipAddress
 * @param {'quick' | 'premium'} modelType - defaults to 'quick'
 * @param {string|null} anonId - Anonymous session ID (from cookie)
 */
function checkUsage(userId, profile = null, ipAddress = null, modelType = 'quick', anonId = null) {
  const tier = getUserTier(userId, profile);
  const tierConfig = tiers[tier];

  let used = 0;
  let monthlyUsed = 0;
  let quickUsed = 0;
  let premiumUsed = 0;

  if (tier === 'anonymous') {
    // Use new helper that supports both Supabase (anon_id) and fallback (IP)
    const usage = getAnonymousUsageCounts(anonId, ipAddress);
    quickUsed = usage.quickCount;
    premiumUsed = usage.premiumCount;
    used = quickUsed + premiumUsed;
  } else if (profile) {
    used = profile.generation_count || 0;
    monthlyUsed = profile.monthly_generation_count || 0;
    quickUsed = profile.quick_count || 0;
    premiumUsed = profile.premium_count || 0;

    if (shouldResetMonthlyUsage(profile)) {
      monthlyUsed = 0;
    }
  }

  // Check model-specific usage
  const modelUsage = checkModelUsage(userId, profile, modelType, ipAddress, anonId);

  // For base/paid, the limit is monthly pool
  const limit = tierConfig.limit;
  const monthlyLimit = tierConfig.monthlyLimit || limit;

  return {
    used,
    limit: limit === Infinity ? 'unlimited' : limit,
    remaining: limit === Infinity ? 'unlimited' : Math.max(0, limit - used),
    canGenerate: modelUsage.canGenerate,
    tier,
    tierName: tierConfig.name,
    // Monthly tracking (for base/paid)
    monthlyUsed,
    monthlyLimit: monthlyLimit === Infinity ? 'unlimited' : monthlyLimit,
    monthlyRemaining: monthlyLimit === Infinity ? 'unlimited' : Math.max(0, monthlyLimit - monthlyUsed),
    // Quick/Premium tracking (for free/anonymous)
    quickUsed,
    quickLimit: tierConfig.quickLimit,
    quickRemaining: Math.max(0, tierConfig.quickLimit - quickUsed),
    premiumUsed,
    premiumLimit: tierConfig.premiumLimit,
    premiumRemaining: Math.max(0, tierConfig.premiumLimit - premiumUsed),
    // Credit info
    credits: getCreditBalance(profile),
    // Model-specific info
    modelType,
    useCredit: modelUsage.useCredit,
    creditCost: modelUsage.creditCost,
    reason: modelUsage.reason,
    // Watermark (base/paid = no watermark)
    watermarkFree: tierConfig.watermarkFree,
    // Reset info
    needsMonthlyReset: shouldResetMonthlyUsage(profile),
    monthlyResetAt: profile?.monthly_reset_at || null
  };
}

/**
 * Increment usage count for a user
 * @param {string|null} userId
 * @param {object|null} profile
 * @param {string|null} ipAddress
 * @param {'quick' | 'premium'} modelType
 * @param {boolean} useCredit
 * @param {number} creditCost
 * @param {string|null} anonId - Anonymous session ID (from cookie)
 */
function incrementUsage(userId, profile = null, ipAddress = null, modelType = 'quick', useCredit = false, creditCost = 0, anonId = null) {
  const tier = getUserTier(userId, profile);
  const tierConfig = tiers[tier];
  const now = Date.now();

  if (tier === 'anonymous') {
    // Get current usage from cache/fallback
    const currentUsage = getAnonymousUsageCounts(anonId, ipAddress);
    let quickCount = currentUsage.quickCount;
    let premiumCount = currentUsage.premiumCount;

    // Increment appropriate counter
    if (modelType === 'quick') {
      quickCount += 1;
    } else {
      premiumCount += 1;
    }

    // Update fallback storage (IP-based)
    if (ipAddress) {
      anonymousUsageFallback.set(ipAddress, {
        quickCount,
        premiumCount,
        createdAt: now
      });

      // Memory management for fallback
      if (anonymousUsageFallback.size > 10000) {
        cleanupExpiredEntries();
        if (anonymousUsageFallback.size > 10000) {
          const entries = Array.from(anonymousUsageFallback.entries())
            .sort((a, b) => a[1].createdAt - b[1].createdAt);
          entries.slice(0, 5000).forEach(([key]) => anonymousUsageFallback.delete(key));
        }
      }
    }

    // Update cache if using anon_id
    if (anonId) {
      updateAnonCache(anonId, quickCount, premiumCount);
    }

    // For anonymous users, shouldUpdateDb=true means Supabase should be updated
    // The caller (lib/anon.js) handles the actual Supabase RPC call
    return {
      success: true,
      newCount: quickCount + premiumCount,
      newQuickCount: quickCount,
      newPremiumCount: premiumCount,
      newMonthlyCount: 0,
      newCredits: 0,
      shouldUpdateDb: !!anonId, // Only update DB if we have anon_id
      resetMonthly: false,
      anonId
    };
  }

  // Authenticated users
  const currentCount = profile?.generation_count || 0;
  let currentMonthlyCount = profile?.monthly_generation_count || 0;
  let currentQuickCount = profile?.quick_count || 0;
  let currentPremiumCount = profile?.premium_count || 0;
  let currentCredits = profile?.credit_balance || 0;
  let resetMonthly = false;

  if (shouldResetMonthlyUsage(profile)) {
    currentMonthlyCount = 0;
    resetMonthly = true;
  }

  // Handle credit usage
  if (useCredit) {
    if (currentCredits < creditCost) {
      return {
        success: false,
        error: 'Insufficient credits',
        newCount: currentCount,
        newQuickCount: currentQuickCount,
        newPremiumCount: currentPremiumCount,
        newMonthlyCount: currentMonthlyCount,
        newCredits: currentCredits,
        shouldUpdateDb: false,
        resetMonthly
      };
    }

    return {
      success: true,
      newCount: currentCount + 1,
      newQuickCount: currentQuickCount,
      newPremiumCount: currentPremiumCount,
      newMonthlyCount: currentMonthlyCount,
      newCredits: currentCredits - creditCost,
      shouldUpdateDb: true,
      resetMonthly,
      modelType,
      usedCredits: creditCost
    };
  }

  // Base/paid tier: increment shared monthly pool
  if (tier === 'base' || tier === 'paid') {
    return {
      success: true,
      newCount: currentCount + 1,
      newQuickCount: currentQuickCount,
      newPremiumCount: currentPremiumCount,
      newMonthlyCount: currentMonthlyCount + 1,
      newCredits: currentCredits,
      shouldUpdateDb: true,
      resetMonthly,
      modelType
    };
  }

  // Free tier: increment model-specific counter
  if (modelType === 'quick') {
    return {
      success: true,
      newCount: currentCount + 1,
      newQuickCount: currentQuickCount + 1,
      newPremiumCount: currentPremiumCount,
      newMonthlyCount: currentMonthlyCount,
      newCredits: currentCredits,
      shouldUpdateDb: true,
      resetMonthly,
      modelType
    };
  }

  // Premium for free tier
  return {
    success: true,
    newCount: currentCount + 1,
    newQuickCount: currentQuickCount,
    newPremiumCount: currentPremiumCount + 1,
    newMonthlyCount: currentMonthlyCount,
    newCredits: currentCredits,
    shouldUpdateDb: true,
    resetMonthly,
    modelType
  };
}

/**
 * Reset anonymous usage for an IP (for testing)
 */
function resetAnonymousUsage(ipAddress) {
  anonymousUsageFallback.delete(ipAddress);
}

/**
 * Get anonymous usage stats (for debugging)
 */
function getAnonymousStats() {
  return {
    totalTracked: anonymousUsageFallback.size
  };
}

module.exports = {
  getUserTier,
  checkUsage,
  checkModelUsage,
  incrementUsage,
  updateAnonCache,
  resetAnonymousUsage,
  getAnonymousStats,
  shouldResetMonthlyUsage,
  getNextResetDate,
  getCreditBalance,
  getCreditCost
};
