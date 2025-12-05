/**
 * Stripe Connect Service
 * Handles creator accounts and payment splitting
 */

import Stripe from "stripe";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover",
    });
  }

  return stripeClient;
}

// Platform fee percentage (10% for the platform)
const PLATFORM_FEE_PERCENT = 10;

/**
 * Create a Stripe Connect account for a creator
 */
export async function createConnectAccount(
  userId: string,
  email: string
): Promise<{ accountId: string; error?: string }> {
  try {
    const stripe = getStripeClient();

    // Create a Standard Connect account
    const account = await stripe.accounts.create({
      type: "standard",
      country: "BR",
      email,
      metadata: {
        userId,
      },
    });

    // Save account ID to user
    await db
      .update(users)
      .set({
        stripeAccountId: account.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { accountId: account.id };
  } catch (error: any) {
    console.error("Error creating Connect account:", error);
    return {
      accountId: "",
      error: error.message || "Failed to create Connect account",
    };
  }
}

/**
 * Generate onboarding link for creator to complete Stripe setup
 */
export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<{ url: string; error?: string }> {
  try {
    const stripe = getStripeClient();

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return { url: accountLink.url };
  } catch (error: any) {
    console.error("Error creating onboarding link:", error);
    return {
      url: "",
      error: error.message || "Failed to create onboarding link",
    };
  }
}

/**
 * Check if a Connect account is fully onboarded
 */
export async function checkAccountStatus(
  accountId: string
): Promise<{
  isComplete: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  error?: string;
}> {
  try {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(accountId);

    const isComplete =
      account.charges_enabled && account.payouts_enabled;

    // Update user if onboarding is complete
    if (isComplete) {
      await db
        .update(users)
        .set({
          stripeOnboardingComplete: 1,
          updatedAt: new Date(),
        })
        .where(eq(users.stripeAccountId, accountId));
    }

    return {
      isComplete,
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
    };
  } catch (error: any) {
    console.error("Error checking account status:", error);
    return {
      isComplete: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      error: error.message || "Failed to check account status",
    };
  }
}

/**
 * Create a Payment Intent with automatic split to creator
 * Platform takes 10%, creator receives 90%
 */
export async function createCoursePaymentWithSplit(
  amount: number, // Amount in reais (BRL)
  buyerId: string,
  courseId: string,
  creatorStripeAccountId: string,
  paymentMethod: "card" | "boleto" = "card"
): Promise<{
  clientSecret: string;
  paymentIntentId: string;
  platformFee: number;
  creatorAmount: number;
  error?: string;
}> {
  try {
    const stripe = getStripeClient();

    // Convert reais to centavos
    const amountInCents = Math.round(amount * 100);

    // Calculate platform fee (10%)
    const platformFeeInCents = Math.round(amountInCents * (PLATFORM_FEE_PERCENT / 100));
    const creatorAmountInCents = amountInCents - platformFeeInCents;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "brl",
      payment_method_types: [paymentMethod],
      // This is the key: application_fee_amount goes to platform
      // The rest goes to the connected account
      application_fee_amount: platformFeeInCents,
      transfer_data: {
        destination: creatorStripeAccountId,
      },
      metadata: {
        buyerId,
        courseId,
        type: "course_purchase",
        platformFee: platformFeeInCents.toString(),
        creatorAmount: creatorAmountInCents.toString(),
      },
    });

    return {
      clientSecret: paymentIntent.client_secret || "",
      paymentIntentId: paymentIntent.id,
      platformFee: platformFeeInCents / 100,
      creatorAmount: creatorAmountInCents / 100,
    };
  } catch (error: any) {
    console.error("Error creating payment with split:", error);
    return {
      clientSecret: "",
      paymentIntentId: "",
      platformFee: 0,
      creatorAmount: 0,
      error: error.message || "Failed to create payment",
    };
  }
}

/**
 * Get creator's Stripe dashboard login link
 */
export async function getCreatorDashboardLink(
  accountId: string
): Promise<{ url: string; error?: string }> {
  try {
    const stripe = getStripeClient();

    const loginLink = await stripe.accounts.createLoginLink(accountId);

    return { url: loginLink.url };
  } catch (error: any) {
    console.error("Error creating dashboard link:", error);
    return {
      url: "",
      error: error.message || "Failed to create dashboard link",
    };
  }
}

/**
 * Get creator's balance from their connected account
 */
export async function getCreatorBalance(
  accountId: string
): Promise<{
  available: number;
  pending: number;
  error?: string;
}> {
  try {
    const stripe = getStripeClient();

    const balance = await stripe.balance.retrieve({
      stripeAccount: accountId,
    });

    // Find BRL balance
    const availableBRL = balance.available.find((b) => b.currency === "brl");
    const pendingBRL = balance.pending.find((b) => b.currency === "brl");

    return {
      available: (availableBRL?.amount || 0) / 100,
      pending: (pendingBRL?.amount || 0) / 100,
    };
  } catch (error: any) {
    console.error("Error getting creator balance:", error);
    return {
      available: 0,
      pending: 0,
      error: error.message || "Failed to get balance",
    };
  }
}

