/**
 * Supabase Client Configuration
 * Provides both server-side and client-side Supabase clients
 */

const { createClient } = require('@supabase/supabase-js');

// Environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

/**
 * Server-side Supabase client
 * Uses the anon key for public operations
 * For admin operations, use service role key instead
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

// Create a singleton instance for server use
const supabase = createServerClient();

module.exports = {
  supabase,
  createServerClient,
  getClientConfig,
  verifyToken
};
