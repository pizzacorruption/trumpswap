/**
 * Generation History Service
 *
 * Tracks face swap generations for logged-in users.
 * Currently uses in-memory storage - swap for Supabase in production.
 */

const crypto = require('crypto');

// In-memory store (replace with Supabase for production)
const generations = new Map();

// Generation statuses
const STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * Generate a unique ID for a generation
 */
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Create a new pending generation record
 * @param {string} userId - The user's ID
 * @param {string} trumpPhoto - The Trump photo path used
 * @returns {object} The created generation record
 */
function createGeneration(userId, trumpPhoto) {
  const id = generateId();
  const generation = {
    id,
    userId,
    trumpPhoto,
    status: STATUS.PENDING,
    resultUrl: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  generations.set(id, generation);
  return generation;
}

/**
 * Mark a generation as completed with result URL
 * @param {string} id - The generation ID
 * @param {string} resultUrl - The URL/path to the generated image
 * @returns {object|null} The updated generation or null if not found
 */
function completeGeneration(id, resultUrl) {
  const generation = generations.get(id);
  if (!generation) {
    return null;
  }

  generation.status = STATUS.COMPLETED;
  generation.resultUrl = resultUrl;
  generation.completedAt = new Date().toISOString();

  generations.set(id, generation);
  return generation;
}

/**
 * Mark a generation as failed with error details
 * @param {string} id - The generation ID
 * @param {string} errorCode - Error code (e.g., 'SAFETY_BLOCK', 'API_ERROR')
 * @param {string} errorMessage - Human-readable error message
 * @returns {object|null} The updated generation or null if not found
 */
function failGeneration(id, errorCode, errorMessage) {
  const generation = generations.get(id);
  if (!generation) {
    return null;
  }

  generation.status = STATUS.FAILED;
  generation.errorCode = errorCode;
  generation.errorMessage = errorMessage;
  generation.completedAt = new Date().toISOString();

  generations.set(id, generation);
  return generation;
}

/**
 * Get a user's generation history
 * @param {string} userId - The user's ID
 * @param {number} limit - Maximum number of records to return (default 10)
 * @returns {array} Array of generation records, newest first
 */
function getGenerations(userId, limit = 10) {
  const userGenerations = [];

  for (const generation of generations.values()) {
    if (generation.userId === userId) {
      userGenerations.push(generation);
    }
  }

  // Sort by createdAt descending (newest first)
  userGenerations.sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );

  return userGenerations.slice(0, limit);
}

/**
 * Get a single generation by ID
 * @param {string} id - The generation ID
 * @returns {object|null} The generation record or null if not found
 */
function getGeneration(id) {
  return generations.get(id) || null;
}

/**
 * Clear all generations (useful for testing)
 */
function clearAll() {
  generations.clear();
}

module.exports = {
  createGeneration,
  completeGeneration,
  failGeneration,
  getGenerations,
  getGeneration,
  clearAll,
  STATUS,
};
