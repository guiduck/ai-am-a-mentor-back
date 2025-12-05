-- Add Stripe Connect fields to users table for creator payouts
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboarding_complete INTEGER DEFAULT 0;
