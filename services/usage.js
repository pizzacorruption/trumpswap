/**
 * Usage Tracking Service for Pimp My Epstein
 * Handles generation counting and tier checks
 */

const tiers = require('../config/tiers');

// In-memory storage for anonymous users (by IP)
// Each entry: { count: number, createdAt: number }
// In production, this should be Redis or similar with native TTL support
const anonymousUsage = new Map();

// TTL for anonymous usage entries (24 hours)
const ANONYMOUS_USAGE_TTL = 24 * 60 * 60 * 1000;

// Cleanup interval (run every hour)
const CLEANUP_INTERVAL = 60 * 60 * 1000;

/**
 * Clean up expired anonymous usage entries
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  const expiredBefore = now - ANONYMOUS_USAGE_TTL;

  for (const [ip, data] of anonymousUsage.entries()) {
    if (data.createdAt < expiredBefore) {
      anonymousUsage.delete(ip);
    }
  }
}

// Start periodic cleanup
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL);

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

  // Check both 'tier' (new schema) and 'subscription_status' (legacy) for backward compatibility
  // This ensures existing paid users aren't incorrectly treated as free during migration
  if (profile && (profile.tier === 'paid' || profile.subscription_status === 'active')) {
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
    // Data structure: { count: number, createdAt: number }
    const entry = anonymousUsage.get(ipAddress);
    if (entry) {
      // Check if entry has expired
      const now = Date.now();
      if (entry.createdAt < now - ANONYMOUS_USAGE_TTL) {
        // Entry expired, treat as 0 usage
        anonymousUsage.delete(ipAddress);
        used = 0;
      } else {
        used = entry.count;
      }
    }
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
 * Increment usage count for a user (with atomic limit check)
 * For anonymous users, updates in-memory storage
 * For authenticated users, returns the new count (caller should update DB)
 *
 * This function performs an atomic check-and-increment to prevent race conditions
 * where parallel requests could all pass an initial checkUsage() before any increment.
 *
 * @param {string|null} userId - User ID or null for anonymous
 * @param {object|null} profile - User profile from database
 * @param {string|null} ipAddress - IP address for anonymous tracking
 * @returns {{ success: boolean, newCount: number, shouldUpdateDb: boolean, error?: string }}
 */
function incrementUsage(userId, profile = null, ipAddress = null) {
  const tier = getUserTier(userId, profile);
  const tierConfig = tiers[tier];
  const limit = tierConfig.limit;
  const now = Date.now();

  if (tier === 'anonymous') {
    // Data structure: { count: number, createdAt: number }
    let entry = anonymousUsage.get(ipAddress);
    let current = 0;

    if (entry) {
      // Check if entry has expired
      if (entry.createdAt < now - ANONYMOUS_USAGE_TTL) {
        // Entry expired, start fresh
        entry = null;
      } else {
        current = entry.count;
      }
    }

    // Atomic check: verify limit again before incrementing
    if (limit !== Infinity && current >= limit) {
      return {
        success: false,
        newCount: current,
        shouldUpdateDb: false,
        error: 'Usage limit exceeded'
      };
    }

    const newCount = current + 1;
    anonymousUsage.set(ipAddress, {
      count: newCount,
      createdAt: entry ? entry.createdAt : now
    });

    // Clean up old entries periodically (simple memory management)
    // Note: cleanupExpiredEntries() also runs on interval, but this handles size overflow
    if (anonymousUsage.size > 10000) {
      cleanupExpiredEntries();
      // If still too large after TTL cleanup, remove oldest entries
      if (anonymousUsage.size > 10000) {
        const entries = Array.from(anonymousUsage.entries())
          .sort((a, b) => a[1].createdAt - b[1].createdAt);
        entries.slice(0, 5000).forEach(([key]) => anonymousUsage.delete(key));
      }
    }

    return { success: true, newCount, shouldUpdateDb: false };
  }

  // For authenticated users, check limit before returning new count
  const currentCount = profile?.generation_count || 0;

  // Atomic check: verify limit again before incrementing
  if (limit !== Infinity && currentCount >= limit) {
    return {
      success: false,
      newCount: currentCount,
      shouldUpdateDb: false,
      error: 'Usage limit exceeded'
    };
  }

  return {
    success: true,
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
