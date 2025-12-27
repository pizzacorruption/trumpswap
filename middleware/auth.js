/**
 * Authentication Middleware
 * Extracts and verifies JWT from Authorization header using Supabase
 * Non-blocking: allows anonymous users but marks them as such
 */

const { verifyToken } = require('../lib/supabase');

/**
 * Auth middleware that extracts JWT from Authorization header
 * and verifies it with Supabase
 *
 * Sets req.user to the authenticated user object or null for anonymous
 * Sets req.isAuthenticated to true/false
 *
 * Non-blocking: always calls next() regardless of auth status
 */
async function authMiddleware(req, res, next) {
  // Initialize as anonymous
  req.user = null;
  req.isAuthenticated = false;

  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      // No auth header - continue as anonymous
      return next();
    }

    // Expect "Bearer <token>" format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      // Malformed header - continue as anonymous
      console.warn('Auth: Malformed Authorization header');
      return next();
    }

    const token = parts[1];

    if (!token) {
      // Empty token - continue as anonymous
      return next();
    }

    // Verify token with Supabase
    const { user, error } = await verifyToken(token);

    if (error) {
      // Token verification failed - continue as anonymous
      console.warn('Auth: Token verification failed:', error.message);
      return next();
    }

    if (user) {
      // Successfully authenticated
      req.user = user;
      req.isAuthenticated = true;
    }
  } catch (err) {
    // Unexpected error - log and continue as anonymous
    console.error('Auth middleware error:', err.message);
  }

  next();
}

/**
 * Middleware that REQUIRES authentication
 * Use this for protected routes that must have a logged-in user
 */
function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
  }
  next();
}

/**
 * Middleware to check if user has a specific role or property
 * @param {Function} checkFn - Function that takes user and returns boolean
 * @param {string} errorMessage - Custom error message if check fails
 */
function requireUserCheck(checkFn, errorMessage = 'Access denied') {
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to access this resource'
      });
    }

    if (!checkFn(req.user)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: errorMessage
      });
    }

    next();
  };
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireUserCheck
};
