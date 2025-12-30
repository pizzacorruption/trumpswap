-- Migration: Add usage_counters table for persistent anonymous usage tracking
-- Fixes: In-memory Map resets on Vercel serverless cold starts
-- Run this in Supabase SQL Editor

-- ============================================================================
-- USAGE_COUNTERS TABLE
-- ============================================================================
-- Tracks usage for both authenticated users (user_id) and anonymous users (anon_id)
-- Key insight: subject_id = COALESCE(user_id, anon_id) for unified primary key

CREATE TABLE IF NOT EXISTS usage_counters (
  -- Primary key is either user_id or anon_id (unified)
  subject_id UUID PRIMARY KEY,

  -- One of these must be set (enforced by CHECK constraint)
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  anon_id UUID,

  -- Usage counts (separate quick/premium quotas for anonymous)
  quick_count INTEGER NOT NULL DEFAULT 0,
  premium_count INTEGER NOT NULL DEFAULT 0,

  -- Rolling window tracking (24h for anonymous, monthly for authenticated)
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Abuse detection signals (hashed for privacy)
  ip_prefix TEXT,      -- /24 IPv4 or /64 IPv6
  ua_hash TEXT,        -- SHA256 of User-Agent
  fp_hash TEXT,        -- FingerprintJS visitorId hash

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: exactly one of user_id or anon_id must be set
  -- subject_id must match the non-null one
  CONSTRAINT usage_counters_subject_check CHECK (
    (user_id IS NOT NULL AND anon_id IS NULL AND subject_id = user_id)
    OR (user_id IS NULL AND anon_id IS NOT NULL AND subject_id = anon_id)
  )
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Unique indexes for lookups by user_id or anon_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_counters_user_id
  ON usage_counters(user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_counters_anon_id
  ON usage_counters(anon_id) WHERE anon_id IS NOT NULL;

-- Abuse detection indexes
CREATE INDEX IF NOT EXISTS idx_usage_counters_ip_prefix
  ON usage_counters(ip_prefix) WHERE ip_prefix IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_counters_ua_hash
  ON usage_counters(ua_hash) WHERE ua_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_counters_fp_hash
  ON usage_counters(fp_hash) WHERE fp_hash IS NOT NULL;

-- For cleanup queries (find stale anonymous sessions)
CREATE INDEX IF NOT EXISTS idx_usage_counters_last_seen_at
  ON usage_counters(last_seen_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Service role (backend) has full access
CREATE POLICY "Service role has full access to usage_counters"
  ON usage_counters
  FOR ALL
  USING (auth.role() = 'service_role');

-- Authenticated users can read their own usage (SELECT only)
-- NOTE: No UPDATE policy - all writes must go through service_role functions
-- to prevent clients from bypassing quotas
CREATE POLICY "Users can read own usage_counters"
  ON usage_counters
  FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================================
-- AUTO-UPDATE TRIGGER
-- ============================================================================

-- Use existing update_updated_at_column() function from schema.sql
CREATE TRIGGER update_usage_counters_updated_at
  BEFORE UPDATE ON usage_counters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ATOMIC INCREMENT FUNCTION (Race-Safe)
-- ============================================================================
-- Uses INSERT ... ON CONFLICT for atomic upsert
-- Handles window reset when window_started_at is older than p_window_seconds

CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_user_id UUID,
  p_anon_id UUID,
  p_model_type TEXT,           -- 'quick' or 'premium'
  p_ip_prefix TEXT,
  p_ua_hash TEXT,
  p_fp_hash TEXT,
  p_window_seconds INTEGER DEFAULT 86400  -- 24 hours for anonymous
)
RETURNS TABLE(new_quick INTEGER, new_premium INTEGER, window_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_id UUID;
BEGIN
  -- Validate p_model_type (must be 'quick' or 'premium')
  IF p_model_type NOT IN ('quick', 'premium') THEN
    RAISE EXCEPTION 'p_model_type must be ''quick'' or ''premium'', got: %', p_model_type;
  END IF;

  -- Reject if BOTH user_id AND anon_id are provided (must be exactly one)
  IF p_user_id IS NOT NULL AND p_anon_id IS NOT NULL THEN
    RAISE EXCEPTION 'Provide either user_id OR anon_id, not both';
  END IF;

  -- Determine subject_id from user_id or anon_id
  v_subject_id := COALESCE(p_user_id, p_anon_id);

  IF v_subject_id IS NULL THEN
    RAISE EXCEPTION 'Either user_id or anon_id is required';
  END IF;

  -- Atomic upsert with conditional window reset
  RETURN QUERY
  INSERT INTO usage_counters (
    subject_id,
    user_id,
    anon_id,
    quick_count,
    premium_count,
    window_started_at,
    last_seen_at,
    ip_prefix,
    ua_hash,
    fp_hash
  )
  VALUES (
    v_subject_id,
    p_user_id,
    p_anon_id,
    CASE WHEN p_model_type = 'quick' THEN 1 ELSE 0 END,
    CASE WHEN p_model_type = 'premium' THEN 1 ELSE 0 END,
    NOW(),
    NOW(),
    p_ip_prefix,
    p_ua_hash,
    p_fp_hash
  )
  ON CONFLICT (subject_id) DO UPDATE
  SET
    -- Reset window if expired, otherwise keep existing
    window_started_at = CASE
      WHEN p_window_seconds IS NOT NULL
        AND usage_counters.window_started_at < NOW() - (p_window_seconds || ' seconds')::interval
      THEN NOW()
      ELSE usage_counters.window_started_at
    END,

    -- Reset or increment quick_count based on window expiry
    quick_count = CASE
      WHEN p_window_seconds IS NOT NULL
        AND usage_counters.window_started_at < NOW() - (p_window_seconds || ' seconds')::interval
      THEN CASE WHEN p_model_type = 'quick' THEN 1 ELSE 0 END
      ELSE usage_counters.quick_count + CASE WHEN p_model_type = 'quick' THEN 1 ELSE 0 END
    END,

    -- Reset or increment premium_count based on window expiry
    premium_count = CASE
      WHEN p_window_seconds IS NOT NULL
        AND usage_counters.window_started_at < NOW() - (p_window_seconds || ' seconds')::interval
      THEN CASE WHEN p_model_type = 'premium' THEN 1 ELSE 0 END
      ELSE usage_counters.premium_count + CASE WHEN p_model_type = 'premium' THEN 1 ELSE 0 END
    END,

    -- Always update last_seen and signals (updated_at handled by trigger)
    last_seen_at = NOW(),
    ip_prefix = COALESCE(p_ip_prefix, usage_counters.ip_prefix),
    ua_hash = COALESCE(p_ua_hash, usage_counters.ua_hash),
    fp_hash = COALESCE(p_fp_hash, usage_counters.fp_hash)
  RETURNING
    usage_counters.quick_count,
    usage_counters.premium_count,
    usage_counters.window_started_at;
END;
$$;

-- Lock down execute permissions - revoke from PUBLIC, grant only to service_role
REVOKE EXECUTE ON FUNCTION increment_usage_counter(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_usage_counter(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO service_role;

-- ============================================================================
-- HELPER FUNCTION: Get Usage (for /api/me endpoint)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_usage_counter(
  p_user_id UUID,
  p_anon_id UUID
)
RETURNS TABLE(
  quick_count INTEGER,
  premium_count INTEGER,
  window_started_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_id UUID;
BEGIN
  v_subject_id := COALESCE(p_user_id, p_anon_id);

  IF v_subject_id IS NULL THEN
    -- Return zeros for new users
    RETURN QUERY SELECT 0, 0, NOW(), NOW();
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    uc.quick_count,
    uc.premium_count,
    uc.window_started_at,
    uc.last_seen_at
  FROM usage_counters uc
  WHERE uc.subject_id = v_subject_id;

  -- If no row found, return zeros
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, NOW(), NOW();
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_usage_counter(UUID, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_usage_counter(UUID, UUID)
  TO service_role;

-- ============================================================================
-- CLEANUP FUNCTION: Remove stale anonymous sessions (optional cron)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_stale_anonymous_usage(
  p_older_than_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM usage_counters
  WHERE anon_id IS NOT NULL
    AND last_seen_at < NOW() - (p_older_than_days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION cleanup_stale_anonymous_usage(INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_stale_anonymous_usage(INTEGER)
  TO service_role;
