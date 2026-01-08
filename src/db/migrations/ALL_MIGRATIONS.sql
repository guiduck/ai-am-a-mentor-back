-- ============================================================================
-- ALL PENDING MIGRATIONS - Execute this in production database
-- ============================================================================
-- Run this entire file in your PostgreSQL production database

-- ============================================================================
-- 1. FIX USERS TABLE (Add Stripe columns)
-- ============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboarding_complete INTEGER DEFAULT 0;

-- ============================================================================
-- 2. SUBSCRIPTION SYSTEM
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  billing_period VARCHAR(20) DEFAULT 'monthly' NOT NULL,
  stripe_price_id VARCHAR(255),
  features TEXT NOT NULL,
  is_active INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  type VARCHAR(20) NOT NULL,
  source VARCHAR(100),
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_usage_limits_user_id ON usage_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- Seed subscription plans
INSERT INTO subscription_plans (name, display_name, type, price, features) VALUES
('creator_free', 'Gratuito', 'creator', 0, '{"courses": 1, "videos": 10, "quizzes_per_month": 0, "commission_rate": 0.25, "ai_questions_per_day": 0, "support": "community"}'),
('creator_basic', 'Básico', 'creator', 29.00, '{"courses": 5, "videos": 50, "quizzes_per_month": 5, "commission_rate": 0.15, "ai_questions_per_day": 10, "support": "email"}'),
('creator_pro', 'Profissional', 'creator', 69.00, '{"courses": -1, "videos": -1, "quizzes_per_month": -1, "commission_rate": 0.08, "ai_questions_per_day": -1, "support": "priority", "certificates": true}'),
('student_free', 'Gratuito', 'student', 0, '{"ai_questions_per_day": 5, "courses_access": "purchased"}'),
('student_family', 'Família', 'student', 29.00, '{"ai_questions_per_day": -1, "courses_access": "all", "progress_reports": true}')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 3. GAMIFICATION SYSTEM
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER DEFAULT 0 NOT NULL,
  level INTEGER DEFAULT 1 NOT NULL,
  current_streak INTEGER DEFAULT 0 NOT NULL,
  longest_streak INTEGER DEFAULT 0 NOT NULL,
  last_activity_date TIMESTAMP,
  lessons_completed INTEGER DEFAULT 0 NOT NULL,
  quizzes_passed INTEGER DEFAULT 0 NOT NULL,
  courses_completed INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  requirement TEXT,
  xp_reward INTEGER DEFAULT 0 NOT NULL,
  is_active INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xp_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  source VARCHAR(50) NOT NULL,
  source_id UUID,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for gamification
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_id ON xp_transactions(user_id);

-- Seed badges
INSERT INTO badges (name, display_name, description, icon, category, requirement, xp_reward) VALUES
('first_lesson', 'Primeira Aula', 'Completou sua primeira aula', '📚', 'achievement', '{"type": "lessons", "value": 1}', 50),
('lesson_master_10', 'Estudante Dedicado', 'Completou 10 aulas', '🎓', 'achievement', '{"type": "lessons", "value": 10}', 200),
('lesson_master_50', 'Mestre do Conhecimento', 'Completou 50 aulas', '👨‍🎓', 'achievement', '{"type": "lessons", "value": 50}', 500),
('quiz_ace', 'Primeiro Quiz', 'Passou no primeiro quiz', '✅', 'achievement', '{"type": "quizzes", "value": 1}', 100),
('quiz_master_10', 'Craque dos Quizzes', 'Passou em 10 quizzes', '🧠', 'achievement', '{"type": "quizzes", "value": 10}', 300),
('streak_3', 'Em Chamas!', '3 dias seguidos de estudo', '🔥', 'streak', '{"type": "streak", "value": 3}', 100),
('streak_7', 'Semana Perfeita', '7 dias seguidos de estudo', '⚡', 'streak', '{"type": "streak", "value": 7}', 250),
('first_course', 'Primeiro Curso', 'Completou seu primeiro curso', '🎉', 'course', '{"type": "courses", "value": 1}', 500)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 4. QUIZ SYSTEM
-- ============================================================================
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  passing_score INTEGER NOT NULL DEFAULT 70,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_type VARCHAR(50) NOT NULL DEFAULT 'multiple_choice',
  options TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  explanation TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL,
  completed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quizzes_video_id ON quizzes(video_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_id ON quiz_attempts(student_id);

-- ============================================================================
-- DONE! Verify tables were created:
-- ============================================================================
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'subscription_plans',
  'user_subscriptions',
  'usage_limits',
  'leads',
  'user_progress',
  'badges',
  'user_badges',
  'xp_transactions',
  'quizzes',
  'quiz_questions',
  'quiz_attempts'
);

