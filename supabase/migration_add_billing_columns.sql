-- Migration: Add billing and usage tracking columns
-- Run this in Supabase SQL Editor

-- Add new columns for monthly usage tracking and credits
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS monthly_generation_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_reset_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- Update tier constraint to allow 'base' tier (and keep backward compat with 'paid')
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_tier_check
  CHECK (tier IN ('free', 'base', 'paid'));

-- Index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_id
  ON profiles(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;
