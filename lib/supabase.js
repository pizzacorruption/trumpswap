/**
 * Supabase Client Configuration
 * Provides both server-side and client-side Supabase clients
 *
 * Two clients are exported:
 * - supabase (anon key): For client-side auth verification
 * - supabaseAdmin (service role key): For server-side profile CRUD (bypasses RLS)
 */

const { createClient } = require('@supabase/supabase-js');

// Environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Server-side Supabase client (anon key)
 * Uses the anon key for public operations and auth verification
 * Subject to RLS policies - use for auth only
 */
function createServerClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Warning: Supabase credentials not configured. Auth features disabled.');
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

/**
 * Server-side Supabase admin client (service role key)
 * Bypasses RLS policies - use for server-side profile CRUD operations
 * SECURITY: Never expose this client or key to the client-side
 */
function createAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('Warning: Supabase service role key not configured. Profile operations will fail.');
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

/**
 * Get Supabase client configuration for frontend
 * Returns the public URL and anon key that can be safely exposed to the client
 */
function getClientConfig() {
  return {
    url: supabaseUrl || '',
    anonKey: supabaseAnonKey || ''
  };
}

/**
 * Verify a JWT token with Supabase
 * @param {string} token - The JWT token to verify
 * @returns {Promise<{user: object|null, error: Error|null}>}
 */
async function verifyToken(token) {
  const supabase = createServerClient();

  if (!supabase) {
    return { user: null, error: new Error('Supabase not configured') };
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      return { user: null, error };
    }

    return { user, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
}

// Create singleton instances for server use
const supabase = createServerClient();
const supabaseAdmin = createAdminClient();

module.exports = {
  supabase,           // Anon key client - for auth verification (subject to RLS)
  supabaseAdmin,      // Service role client - for profile CRUD (bypasses RLS)
  createServerClient,
  createAdminClient,
  getClientConfig,
  verifyToken
};
