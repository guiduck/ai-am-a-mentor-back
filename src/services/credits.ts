/**
 * Credits Service
 * Handles credit balance and transactions
 */

import { db } from "../db";
import { userCredits, transactions } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Get user's credit balance
 */
export async function getUserCredits(userId: string): Promise<number> {
  const credits = await db.query.userCredits.findFirst({
    where: eq(userCredits.userId, userId),
  });

  return credits?.balance || 0;
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
 * Add credits to user's balance
 */
export async function addCredits(
  userId: string,
  amount: number,
  description: string,
  relatedId?: string,
  relatedType?: string
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
      type: "purchase",
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
      error: error.message || "Failed to add credits",
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
        error: "Insufficient credits",
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
      error: error.message || "Failed to deduct credits",
    };
  }
}

/**
 * Get user's transaction history
 */
export async function getUserTransactions(
  userId: string,
  limit: number = 50
) {
  return await db.query.transactions.findMany({
    where: eq(transactions.userId, userId),
    orderBy: (transactions, { desc }) => [desc(transactions.createdAt)],
    limit,
  });
}


