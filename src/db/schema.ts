import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  decimal,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: varchar("username", { length: 255 }).unique().notNull(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull(),
  // Stripe Connect fields (for creators to receive payments)
  stripeAccountId: varchar("stripe_account_id", { length: 255 }),
  stripeOnboardingComplete: integer("stripe_onboarding_complete").default(0), // 0 = false, 1 = true
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const courses = pgTable("courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Preço em reais (pagamento direto)
  creditCost: integer("credit_cost"), // Custo em créditos (opcional, se null, curso não pode ser comprado com créditos)
  tags: text("tags"), // JSON array of strings stored as text
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const videos = pgTable("videos", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  r2Key: varchar("s3_key", { length: 255 }).notNull(),
  transcriptR2Key: varchar("transcript_s3_key", { length: 255 }),
  duration: integer("duration"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  videoId: uuid("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const enrollments = pgTable("enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  enrolledAt: timestamp("enrolled_at").defaultNow(),
});

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  videoId: uuid("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Credits - Saldo de créditos por usuário
export const userCredits = pgTable("user_credits", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").default(0).notNull(), // Saldo atual em créditos
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Transactions - Histórico de todas as transações de créditos
export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(), // 'purchase', 'usage', 'refund', 'bonus'
  amount: integer("amount").notNull(), // Quantidade de créditos (positivo ou negativo)
  description: text("description"), // Descrição da transação
  relatedId: uuid("related_id"), // ID relacionado (paymentId, courseId, videoId, etc)
  relatedType: varchar("related_type", { length: 50 }), // 'payment', 'course', 'video', 'ai_chat'
  createdAt: timestamp("created_at").defaultNow(),
});

// Payments - Pagamentos via Stripe
export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", {
    length: 255,
  }).unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // Valor em reais
  currency: varchar("currency", { length: 10 }).default("brl").notNull(),
  status: varchar("status", { length: 50 }).notNull(), // 'pending', 'succeeded', 'failed', 'canceled'
  creditsAwarded: integer("credits_awarded"), // Créditos concedidos neste pagamento
  paymentType: varchar("payment_type", { length: 50 }).notNull(), // 'credits', 'course', 'direct'
  courseId: uuid("course_id").references(() => courses.id, {
    onDelete: "set null",
  }), // Se for compra de curso
  metadata: text("metadata"), // JSON com dados adicionais
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Course Purchases - Compras de cursos (com créditos ou pagamento direto)
export const coursePurchases = pgTable("course_purchases", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull(), // 'credits', 'stripe', 'direct'
  amount: decimal("amount", { precision: 10, scale: 2 }), // Valor pago (se aplicável)
  creditsUsed: integer("credits_used"), // Créditos usados (se aplicável)
  paymentId: uuid("payment_id").references(() => payments.id, {
    onDelete: "set null",
  }),
  transactionId: uuid("transaction_id").references(() => transactions.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// QUIZ SYSTEM
// ============================================================================

// Quizzes - Quiz associado a um vídeo
export const quizzes = pgTable("quizzes", {
  id: uuid("id").defaultRandom().primaryKey(),
  videoId: uuid("video_id")
    .notNull()
    .unique() // Um quiz por vídeo
    .references(() => videos.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  passingScore: integer("passing_score").default(70).notNull(), // Porcentagem mínima para passar
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Quiz Questions - Perguntas do quiz
export const quizQuestions = pgTable("quiz_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  quizId: uuid("quiz_id")
    .notNull()
    .references(() => quizzes.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  questionType: varchar("question_type", { length: 50 }).default("multiple_choice").notNull(),
  options: text("options").notNull(), // JSON array of options
  correctAnswer: text("correct_answer").notNull(), // Index or value of correct answer
  explanation: text("explanation"), // Explicação da resposta correta
  order: integer("order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Quiz Attempts - Tentativas de alunos
export const quizAttempts = pgTable("quiz_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  quizId: uuid("quiz_id")
    .notNull()
    .references(() => quizzes.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  score: integer("score").notNull(), // Pontuação (0-100)
  passed: integer("passed").default(0).notNull(), // 0 = false, 1 = true
  answers: text("answers").notNull(), // JSON with student's answers
  completedAt: timestamp("completed_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  createdCourses: many(courses),
  enrollments: many(enrollments),
  credits: one(userCredits),
  transactions: many(transactions),
  payments: many(payments),
  coursePurchases: many(coursePurchases),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  creator: one(users, {
    fields: [courses.creatorId],
    references: [users.id],
  }),
  videos: many(videos),
  enrollments: many(enrollments),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  course: one(courses, {
    fields: [videos.courseId],
    references: [courses.id],
  }),
  transcripts: many(transcripts),
  comments: many(comments),
  quiz: one(quizzes),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  video: one(videos, {
    fields: [transcripts.videoId],
    references: [videos.id],
  }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(users, {
    fields: [enrollments.studentId],
    references: [users.id],
  }),
  course: one(courses, {
    fields: [enrollments.courseId],
    references: [courses.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  video: one(videos, {
    fields: [comments.videoId],
    references: [videos.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
}));

export const userCreditsRelations = relations(userCredits, ({ one }) => ({
  user: one(users, {
    fields: [userCredits.userId],
    references: [users.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, {
    fields: [payments.userId],
    references: [users.id],
  }),
  course: one(courses, {
    fields: [payments.courseId],
    references: [courses.id],
  }),
}));

export const coursePurchasesRelations = relations(
  coursePurchases,
  ({ one }) => ({
    student: one(users, {
      fields: [coursePurchases.studentId],
      references: [users.id],
    }),
    course: one(courses, {
      fields: [coursePurchases.courseId],
      references: [courses.id],
    }),
    payment: one(payments, {
      fields: [coursePurchases.paymentId],
      references: [payments.id],
    }),
    transaction: one(transactions, {
      fields: [coursePurchases.transactionId],
      references: [transactions.id],
    }),
  })
);

// Quiz Relations
export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  video: one(videos, {
    fields: [quizzes.videoId],
    references: [videos.id],
  }),
  questions: many(quizQuestions),
  attempts: many(quizAttempts),
}));

export const quizQuestionsRelations = relations(quizQuestions, ({ one }) => ({
  quiz: one(quizzes, {
    fields: [quizQuestions.quizId],
    references: [quizzes.id],
  }),
}));

export const quizAttemptsRelations = relations(quizAttempts, ({ one }) => ({
  quiz: one(quizzes, {
    fields: [quizAttempts.quizId],
    references: [quizzes.id],
  }),
  student: one(users, {
    fields: [quizAttempts.studentId],
    references: [users.id],
  }),
}));

// ============================================================================
// SUBSCRIPTION SYSTEM
// ============================================================================

// Subscription Plans - Planos disponíveis
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(), // 'free', 'basic', 'pro', 'family'
  displayName: varchar("display_name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'creator' ou 'student'
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 20 }).default("monthly").notNull(),
  stripePriceId: varchar("stripe_price_id", { length: 255 }), // ID do preço no Stripe
  features: text("features").notNull(), // JSON: { courses: 5, videos: 50, quizzes_per_month: 5, commission_rate: 0.15, ai_questions_per_day: 5 }
  isActive: integer("is_active").default(1).notNull(), // 0 = false, 1 = true
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Subscriptions - Assinaturas ativas dos usuários
export const userSubscriptions = pgTable("user_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => subscriptionPlans.id),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  status: varchar("status", { length: 30 }).default("active").notNull(), // 'active', 'cancelled', 'past_due', 'trialing'
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end").default(0).notNull(), // 0 = false, 1 = true
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Usage Tracking - Controle de uso mensal
export const usageLimits = pgTable("usage_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  quizzesGenerated: integer("quizzes_generated").default(0).notNull(),
  aiQuestionsAsked: integer("ai_questions_asked").default(0).notNull(),
  videosUploaded: integer("videos_uploaded").default(0).notNull(),
  coursesCreated: integer("courses_created").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Leads - Captura de leads da landing page
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  type: varchar("type", { length: 20 }).notNull(), // 'creator' ou 'student'
  source: varchar("source", { length: 100 }), // 'landing', 'facebook', 'google', etc.
  utmSource: varchar("utm_source", { length: 100 }),
  utmMedium: varchar("utm_medium", { length: 100 }),
  utmCampaign: varchar("utm_campaign", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Subscription Plans Relations
export const subscriptionPlansRelations = relations(subscriptionPlans, ({ many }) => ({
  subscriptions: many(userSubscriptions),
}));

// User Subscriptions Relations
export const userSubscriptionsRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [userSubscriptions.userId],
    references: [users.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [userSubscriptions.planId],
    references: [subscriptionPlans.id],
  }),
}));

// Usage Limits Relations
export const usageLimitsRelations = relations(usageLimits, ({ one }) => ({
  user: one(users, {
    fields: [usageLimits.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// GAMIFICATION SYSTEM
// ============================================================================

// User Progress - XP, Level, Streaks
export const userProgress = pgTable("user_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  totalXp: integer("total_xp").default(0).notNull(),
  level: integer("level").default(1).notNull(),
  currentStreak: integer("current_streak").default(0).notNull(), // Days in a row studying
  longestStreak: integer("longest_streak").default(0).notNull(),
  lastActivityDate: timestamp("last_activity_date"),
  lessonsCompleted: integer("lessons_completed").default(0).notNull(),
  quizzesPassed: integer("quizzes_passed").default(0).notNull(),
  coursesCompleted: integer("courses_completed").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Badges - Available badges in the system
export const badges = pgTable("badges", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }).notNull(), // Emoji or icon code
  category: varchar("category", { length: 50 }).notNull(), // 'achievement', 'streak', 'social', 'course'
  requirement: text("requirement"), // JSON: { type: 'xp', value: 1000 } or { type: 'lessons', value: 10 }
  xpReward: integer("xp_reward").default(0).notNull(),
  isActive: integer("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// User Badges - Badges earned by users
export const userBadges = pgTable("user_badges", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  badgeId: uuid("badge_id")
    .notNull()
    .references(() => badges.id, { onDelete: "cascade" }),
  earnedAt: timestamp("earned_at").defaultNow(),
});

// XP Transactions - History of XP gains
export const xpTransactions = pgTable("xp_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  source: varchar("source", { length: 50 }).notNull(), // 'lesson', 'quiz', 'streak', 'badge', 'course'
  sourceId: uuid("source_id"), // ID of the related entity
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Gamification Relations
export const userProgressRelations = relations(userProgress, ({ one }) => ({
  user: one(users, {
    fields: [userProgress.userId],
    references: [users.id],
  }),
}));

export const badgesRelations = relations(badges, ({ many }) => ({
  userBadges: many(userBadges),
}));

export const userBadgesRelations = relations(userBadges, ({ one }) => ({
  user: one(users, {
    fields: [userBadges.userId],
    references: [users.id],
  }),
  badge: one(badges, {
    fields: [userBadges.badgeId],
    references: [badges.id],
  }),
}));

export const xpTransactionsRelations = relations(xpTransactions, ({ one }) => ({
  user: one(users, {
    fields: [xpTransactions.userId],
    references: [users.id],
  }),
}));
