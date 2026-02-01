/**
 * Subscription Service
 * Manages user subscriptions, plan limits, and usage tracking
 */

import { db } from "../db";
import {
  subscriptionPlans,
  userSubscriptions,
  usageLimits,
  users,
  userCredits,
  transactions,
} from "../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { getStripeClient } from "./stripe-client";
import { resolvePaymentAmount } from "./payment-bypass";

// Types
export interface PlanFeatures {
  courses: number; // -1 = unlimited
  videos: number; // -1 = unlimited
  quizzes_per_month: number; // -1 = unlimited
  credits_per_month?: number;
  commission_rate: number; // 0.05 = 5%
  ai_questions_per_day: number; // -1 = unlimited
  support: "community" | "email" | "priority";
  certificates?: boolean;
  courses_access?: "purchased" | "all";
  progress_reports?: boolean;
  chat_with_teacher?: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  type: "creator" | "student";
  price: number;
  billingPeriod: string;
  stripePriceId: string | null;
  features: PlanFeatures;
  isActive: boolean;
}

export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  plan: SubscriptionPlan;
  status: "active" | "cancelled" | "past_due" | "trialing";
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface UsageStatus {
  quizzesGenerated: number;
  quizzesLimit: number;
  aiQuestionsAsked: number;
  aiQuestionsLimit: number;
  videosUploaded: number;
  videosLimit: number;
  coursesCreated: number;
  coursesLimit: number;
  periodStart: Date;
  periodEnd: Date;
}


/**
 * Get all active subscription plans
 */
export async function getSubscriptionPlans(
  type?: "creator" | "student"
): Promise<SubscriptionPlan[]> {
  const plans = await db.query.subscriptionPlans.findMany({
    where: type
      ? and(
          eq(subscriptionPlans.type, type),
          eq(subscriptionPlans.isActive, 1)
        )
      : eq(subscriptionPlans.isActive, 1),
  });

  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    displayName: plan.displayName,
    type: plan.type as "creator" | "student",
    price: parseFloat(plan.price),
    billingPeriod: plan.billingPeriod,
    stripePriceId: plan.stripePriceId,
    features: JSON.parse(plan.features) as PlanFeatures,
    isActive: plan.isActive === 1,
  }));
}

/**
 * Get a specific plan by name
 */
export async function getPlanByName(name: string): Promise<SubscriptionPlan | null> {
  const plan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.name, name),
  });

  if (!plan) return null;

  return {
    id: plan.id,
    name: plan.name,
    displayName: plan.displayName,
    type: plan.type as "creator" | "student",
    price: parseFloat(plan.price),
    billingPeriod: plan.billingPeriod,
    stripePriceId: plan.stripePriceId,
    features: JSON.parse(plan.features) as PlanFeatures,
    isActive: plan.isActive === 1,
  };
}

/**
 * Get user's current subscription
 */
export async function getUserSubscription(
  userId: string
): Promise<UserSubscription | null> {
  const subscription = await db.query.userSubscriptions.findFirst({
    where: and(
      eq(userSubscriptions.userId, userId),
      eq(userSubscriptions.status, "active")
    ),
    with: {
      plan: true,
    },
  });

  if (!subscription) return null;

  return {
    id: subscription.id,
    userId: subscription.userId,
    planId: subscription.planId,
    plan: {
      id: subscription.plan.id,
      name: subscription.plan.name,
      displayName: subscription.plan.displayName,
      type: subscription.plan.type as "creator" | "student",
      price: parseFloat(subscription.plan.price),
      billingPeriod: subscription.plan.billingPeriod,
      stripePriceId: subscription.plan.stripePriceId,
      features: JSON.parse(subscription.plan.features) as PlanFeatures,
      isActive: subscription.plan.isActive === 1,
    },
    status: subscription.status as "active" | "cancelled" | "past_due" | "trialing",
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === 1,
  };
}

/**
 * Get user's plan features (returns free plan features if no subscription)
 */
export async function getUserPlanFeatures(userId: string): Promise<PlanFeatures> {
  const subscription = await getUserSubscription(userId);

  if (subscription) {
    return subscription.plan.features;
  }

  // Get user role to determine default free plan
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  const defaultPlanName = user?.role === "creator" ? "creator_free" : "student_free";
  const defaultPlan = await getPlanByName(defaultPlanName);

  return defaultPlan?.features || {
    courses: 1,
    videos: 10,
    quizzes_per_month: 0,
    credits_per_month: user?.role === "creator" ? 5 : 0,
    commission_rate: 0.05,
    ai_questions_per_day: 5,
    support: "community",
  };
}

/**
 * Garante que créditos mensais do plano sejam concedidos no ciclo atual.
 * Usa o histórico de transações para evitar duplicidade.
 */
export async function ensureSubscriptionCredits(userId: string): Promise<void> {
  const subscription = await getUserSubscription(userId);
  const features = subscription?.plan.features ?? (await getUserPlanFeatures(userId));
  const monthlyCredits =
    typeof features.credits_per_month === "number" ? features.credits_per_month : 0;

  if (monthlyCredits <= 0) {
    return;
  }

  const now = new Date();
  const periodStart =
    subscription?.currentPeriodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd =
    subscription?.currentPeriodEnd ??
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const planLabel = subscription?.plan.displayName ?? "plano gratuito";

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

    const existingCredit = await tx.query.transactions.findFirst({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.type, "subscription_credit"),
        gte(transactions.createdAt, periodStart),
        lte(transactions.createdAt, periodEnd)
      ),
    });

    if (existingCredit) {
      return;
    }

    await tx
      .insert(userCredits)
      .values({
        userId,
        balance: 0,
      })
      .onConflictDoNothing();

    const currentCredits = await tx.query.userCredits.findFirst({
      where: eq(userCredits.userId, userId),
    });

    const currentBalance = currentCredits?.balance ?? 0;
    const newBalance = currentBalance + monthlyCredits;

    await tx
      .update(userCredits)
      .set({
        balance: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(userCredits.userId, userId));

    await tx.insert(transactions).values({
      userId,
      type: "subscription_credit",
      amount: monthlyCredits,
      description: `Créditos mensais do ${planLabel}`,
      relatedId: subscription?.id,
      relatedType: "subscription",
    });
  });
}

/**
 * Create Stripe checkout session for subscription
 */
export async function createSubscriptionCheckout(
  userId: string,
  planId: string,
  email: string
): Promise<{ sessionUrl: string } | { error: string }> {
  try {
    const stripe = getStripeClient();

    // Get plan
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      return { error: "Plano não encontrado" };
    }

    const planPrice = Number.parseFloat(plan.price);
    const {
      amount: chargeAmount,
      bypassApplied,
    } = resolvePaymentAmount(planPrice, email);

    const stripePriceId = plan.stripePriceId ?? "";
    if (!stripePriceId && !bypassApplied) {
      return { error: "Plano não configurado para pagamento" };
    }

    const interval =
      plan.billingPeriod === "yearly" || plan.billingPeriod === "annual"
        ? "year"
        : "month";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      bypassApplied
        ? {
            price_data: {
              currency: "brl",
              product_data: {
                name: plan.displayName,
              },
              unit_amount: Math.round(chargeAmount * 100),
              recurring: {
                interval,
              },
            },
            quantity: 1,
          }
        : {
            price: stripePriceId,
            quantity: 1,
          },
    ];

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: lineItems,
      customer_email: email,
      metadata: {
        userId,
        planId,
        planName: plan.name,
        bypassApplied: String(bypassApplied),
      },
      success_url: `${process.env.FRONTEND_URL}/payments?success=true&plan=${plan.name}`,
      cancel_url: `${process.env.FRONTEND_URL}/payments?cancelled=true`,
    });

    return { sessionUrl: session.url || "" };
  } catch (error: any) {
    console.error("Error creating subscription checkout:", error);
    return { error: error.message || "Erro ao criar checkout" };
  }
}

/**
 * Create user subscription (after successful payment or for free plans)
 */
export async function createUserSubscription(
  userId: string,
  planId: string,
  stripeSubscriptionId?: string,
  stripeCustomerId?: string
): Promise<{ subscriptionId: string } | { error: string }> {
  try {
    // Cancel any existing active subscription
    await db
      .update(userSubscriptions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.status, "active")
        )
      );

    // Create new subscription
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const [newSubscription] = await db
      .insert(userSubscriptions)
      .values({
        userId,
        planId,
        stripeSubscriptionId,
        stripeCustomerId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      })
      .returning();

    // Initialize usage limits for this period
    await initializeUsageLimits(userId, now, periodEnd);

    return { subscriptionId: newSubscription.id };
  } catch (error: any) {
    console.error("Error creating subscription:", error);
    return { error: error.message || "Erro ao criar assinatura" };
  }
}

/**
 * Cancel user subscription
 */
export async function cancelSubscription(
  userId: string,
  immediate: boolean = false
): Promise<{ success: boolean } | { error: string }> {
  try {
    const subscription = await getUserSubscription(userId);

    if (!subscription) {
      return { error: "Nenhuma assinatura ativa encontrada" };
    }

    if (subscription.plan.price === 0) {
      return { error: "Não é possível cancelar plano gratuito" };
    }

    // Cancel in Stripe if applicable
    if (subscription.planId && process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripeClient();

      // Find stripe subscription
      if (subscription.plan.stripePriceId) {
        // Cancel at period end (user keeps access until end of billing)
        // Or immediately if requested
        const stripeSubRecord = await db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.id, subscription.id),
        });

        if (stripeSubRecord?.stripeSubscriptionId) {
          await stripe.subscriptions.update(stripeSubRecord.stripeSubscriptionId, {
            cancel_at_period_end: !immediate,
          });
        }
      }
    }

    // Update database
    if (immediate) {
      await db
        .update(userSubscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(userSubscriptions.id, subscription.id));
    } else {
      await db
        .update(userSubscriptions)
        .set({ cancelAtPeriodEnd: 1, updatedAt: new Date() })
        .where(eq(userSubscriptions.id, subscription.id));
    }

    return { success: true };
  } catch (error: any) {
    console.error("Error cancelling subscription:", error);
    return { error: error.message || "Erro ao cancelar assinatura" };
  }
}

/**
 * Initialize usage limits for a billing period
 */
async function initializeUsageLimits(
  userId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<void> {
  // Check if already exists
  const existing = await db.query.usageLimits.findFirst({
    where: and(
      eq(usageLimits.userId, userId),
      gte(usageLimits.periodStart, periodStart),
      lte(usageLimits.periodEnd, periodEnd)
    ),
  });

  if (!existing) {
    await db.insert(usageLimits).values({
      userId,
      periodStart,
      periodEnd,
    });
  }
}

/**
 * Get current usage status for user
 */
export async function getUserUsageStatus(userId: string): Promise<UsageStatus> {
  const features = await getUserPlanFeatures(userId);
  const now = new Date();

  // Get or create current period usage
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  let usage = await db.query.usageLimits.findFirst({
    where: and(
      eq(usageLimits.userId, userId),
      lte(usageLimits.periodStart, now),
      gte(usageLimits.periodEnd, now)
    ),
  });

  if (!usage) {
    // Create usage record for current period
    [usage] = await db
      .insert(usageLimits)
      .values({
        userId,
        periodStart: startOfMonth,
        periodEnd: endOfMonth,
      })
      .returning();
  }

  return {
    quizzesGenerated: usage.quizzesGenerated,
    quizzesLimit: features.quizzes_per_month,
    aiQuestionsAsked: usage.aiQuestionsAsked,
    aiQuestionsLimit: features.ai_questions_per_day,
    videosUploaded: usage.videosUploaded,
    videosLimit: features.videos,
    coursesCreated: usage.coursesCreated,
    coursesLimit: features.courses,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
  };
}

/**
 * Check if user can perform action based on plan limits
 */
export async function canPerformAction(
  userId: string,
  action: "create_course" | "upload_video" | "generate_quiz" | "ask_ai"
): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getUserUsageStatus(userId);

  switch (action) {
    case "create_course":
      if (usage.coursesLimit === -1) return { allowed: true };
      if (usage.coursesCreated >= usage.coursesLimit) {
        return {
          allowed: false,
          reason: `Você atingiu o limite de ${usage.coursesLimit} cursos do seu plano. Faça upgrade para criar mais cursos.`,
        };
      }
      return { allowed: true };

    case "upload_video":
      if (usage.videosLimit === -1) return { allowed: true };
      if (usage.videosUploaded >= usage.videosLimit) {
        return {
          allowed: false,
          reason: `Você atingiu o limite de ${usage.videosLimit} vídeos do seu plano. Faça upgrade para enviar mais vídeos.`,
        };
      }
      return { allowed: true };

    case "generate_quiz":
      if (usage.quizzesLimit === -1) return { allowed: true };
      if (usage.quizzesLimit === 0) {
        return {
          allowed: false,
          reason: "Geração de quizzes não está disponível no plano gratuito. Faça upgrade para usar esta funcionalidade.",
        };
      }
      if (usage.quizzesGenerated >= usage.quizzesLimit) {
        return {
          allowed: false,
          reason: `Você atingiu o limite de ${usage.quizzesLimit} quizzes este mês. Faça upgrade ou aguarde o próximo mês.`,
        };
      }
      return { allowed: true };

    case "ask_ai":
      if (usage.aiQuestionsLimit === -1) return { allowed: true };
      if (usage.aiQuestionsLimit === 0) {
        return {
          allowed: false,
          reason: "Perguntas à IA não estão disponíveis no seu plano. Faça upgrade para usar esta funcionalidade.",
        };
      }
      if (usage.aiQuestionsAsked >= usage.aiQuestionsLimit) {
        return {
          allowed: false,
          reason: `Você atingiu o limite de ${usage.aiQuestionsLimit} perguntas hoje. Volte amanhã ou faça upgrade.`,
        };
      }
      return { allowed: true };

    default:
      return { allowed: true };
  }
}

/**
 * Increment usage counter
 */
export async function incrementUsage(
  userId: string,
  action: "quiz" | "ai_question" | "video" | "course"
): Promise<void> {
  const now = new Date();

  // Get current period usage
  let usage = await db.query.usageLimits.findFirst({
    where: and(
      eq(usageLimits.userId, userId),
      lte(usageLimits.periodStart, now),
      gte(usageLimits.periodEnd, now)
    ),
  });

  if (!usage) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    [usage] = await db
      .insert(usageLimits)
      .values({
        userId,
        periodStart: startOfMonth,
        periodEnd: endOfMonth,
      })
      .returning();
  }

  // Increment appropriate counter
  const updateData: any = { updatedAt: new Date() };

  switch (action) {
    case "quiz":
      updateData.quizzesGenerated = usage.quizzesGenerated + 1;
      break;
    case "ai_question":
      updateData.aiQuestionsAsked = usage.aiQuestionsAsked + 1;
      break;
    case "video":
      updateData.videosUploaded = usage.videosUploaded + 1;
      break;
    case "course":
      updateData.coursesCreated = usage.coursesCreated + 1;
      break;
  }

  await db
    .update(usageLimits)
    .set(updateData)
    .where(eq(usageLimits.id, usage.id));
}

/**
 * Get commission rate for a creator
 */
export async function getCreatorCommissionRate(creatorId: string): Promise<number> {
  const features = await getUserPlanFeatures(creatorId);
  return features.commission_rate;
}
