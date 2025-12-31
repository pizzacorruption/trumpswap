-- Migration: Add processed_sessions table to prevent checkout session replay attacks
-- This prevents attackers from reusing a checkout session_id to claim credits multiple times

-- Create table to track processed checkout sessions
CREATE TABLE IF NOT EXISTS processed_sessions (
  session_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL, -- 'subscription', 'credit', 'watermark_removal'
  credits_added INTEGER DEFAULT 0,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_processed_sessions_user_id ON processed_sessions(user_id);

-- Index for cleanup of old sessions (optional maintenance)
CREATE INDEX IF NOT EXISTS idx_processed_sessions_processed_at ON processed_sessions(processed_at);

-- RPC function to atomically check and mark session as processed
-- Returns true if session was newly processed, false if already exists
CREATE OR REPLACE FUNCTION mark_session_processed(
  p_session_id TEXT,
  p_user_id UUID,
  p_session_type TEXT,
  p_credits_added INTEGER DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted BOOLEAN;
BEGIN
  -- Try to insert - if it already exists, this will fail due to PRIMARY KEY
  INSERT INTO processed_sessions (session_id, user_id, session_type, credits_added)
  VALUES (p_session_id, p_user_id, p_session_type, p_credits_added)
  ON CONFLICT (session_id) DO NOTHING;

  -- Check if we actually inserted (GET DIAGNOSTICS doesn't work for ON CONFLICT)
  GET DIAGNOSTICS inserted = ROW_COUNT;

  RETURN inserted > 0;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION mark_session_processed TO service_role;

COMMENT ON TABLE processed_sessions IS 'Tracks processed Stripe checkout sessions to prevent replay attacks';
COMMENT ON FUNCTION mark_session_processed IS 'Atomically marks a session as processed, returns false if already processed';
