-- Migration: Add Quick/Premium Generation Tracking
-- Two-tier generation system: Quick (Gemini Flash) vs Premium (Gemini 3 Pro)
-- Run this in Supabase SQL Editor

-- ============================================================================
-- ADD NEW COLUMNS FOR QUICK/PREMIUM TRACKING
-- ============================================================================

-- Free/anonymous users: 5 quick + 1 premium (separate quotas)
-- Base tier: 50 total generations from shared pool (any model)

-- Quick generation count (for free/anonymous)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS quick_count INTEGER NOT NULL DEFAULT 0;

-- Premium generation count (for free/anonymous)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS premium_count INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- MIGRATE EXISTING DATA
-- ============================================================================

-- Existing monthly_generation_count was using premium model (gemini-3-pro)
-- For base tier users, this stays as their shared pool count
-- For free users, treat existing generations as premium
UPDATE profiles
SET premium_count = generation_count
WHERE tier = 'free' AND generation_count > 0;

-- ============================================================================
-- UPDATE GENERATIONS TABLE TO TRACK MODEL TYPE
-- ============================================================================

-- Add model_type column to generations table
ALTER TABLE generations
ADD COLUMN IF NOT EXISTS model_type TEXT DEFAULT 'premium' CHECK (model_type IN ('quick', 'premium'));

-- Update existing generations to 'premium' (they used gemini-3-pro)
UPDATE generations
SET model_type = 'premium'
WHERE model_type IS NULL;

-- ============================================================================
-- ATOMIC INCREMENT FUNCTIONS
-- ============================================================================

-- Function to increment quick generation count
-- For free/anonymous: uses quick_count (capped at 5)
-- For base: uses monthly_generation_count (shared pool)
CREATE OR REPLACE FUNCTION increment_quick_generation(
  target_user_id UUID,
  user_tier TEXT
)
RETURNS TABLE(new_count INTEGER, can_generate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_quick INTEGER;
  current_monthly INTEGER;
BEGIN
  IF user_tier IN ('base', 'paid') THEN
    -- Base tier: shared pool, use monthly_generation_count
    UPDATE profiles
    SET
      monthly_generation_count = monthly_generation_count + 1,
      generation_count = generation_count + 1,
      updated_at = NOW()
    WHERE id = target_user_id
    RETURNING monthly_generation_count INTO current_monthly;

    RETURN QUERY SELECT current_monthly, (current_monthly <= 50);
  ELSE
    -- Free tier: separate quick quota
    UPDATE profiles
    SET
      quick_count = quick_count + 1,
      generation_count = generation_count + 1,
      updated_at = NOW()
    WHERE id = target_user_id
    RETURNING quick_count INTO current_quick;

    RETURN QUERY SELECT current_quick, (current_quick <= 5);
  END IF;
END;
$$;

-- Function to increment premium generation count
-- For free/anonymous: uses premium_count (capped at 1)
-- For base: uses monthly_generation_count (shared pool)
CREATE OR REPLACE FUNCTION increment_premium_generation(
  target_user_id UUID,
  user_tier TEXT
)
RETURNS TABLE(new_count INTEGER, can_generate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_premium INTEGER;
  current_monthly INTEGER;
BEGIN
  IF user_tier IN ('base', 'paid') THEN
    -- Base tier: shared pool, use monthly_generation_count
    UPDATE profiles
    SET
      monthly_generation_count = monthly_generation_count + 1,
      generation_count = generation_count + 1,
      updated_at = NOW()
    WHERE id = target_user_id
    RETURNING monthly_generation_count INTO current_monthly;

    RETURN QUERY SELECT current_monthly, (current_monthly <= 50);
  ELSE
    -- Free tier: separate premium quota (1 allowed)
    UPDATE profiles
    SET
      premium_count = premium_count + 1,
      generation_count = generation_count + 1,
      updated_at = NOW()
    WHERE id = target_user_id
    RETURNING premium_count INTO current_premium;

    RETURN QUERY SELECT current_premium, (current_premium <= 1);
  END IF;
END;
$$;

-- Function to use credits for generation
-- 1 credit = quick, 2 credits = premium
CREATE OR REPLACE FUNCTION use_credits_for_generation(
  target_user_id UUID,
  model_type TEXT
)
RETURNS TABLE(new_balance INTEGER, success BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  credit_cost INTEGER;
  current_balance INTEGER;
BEGIN
  -- Determine credit cost
  IF model_type = 'quick' THEN
    credit_cost := 1;
  ELSE
    credit_cost := 2;
  END IF;

  -- Get current balance
  SELECT credit_balance INTO current_balance
  FROM profiles
  WHERE id = target_user_id;

  -- Check if user has enough credits
  IF current_balance < credit_cost THEN
    RETURN QUERY SELECT current_balance, FALSE;
    RETURN;
  END IF;

  -- Deduct credits and increment generation count
  UPDATE profiles
  SET
    credit_balance = credit_balance - credit_cost,
    generation_count = generation_count + 1,
    updated_at = NOW()
  WHERE id = target_user_id
  RETURNING credit_balance INTO current_balance;

  RETURN QUERY SELECT current_balance, TRUE;
END;
$$;

-- ============================================================================
-- RESET FUNCTION FOR MONTHLY COUNTS (BASE TIER)
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_monthly_counts(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET
    monthly_generation_count = 0,
    monthly_reset_at = NOW() + INTERVAL '1 month',
    updated_at = NOW()
  WHERE id = target_user_id;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION increment_quick_generation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_premium_generation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION use_credits_for_generation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_monthly_counts(UUID) TO authenticated;
