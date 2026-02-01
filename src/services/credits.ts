/**
 * Credits Service
 * Handles credit balance and transactions
 */

import { db } from "../db";
import { userCredits, transactions } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";

const CREDIT_EXPIRATION_MONTHS = 2;

/**
 * Get user's credit balance
 */
export async function getUserCredits(userId: string): Promise<number> {
  const { balance } = await getUserCreditBalance(userId);
  return balance;
}

/**
 * Initialize credits for a user (if they don't have a record)
 */
export async function initializeUserCredits(userId: string): Promise<void> {
  const existing = await db.query.userCredits.findFirst({
    where: eq(userCredits.userId, userId),
  });

  if (!existing) {
    await db.insert(userCredits).values({
      userId,
      balance: 0,
    });
  }
}

/**
 * Add credits to user's balance.
 * Allows custom transaction types for subscription or bonus credits.
 */
export async function addCredits(
  userId: string,
  amount: number,
  description: string,
  relatedId?: string,
  relatedType?: string,
  transactionType: string = "purchase"
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  try {
    // Initialize if needed
    await initializeUserCredits(userId);

    // Get current balance
    const current = await db.query.userCredits.findFirst({
      where: eq(userCredits.userId, userId),
    });

    const currentBalance = current?.balance || 0;
    const newBalance = currentBalance + amount;

    // Update balance
    await db
      .update(userCredits)
      .set({
        balance: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(userCredits.userId, userId));

    // Create transaction record
    await db.insert(transactions).values({
      userId,
      type: transactionType,
      amount,
      description,
      relatedId,
      relatedType,
    });

    return { success: true, newBalance };
  } catch (error: any) {
    console.error("Error adding credits:", error);
    return {
      success: false,
      newBalance: 0,
      error: error.message || "Falha ao adicionar creditos",
    };
  }
}

/**
 * Deduct credits from user's balance
 */
export async function deductCredits(
  userId: string,
  amount: number,
  description: string,
  relatedId?: string,
  relatedType?: string
): Promise<{ success: boolean; newBalance: number; transactionId?: string; error?: string }> {
  try {
    // Initialize if needed
    await initializeUserCredits(userId);

    // Get current balance
    const current = await db.query.userCredits.findFirst({
      where: eq(userCredits.userId, userId),
    });

    const currentBalance = current?.balance || 0;

    if (currentBalance < amount) {
      return {
        success: false,
        newBalance: currentBalance,
        error: "Creditos insuficientes",
      };
    }

    const newBalance = currentBalance - amount;

    // Update balance
    await db
      .update(userCredits)
      .set({
        balance: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(userCredits.userId, userId));

    // Create transaction record (negative amount)
    const [transaction] = await db.insert(transactions).values({
      userId,
      type: "usage",
      amount: -amount,
      description,
      relatedId,
      relatedType,
    }).returning();

    return { success: true, newBalance, transactionId: transaction.id };
  } catch (error: any) {
    console.error("Error deducting credits:", error);
    return {
      success: false,
      newBalance: 0,
      error: error.message || "Falha ao debitar creditos",
    };
  }
}

/**
 * Get user's credit balance with expiration metadata.
 */
export async function getUserCreditBalance(userId: string): Promise<{
  balance: number;
  expiresAt: Date | null;
  expiresInDays: number | null;
}> {
  await initializeUserCredits(userId);

  const credits = await db.query.userCredits.findFirst({
    where: eq(userCredits.userId, userId),
  });

  const currentBalance = credits?.balance || 0;
  const expirationInfo = await applyCreditExpiration(userId, currentBalance);

  if (expirationInfo.expired) {
    return {
      balance: 0,
      expiresAt: null,
      expiresInDays: null,
    };
  }

  const expiresAt = expirationInfo.expiresAt;
  const expiresInDays = expiresAt
    ? Math.max(
        0,
        Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      )
    : null;

  return {
    balance: currentBalance,
    expiresAt,
    expiresInDays,
  };
}

/**
 * Get user's transaction history
 */
export async function getUserTransactions(
  userId: string,
  options?: { limit?: number; offset?: number }
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return await db.query.transactions.findMany({
    where: eq(transactions.userId, userId),
    orderBy: (transactions, { desc }) => [desc(transactions.createdAt)],
    limit,
    offset,
  });
}

/**
 * Apply credit expiration rule (2 months without usage).
 */
async function applyCreditExpiration(
  userId: string,
  balance: number
): Promise<{ expired: boolean; expiresAt: Date | null }> {
  if (balance <= 0) {
    return { expired: false, expiresAt: null };
  }

  const lastUsageAt = await getLastTransactionDate(userId, ["usage"]);
  const lastCreditAt = await getLastTransactionDate(userId, [
    "purchase",
    "subscription_credit",
    "bonus",
  ]);

  const baseDate = lastUsageAt || lastCreditAt;
  if (!baseDate) {
    return { expired: false, expiresAt: null };
  }

  const expiresAt = addMonths(baseDate, CREDIT_EXPIRATION_MONTHS);
  if (Date.now() <= expiresAt.getTime()) {
    return { expired: false, expiresAt };
  }

  await db
    .update(userCredits)
    .set({
      balance: 0,
      updatedAt: new Date(),
    })
    .where(eq(userCredits.userId, userId));

  await db.insert(transactions).values({
    userId,
    type: "expiration",
    amount: -balance,
    description: "Expiração de créditos por inatividade",
    relatedType: "expiration",
  });

  return { expired: true, expiresAt };
}

/**
 * Get the most recent transaction date for a list of types.
 */
async function getLastTransactionDate(
  userId: string,
  types: string[]
): Promise<Date | null> {
  if (types.length === 0) {
    return null;
  }

  const transaction = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.userId, userId),
      inArray(transactions.type, types)
    ),
    orderBy: (transactions, { desc }) => [desc(transactions.createdAt)],
  });

  return transaction?.createdAt || null;
}

/**
 * Add months to a date without mutating the original instance.
 */
function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}
