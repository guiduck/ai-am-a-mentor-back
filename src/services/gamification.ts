/**
 * Gamification Service
 * Manages XP, levels, badges, and streaks
 */

import { db } from "../db";
import {
  userProgress,
  badges,
  userBadges,
  xpTransactions,
} from "../db/schema";
import { eq, gte, and, desc, sql } from "drizzle-orm";

// XP rewards for different actions
export const XP_REWARDS = {
  LESSON_COMPLETE: 25,
  QUIZ_PASS: 50,
  QUIZ_PERFECT: 100,
  COURSE_COMPLETE: 200,
  DAILY_STREAK: 10,
  FIRST_LOGIN_TODAY: 5,
};

// Level thresholds (XP required for each level)
const LEVEL_THRESHOLDS = [
  0,      // Level 1
  100,    // Level 2
  250,    // Level 3
  500,    // Level 4
  1000,   // Level 5
  1750,   // Level 6
  2750,   // Level 7
  4000,   // Level 8
  5500,   // Level 9
  7500,   // Level 10
  10000,  // Level 11
  13000,  // Level 12
  16500,  // Level 13
  20500,  // Level 14
  25000,  // Level 15
  30000,  // Level 16
  36000,  // Level 17
  43000,  // Level 18
  51000,  // Level 19
  60000,  // Level 20
];

export interface UserProgressData {
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lessonsCompleted: number;
  quizzesPassed: number;
  coursesCompleted: number;
  xpToNextLevel: number;
  xpProgress: number; // Percentage to next level
}

export interface Badge {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  icon: string;
  category: string;
  earnedAt?: Date;
}

/**
 * Get or create user progress
 */
export async function getUserProgress(userId: string): Promise<UserProgressData> {
  let progress = await db.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
  });

  if (!progress) {
    // Create initial progress
    [progress] = await db
      .insert(userProgress)
      .values({ userId })
      .returning();
  }

  const nextLevelXp = getXpForLevel(progress.level + 1);
  const currentLevelXp = getXpForLevel(progress.level);
  const xpInCurrentLevel = progress.totalXp - currentLevelXp;
  const xpNeededForLevel = nextLevelXp - currentLevelXp;

  return {
    totalXp: progress.totalXp,
    level: progress.level,
    currentStreak: progress.currentStreak,
    longestStreak: progress.longestStreak,
    lessonsCompleted: progress.lessonsCompleted,
    quizzesPassed: progress.quizzesPassed,
    coursesCompleted: progress.coursesCompleted,
    xpToNextLevel: nextLevelXp - progress.totalXp,
    xpProgress: Math.min(100, (xpInCurrentLevel / xpNeededForLevel) * 100),
  };
}

/**
 * Add XP to user and check for level up
 */
export async function addXp(
  userId: string,
  amount: number,
  source: "lesson" | "quiz" | "streak" | "badge" | "course" | "bonus",
  sourceId?: string,
  description?: string
): Promise<{ newXp: number; leveledUp: boolean; newLevel?: number; newBadges: Badge[] }> {
  // Get current progress
  let progress = await db.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
  });

  if (!progress) {
    [progress] = await db
      .insert(userProgress)
      .values({ userId })
      .returning();
  }

  const oldLevel = progress.level;
  const newTotalXp = progress.totalXp + amount;
  const newLevel = calculateLevel(newTotalXp);
  const leveledUp = newLevel > oldLevel;

  // Update progress
  await db
    .update(userProgress)
    .set({
      totalXp: newTotalXp,
      level: newLevel,
      updatedAt: new Date(),
    })
    .where(eq(userProgress.userId, userId));

  // Record XP transaction
  await db.insert(xpTransactions).values({
    userId,
    amount,
    source,
    sourceId,
    description,
  });

  // Check for new badges
  const newBadges = await checkAndAwardBadges(userId, newTotalXp, progress);

  return {
    newXp: newTotalXp,
    leveledUp,
    newLevel: leveledUp ? newLevel : undefined,
    newBadges,
  };
}

/**
 * Record lesson completion
 */
export async function recordLessonComplete(
  userId: string,
  videoId: string
): Promise<{ xpGained: number; newBadges: Badge[] }> {
  // Update lessons completed
  await db
    .update(userProgress)
    .set({
      lessonsCompleted: sql`${userProgress.lessonsCompleted} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(userProgress.userId, userId));

  // Update streak
  await updateStreak(userId);

  // Add XP
  const result = await addXp(
    userId,
    XP_REWARDS.LESSON_COMPLETE,
    "lesson",
    videoId,
    "Aula completada"
  );

  return {
    xpGained: XP_REWARDS.LESSON_COMPLETE,
    newBadges: result.newBadges,
  };
}

/**
 * Record quiz completion
 */
export async function recordQuizComplete(
  userId: string,
  quizId: string,
  score: number,
  passed: boolean
): Promise<{ xpGained: number; newBadges: Badge[] }> {
  if (!passed) {
    return { xpGained: 0, newBadges: [] };
  }

  // Update quizzes passed
  await db
    .update(userProgress)
    .set({
      quizzesPassed: sql`${userProgress.quizzesPassed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(userProgress.userId, userId));

  // Calculate XP based on score
  const isPerfect = score === 100;
  const xpAmount = isPerfect
    ? XP_REWARDS.QUIZ_PERFECT
    : XP_REWARDS.QUIZ_PASS;

  // Add XP
  const result = await addXp(
    userId,
    xpAmount,
    "quiz",
    quizId,
    isPerfect ? "Quiz perfeito!" : "Quiz aprovado"
  );

  return {
    xpGained: xpAmount,
    newBadges: result.newBadges,
  };
}

/**
 * Record course completion
 */
export async function recordCourseComplete(
  userId: string,
  courseId: string
): Promise<{ xpGained: number; newBadges: Badge[] }> {
  // Update courses completed
  await db
    .update(userProgress)
    .set({
      coursesCompleted: sql`${userProgress.coursesCompleted} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(userProgress.userId, userId));

  // Add XP
  const result = await addXp(
    userId,
    XP_REWARDS.COURSE_COMPLETE,
    "course",
    courseId,
    "Curso completado"
  );

  return {
    xpGained: XP_REWARDS.COURSE_COMPLETE,
    newBadges: result.newBadges,
  };
}

/**
 * Update user's streak
 */
async function updateStreak(userId: string): Promise<void> {
  const progress = await db.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
  });

  if (!progress) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastActivity = progress.lastActivityDate
    ? new Date(progress.lastActivityDate)
    : null;

  if (lastActivity) {
    lastActivity.setHours(0, 0, 0, 0);
  }

  let newStreak = progress.currentStreak;
  let newLongestStreak = progress.longestStreak;

  if (!lastActivity || lastActivity < today) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (lastActivity && lastActivity.getTime() === yesterday.getTime()) {
      // Continued streak
      newStreak = progress.currentStreak + 1;
    } else if (!lastActivity || lastActivity < yesterday) {
      // Streak broken, start new
      newStreak = 1;
    }

    if (newStreak > newLongestStreak) {
      newLongestStreak = newStreak;
    }

    await db
      .update(userProgress)
      .set({
        currentStreak: newStreak,
        longestStreak: newLongestStreak,
        lastActivityDate: today,
        updatedAt: new Date(),
      })
      .where(eq(userProgress.userId, userId));

    // Award streak XP
    if (newStreak > 1) {
      await addXp(
        userId,
        XP_REWARDS.DAILY_STREAK,
        "streak",
        undefined,
        `Streak de ${newStreak} dias!`
      );
    }
  }
}

/**
 * Get user's badges
 */
export async function getUserBadges(userId: string): Promise<Badge[]> {
  const earnedBadges = await db.query.userBadges.findMany({
    where: eq(userBadges.userId, userId),
    with: {
      badge: true,
    },
    orderBy: [desc(userBadges.earnedAt)],
  });

  return earnedBadges.map((ub) => ({
    id: ub.badge.id,
    name: ub.badge.name,
    displayName: ub.badge.displayName,
    description: ub.badge.description,
    icon: ub.badge.icon,
    category: ub.badge.category,
    earnedAt: ub.earnedAt || undefined,
  }));
}

/**
 * Get all available badges
 */
export async function getAllBadges(): Promise<Badge[]> {
  const allBadges = await db.query.badges.findMany({
    where: eq(badges.isActive, 1),
  });

  return allBadges.map((b) => ({
    id: b.id,
    name: b.name,
    displayName: b.displayName,
    description: b.description,
    icon: b.icon,
    category: b.category,
  }));
}

/**
 * Check and award badges based on progress
 */
async function checkAndAwardBadges(
  userId: string,
  totalXp: number,
  progress: any
): Promise<Badge[]> {
  const newBadges: Badge[] = [];

  // Get all badges user doesn't have yet
  const userBadgesList = await db.query.userBadges.findMany({
    where: eq(userBadges.userId, userId),
  });

  const earnedBadgeIds = new Set(userBadgesList.map((ub) => ub.badgeId));

  const allBadges = await db.query.badges.findMany({
    where: eq(badges.isActive, 1),
  });

  for (const badge of allBadges) {
    if (earnedBadgeIds.has(badge.id)) continue;

    const requirement = badge.requirement
      ? JSON.parse(badge.requirement)
      : null;

    if (!requirement) continue;

    let earned = false;

    switch (requirement.type) {
      case "xp":
        earned = totalXp >= requirement.value;
        break;
      case "lessons":
        earned = progress.lessonsCompleted >= requirement.value;
        break;
      case "quizzes":
        earned = progress.quizzesPassed >= requirement.value;
        break;
      case "courses":
        earned = progress.coursesCompleted >= requirement.value;
        break;
      case "streak":
        earned = progress.currentStreak >= requirement.value;
        break;
    }

    if (earned) {
      // Award badge
      await db.insert(userBadges).values({
        userId,
        badgeId: badge.id,
      });

      // Award badge XP if any
      if (badge.xpReward > 0) {
        await addXp(
          userId,
          badge.xpReward,
          "badge",
          badge.id,
          `Badge: ${badge.displayName}`
        );
      }

      newBadges.push({
        id: badge.id,
        name: badge.name,
        displayName: badge.displayName,
        description: badge.description,
        icon: badge.icon,
        category: badge.category,
      });
    }
  }

  return newBadges;
}

/**
 * Get XP required for a specific level
 */
function getXpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > LEVEL_THRESHOLDS.length) {
    // For levels beyond defined, use formula
    const lastThreshold = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const extraLevels = level - LEVEL_THRESHOLDS.length;
    return lastThreshold + extraLevels * 10000;
  }
  return LEVEL_THRESHOLDS[level - 1];
}

/**
 * Calculate level from total XP
 */
function calculateLevel(totalXp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Get leaderboard (top users by XP)
 */
export async function getLeaderboard(limit: number = 10): Promise<
  Array<{
    rank: number;
    userId: string;
    username: string;
    totalXp: number;
    level: number;
  }>
> {
  const topUsers = await db.query.userProgress.findMany({
    orderBy: [desc(userProgress.totalXp)],
    limit,
    with: {
      user: true,
    },
  });

  return topUsers.map((up, index) => ({
    rank: index + 1,
    userId: up.userId,
    username: (up as any).user?.username || "Unknown",
    totalXp: up.totalXp,
    level: up.level,
  }));
}
