-- Pimp My Epstein Database Schema
-- Run this in Supabase SQL Editor

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  generation_count INTEGER NOT NULL DEFAULT 0,
  monthly_generation_count INTEGER NOT NULL DEFAULT 0,
  monthly_reset_at TIMESTAMPTZ,
  credit_balance INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'base', 'paid')),
  subscription_status TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups by stripe_customer_id
CREATE INDEX idx_profiles_stripe_customer_id ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ============================================================================
-- GENERATIONS TABLE
-- ============================================================================
CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  epstein_photo TEXT NOT NULL,
  result_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups by user
CREATE INDEX idx_generations_user_id ON generations(user_id) WHERE user_id IS NOT NULL;

-- Index for status-based queries
CREATE INDEX idx_generations_status ON generations(status);

-- ============================================================================
-- USAGE COUNTERS TABLE (ANONYMOUS/PER-SESSION)
-- ============================================================================
CREATE TABLE usage_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  anon_id TEXT,
  quick_count INTEGER NOT NULL DEFAULT 0,
  premium_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_prefix TEXT,
  ua_hash TEXT,
  fp_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_usage_counters_anon_id ON usage_counters(anon_id) WHERE anon_id IS NOT NULL;
CREATE INDEX idx_usage_counters_user_id ON usage_counters(user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on both tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can do anything (for backend operations)
CREATE POLICY "Service role has full access to profiles"
  ON profiles
  FOR ALL
  USING (auth.role() = 'service_role');

-- GENERATIONS POLICIES

-- Users can view their own generations
CREATE POLICY "Users can view own generations"
  ON generations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own generations
CREATE POLICY "Users can insert own generations"
  ON generations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Service role can do anything (for backend operations)
CREATE POLICY "Service role has full access to generations"
  ON generations
  FOR ALL
  USING (auth.role() = 'service_role');

-- USAGE COUNTERS POLICIES
CREATE POLICY "Service role has full access to usage_counters"
  ON usage_counters
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================================================

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

-- Trigger to call the function on new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- FUNCTION TO INCREMENT GENERATION COUNT
-- ============================================================================

-- Function to increment a user's generation count
CREATE OR REPLACE FUNCTION increment_generation_count(target_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE profiles
  SET
    generation_count = generation_count + 1,
    updated_at = NOW()
  WHERE id = target_user_id
  RETURNING generation_count INTO new_count;

  RETURN new_count;
END;
$$;

-- ============================================================================
-- FUNCTIONS FOR USAGE COUNTERS
-- ============================================================================

-- Get usage counters for a user or anon_id
CREATE OR REPLACE FUNCTION get_usage_counter(p_user_id UUID, p_anon_id TEXT)
RETURNS TABLE (quick_count INTEGER, premium_count INTEGER, window_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT uc.quick_count, uc.premium_count, uc.window_started_at
  FROM usage_counters uc
  WHERE (p_user_id IS NOT NULL AND uc.user_id = p_user_id)
     OR (p_user_id IS NULL AND p_anon_id IS NOT NULL AND uc.anon_id = p_anon_id)
  LIMIT 1;
END;
$$;

-- Increment usage counters with rolling window
CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_user_id UUID,
  p_anon_id TEXT,
  p_model_type TEXT,
  p_ip_prefix TEXT,
  p_ua_hash TEXT,
  p_fp_hash TEXT,
  p_window_seconds INTEGER
)
RETURNS TABLE (new_quick INTEGER, new_premium INTEGER, window_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_window TIMESTAMPTZ;
  quick_val INTEGER;
  premium_val INTEGER;
BEGIN
  SELECT window_started_at, quick_count, premium_count
  INTO current_window, quick_val, premium_val
  FROM usage_counters
  WHERE (p_user_id IS NOT NULL AND user_id = p_user_id)
     OR (p_user_id IS NULL AND p_anon_id IS NOT NULL AND anon_id = p_anon_id)
  LIMIT 1;

  IF current_window IS NULL THEN
    current_window := NOW();
    quick_val := 0;
    premium_val := 0;

    INSERT INTO usage_counters (user_id, anon_id, quick_count, premium_count, window_started_at, updated_at, ip_prefix, ua_hash, fp_hash)
    VALUES (p_user_id, p_anon_id, 0, 0, current_window, NOW(), p_ip_prefix, p_ua_hash, p_fp_hash);
  END IF;

  IF p_window_seconds IS NOT NULL AND NOW() - current_window > (p_window_seconds || ' seconds')::interval THEN
    current_window := NOW();
    quick_val := 0;
    premium_val := 0;
  END IF;

  IF p_model_type = 'quick' THEN
    quick_val := quick_val + 1;
  ELSE
    premium_val := premium_val + 1;
  END IF;

  UPDATE usage_counters
  SET quick_count = quick_val,
      premium_count = premium_val,
      window_started_at = current_window,
      updated_at = NOW(),
      ip_prefix = COALESCE(p_ip_prefix, ip_prefix),
      ua_hash = COALESCE(p_ua_hash, ua_hash),
      fp_hash = COALESCE(p_fp_hash, fp_hash)
  WHERE (p_user_id IS NOT NULL AND user_id = p_user_id)
     OR (p_user_id IS NULL AND p_anon_id IS NOT NULL AND anon_id = p_anon_id);

  RETURN QUERY SELECT quick_val, premium_val, current_window;
END;
$$;

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Trigger for profiles table
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
