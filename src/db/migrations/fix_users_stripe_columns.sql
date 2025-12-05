-- Migration: Fix Users Stripe Columns
-- Created: 2024-12-06
-- Description: Add Stripe Connect columns to users table (if missing)

-- Add Stripe Connect columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboarding_complete INTEGER DEFAULT 0;

-- Confirm columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('stripe_account_id', 'stripe_onboarding_complete');

