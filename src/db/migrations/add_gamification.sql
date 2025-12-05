-- Migration: Add Gamification System
-- Created: 2024-12-06
-- Description: Tables for XP, levels, badges, streaks

-- ============================================================================
-- USER PROGRESS (XP, Levels, Streaks)
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

-- ============================================================================
-- BADGES
-- ============================================================================
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

-- ============================================================================
-- USER BADGES (Badges earned by users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- XP TRANSACTIONS (History of XP gains)
-- ============================================================================
CREATE TABLE IF NOT EXISTS xp_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  source VARCHAR(50) NOT NULL,
  source_id UUID,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_level ON user_progress(level);
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_id ON xp_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_created_at ON xp_transactions(created_at);

-- ============================================================================
-- SEED DEFAULT BADGES
-- ============================================================================
INSERT INTO badges (name, display_name, description, icon, category, requirement, xp_reward) VALUES
-- Achievement badges
('first_lesson', 'Primeira Aula', 'Completou sua primeira aula', '📚', 'achievement', '{"type": "lessons", "value": 1}', 50),
('lesson_master_10', 'Estudante Dedicado', 'Completou 10 aulas', '🎓', 'achievement', '{"type": "lessons", "value": 10}', 200),
('lesson_master_50', 'Mestre do Conhecimento', 'Completou 50 aulas', '👨‍🎓', 'achievement', '{"type": "lessons", "value": 50}', 500),
('lesson_master_100', 'Lenda do Aprendizado', 'Completou 100 aulas', '🏆', 'achievement', '{"type": "lessons", "value": 100}', 1000),

-- Quiz badges
('quiz_ace', 'Primeiro Quiz', 'Passou no primeiro quiz', '✅', 'achievement', '{"type": "quizzes", "value": 1}', 100),
('quiz_master_10', 'Craque dos Quizzes', 'Passou em 10 quizzes', '🧠', 'achievement', '{"type": "quizzes", "value": 10}', 300),
('perfect_score', 'Nota Máxima', 'Tirou 100% em um quiz', '💯', 'achievement', '{"type": "perfect_quiz", "value": 1}', 200),

-- Streak badges
('streak_3', 'Em Chamas!', '3 dias seguidos de estudo', '🔥', 'streak', '{"type": "streak", "value": 3}', 100),
('streak_7', 'Semana Perfeita', '7 dias seguidos de estudo', '⚡', 'streak', '{"type": "streak", "value": 7}', 250),
('streak_30', 'Mês Dedicado', '30 dias seguidos de estudo', '🌟', 'streak', '{"type": "streak", "value": 30}', 1000),

-- XP badges
('xp_100', 'Primeiros Passos', 'Acumulou 100 XP', '🌱', 'achievement', '{"type": "xp", "value": 100}', 0),
('xp_500', 'Crescendo', 'Acumulou 500 XP', '🌿', 'achievement', '{"type": "xp", "value": 500}', 0),
('xp_1000', 'Experiente', 'Acumulou 1000 XP', '🌳', 'achievement', '{"type": "xp", "value": 1000}', 0),
('xp_5000', 'Veterano', 'Acumulou 5000 XP', '🏅', 'achievement', '{"type": "xp", "value": 5000}', 0),

-- Course badges
('first_course', 'Primeiro Curso', 'Completou seu primeiro curso', '🎉', 'course', '{"type": "courses", "value": 1}', 500),
('course_collector_5', 'Colecionador', 'Completou 5 cursos', '📕', 'course', '{"type": "courses", "value": 5}', 1000)

ON CONFLICT (name) DO NOTHING;

