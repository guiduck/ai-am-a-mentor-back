-- Migration: Add Subscription System
-- Created: 2024-12-06
-- Description: Tables for subscription plans, user subscriptions, usage tracking, and leads

-- ============================================================================
-- SUBSCRIPTION PLANS
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'creator' or 'student'
  price DECIMAL(10, 2) NOT NULL,
  billing_period VARCHAR(20) DEFAULT 'monthly' NOT NULL,
  stripe_price_id VARCHAR(255),
  features TEXT NOT NULL, -- JSON
  is_active INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- USER SUBSCRIPTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  status VARCHAR(30) DEFAULT 'active' NOT NULL,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- USAGE LIMITS (Monthly tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS usage_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  quizzes_generated INTEGER DEFAULT 0 NOT NULL,
  ai_questions_asked INTEGER DEFAULT 0 NOT NULL,
  videos_uploaded INTEGER DEFAULT 0 NOT NULL,
  courses_created INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- LEADS (Landing page capture)
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  type VARCHAR(20) NOT NULL, -- 'creator' or 'student'
  source VARCHAR(100),
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_usage_limits_user_id ON usage_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_limits_period ON usage_limits(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- ============================================================================
-- SEED DEFAULT PLANS
-- ============================================================================

-- Creator Plans
INSERT INTO subscription_plans (name, display_name, type, price, features) VALUES
('creator_free', 'Gratuito', 'creator', 0, '{"courses": 1, "videos": 10, "quizzes_per_month": 0, "commission_rate": 0.25, "ai_questions_per_day": 0, "support": "community"}'),
('creator_basic', 'Básico', 'creator', 29.00, '{"courses": 5, "videos": 50, "quizzes_per_month": 5, "commission_rate": 0.15, "ai_questions_per_day": 10, "support": "email"}'),
('creator_pro', 'Profissional', 'creator', 69.00, '{"courses": -1, "videos": -1, "quizzes_per_month": -1, "commission_rate": 0.08, "ai_questions_per_day": -1, "support": "priority", "certificates": true}')
ON CONFLICT (name) DO NOTHING;

-- Student Plans
INSERT INTO subscription_plans (name, display_name, type, price, features) VALUES
('student_free', 'Gratuito', 'student', 0, '{"ai_questions_per_day": 5, "courses_access": "purchased"}'),
('student_family', 'Família', 'student', 29.00, '{"ai_questions_per_day": -1, "courses_access": "all", "progress_reports": true}')
ON CONFLICT (name) DO NOTHING;
