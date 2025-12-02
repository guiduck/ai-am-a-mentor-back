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

// Adicionar campo creditCost aos cursos (opcional, para compra com créditos)
// Isso será feito via migration, mas vamos adicionar ao schema também

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
