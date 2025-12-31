-- Migration: Add atomic increment_credits RPC function
-- This prevents race conditions when adding credits from webhooks or session verification

-- Atomic increment credits function
-- Uses UPDATE ... SET credit_balance = credit_balance + N for atomicity
CREATE OR REPLACE FUNCTION increment_credits(
  p_user_id UUID,
  p_credits_to_add INTEGER,
  p_customer_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  -- Atomic update - no read-modify-write race condition
  UPDATE profiles
  SET
    credit_balance = credit_balance + p_credits_to_add,
    stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id),
    updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credit_balance INTO new_balance;

  -- Return new balance (or NULL if user not found)
  RETURN new_balance;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION increment_credits TO service_role;

COMMENT ON FUNCTION increment_credits IS 'Atomically increment user credit balance. Returns new balance or NULL if user not found.';
