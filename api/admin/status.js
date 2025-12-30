/**
 * /api/admin/status - Quick check if admin token is valid
 * Vercel Serverless Function
 *
 * Returns admin status without requiring authentication
 */

// SECURITY: Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://pimpmyepstein.lol',
  'https://www.pimpmyepstein.lol',
];

/**
 * Get CORS origin - returns the request origin if allowed, otherwise null
 */
function getCorsOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  // Allow localhost and 127.0.0.1 in development
  if (process.env.NODE_ENV !== 'production') {
    if (requestOrigin.startsWith('http://localhost') || requestOrigin.startsWith('http://127.0.0.1')) {
      return requestOrigin;
    }
  }
  return null;
}

// In-memory admin session store (simple for serverless - sessions are per-instance)
// For production, consider using Redis or database-backed sessions
const adminSessions = new Map();

/**
 * Validate admin token
 */
function isValidAdminToken(token) {
  if (!token) return false;
  const expiry = adminSessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Parse cookies from request header
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(cookie => {
      const [name, ...rest] = cookie.trim().split('=');
      return [name, rest.join('=')];
    })
  );
}

module.exports = async function handler(req, res) {
  // Handle CORS
  const origin = getCorsOrigin(req.headers.origin);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check for admin token from multiple sources
    const cookies = parseCookies(req.headers.cookie);
    const adminToken =
      req.headers['x-admin-token'] ||  // Header takes priority
      cookies.adminToken ||             // Then cookie
      req.query.adminToken;             // Query param as fallback (not recommended)

    const isAdmin = isValidAdminToken(adminToken);

    return res.status(200).json({
      isAdmin,
      adminConfigured: !!process.env.ADMIN_PASSWORD
    });
  } catch (error) {
    console.error('Admin status check error:', error.message);
    return res.status(200).json({
      isAdmin: false,
      adminConfigured: !!process.env.ADMIN_PASSWORD
    });
  }
};
