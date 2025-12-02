/**
 * Stripe Payment Service
 * Handles payment processing with Stripe
 */

import Stripe from "stripe";

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

/**
 * Create a Payment Intent for purchasing credits
 */
export async function createCreditsPaymentIntent(
  amount: number, // Amount in reais (BRL)
  userId: string,
  creditsAmount: number
): Promise<{ clientSecret: string; paymentIntentId: string; error?: string }> {
  try {
    const stripe = getStripeClient();

    // Convert reais to centavos (Stripe uses smallest currency unit)
    const amountInCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "brl",
      metadata: {
        userId,
        creditsAmount: creditsAmount.toString(),
        type: "credits",
      },
    });

    return {
      clientSecret: paymentIntent.client_secret || "",
      paymentIntentId: paymentIntent.id,
    };
  } catch (error: any) {
    console.error("Error creating payment intent:", error);
    return {
      clientSecret: "",
      paymentIntentId: "",
      error: error.message || "Failed to create payment intent",
    };
  }
}

/**
 * Create a Payment Intent for purchasing a course
 */
export async function createCoursePaymentIntent(
  amount: number, // Amount in reais (BRL)
  userId: string,
  courseId: string
): Promise<{ clientSecret: string; paymentIntentId: string; error?: string }> {
  try {
    const stripe = getStripeClient();

    // Convert reais to centavos
    const amountInCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "brl",
      metadata: {
        userId,
        courseId,
        type: "course",
      },
    });

    return {
      clientSecret: paymentIntent.client_secret || "",
      paymentIntentId: paymentIntent.id,
    };
  } catch (error: any) {
    console.error("Error creating course payment intent:", error);
    return {
      clientSecret: "",
      paymentIntentId: "",
      error: error.message || "Failed to create payment intent",
    };
  }
}

/**
 * Verify payment intent status
 */
export async function verifyPaymentIntent(
  paymentIntentId: string
): Promise<{ status: string; succeeded: boolean; error?: string }> {
  try {
    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      status: paymentIntent.status,
      succeeded: paymentIntent.status === "succeeded",
    };
  } catch (error: any) {
    console.error("Error verifying payment intent:", error);
    return {
      status: "unknown",
      succeeded: false,
      error: error.message || "Failed to verify payment intent",
    };
  }
}

/**
 * Get or create Stripe customer for a user
 */
export async function getOrCreateCustomer(
  userId: string,
  email: string
): Promise<{ customerId: string; error?: string }> {
  try {
    const stripe = getStripeClient();

    // Try to find existing customer by email
    const customers = await stripe.customers.list({
      email,
      limit: 1,
    });

    if (customers.data.length > 0) {
      return { customerId: customers.data[0].id };
    }

    // Create new customer
    const customer = await stripe.customers.create({
      email,
      metadata: {
        userId,
      },
    });

    return { customerId: customer.id };
  } catch (error: any) {
    console.error("Error getting/creating customer:", error);
    return {
      customerId: "",
      error: error.message || "Failed to get or create customer",
    };
  }
}

