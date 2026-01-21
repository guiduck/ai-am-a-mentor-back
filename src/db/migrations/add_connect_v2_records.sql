-- ============================================================================
-- STRIPE CONNECT V2 - PURCHASES, SUBSCRIPTIONS, REQUIREMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS connected_account_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_account_id VARCHAR(255) NOT NULL,
  stripe_checkout_session_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_payment_intent_id VARCHAR(255),
  product_id VARCHAR(255),
  price_id VARCHAR(255),
  amount_in_cents INTEGER,
  currency VARCHAR(10),
  customer_email VARCHAR(255),
  status VARCHAR(50) NOT NULL,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connected_account_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  stripe_account_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
  price_id VARCHAR(255),
  quantity INTEGER,
  status VARCHAR(50) NOT NULL,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_account_requirements_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_account_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  requirements_status VARCHAR(50),
  capabilities TEXT,
  payload TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connected_account_purchases_account
  ON connected_account_purchases(stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_connected_account_subscriptions_account
  ON connected_account_subscriptions(stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_stripe_account_requirements_updates_account
  ON stripe_account_requirements_updates(stripe_account_id);
