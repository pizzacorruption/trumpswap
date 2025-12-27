/**
 * Usage Tracking Service for Trump Swap
 * Handles generation counting and tier checks
 */

const tiers = require('../config/tiers');

// In-memory storage for anonymous users (by IP)
// In production, this should be Redis or similar
const anonymousUsage = new Map();

/**
 * Get user's subscription tier
 * @param {string|null} userId - User ID or null for anonymous
 * @param {object|null} profile - User profile from database (if authenticated)
 * @returns {'anonymous' | 'free' | 'paid'}
 */
function getUserTier(userId, profile = null) {
  if (!userId) {
    return 'anonymous';
  }

  if (profile && profile.subscription_status === 'active') {
    return 'paid';
  }

  return 'free';
}

/**
 * Check usage for a user
 * @param {string|null} userId - User ID or null for anonymous
 * @param {object|null} profile - User profile from database
 * @param {string|null} ipAddress - IP address for anonymous tracking
 * @returns {{ used: number, limit: number, canGenerate: boolean, tier: string }}
 */
function checkUsage(userId, profile = null, ipAddress = null) {
  const tier = getUserTier(userId, profile);
  const tierConfig = tiers[tier];

  let used = 0;

  if (tier === 'anonymous') {
    // Check in-memory storage by IP
    used = anonymousUsage.get(ipAddress) || 0;
  } else if (profile) {
    // Check database count
    used = profile.generation_count || 0;
  }

  const limit = tierConfig.limit;
  const canGenerate = limit === Infinity || used < limit;

  return {
    used,
    limit: limit === Infinity ? 'unlimited' : limit,
    remaining: limit === Infinity ? 'unlimited' : Math.max(0, limit - used),
    canGenerate,
    tier,
    tierName: tierConfig.name
  };
}

/**
 * Increment usage count for a user
 * For anonymous users, updates in-memory storage
 * For authenticated users, returns the new count (caller should update DB)
 * @param {string|null} userId - User ID or null for anonymous
 * @param {object|null} profile - User profile from database
 * @param {string|null} ipAddress - IP address for anonymous tracking
 * @returns {{ newCount: number, shouldUpdateDb: boolean }}
 */
function incrementUsage(userId, profile = null, ipAddress = null) {
  const tier = getUserTier(userId, profile);

  if (tier === 'anonymous') {
    const current = anonymousUsage.get(ipAddress) || 0;
    const newCount = current + 1;
    anonymousUsage.set(ipAddress, newCount);

    // Clean up old entries periodically (simple memory management)
    if (anonymousUsage.size > 10000) {
      const keys = Array.from(anonymousUsage.keys());
      keys.slice(0, 5000).forEach(key => anonymousUsage.delete(key));
    }

    return { newCount, shouldUpdateDb: false };
  }

  // For authenticated users, return new count for DB update
  const currentCount = profile?.generation_count || 0;
  return {
    newCount: currentCount + 1,
    shouldUpdateDb: true
  };
}

/**
 * Reset anonymous usage for an IP (for testing)
 * @param {string} ipAddress - IP address to reset
 */
function resetAnonymousUsage(ipAddress) {
  anonymousUsage.delete(ipAddress);
}

/**
 * Get anonymous usage stats (for debugging)
 * @returns {{ totalTracked: number }}
 */
function getAnonymousStats() {
  return {
    totalTracked: anonymousUsage.size
  };
}

module.exports = {
  getUserTier,
  checkUsage,
  incrementUsage,
  resetAnonymousUsage,
  getAnonymousStats
};
