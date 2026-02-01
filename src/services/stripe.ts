/**
 * Stripe Payment Service
 * Handles payment processing with Stripe (Card + Boleto)
 */

import { getStripeClient } from "./stripe-client";

// Payment method types
export type PaymentMethodType = "card" | "boleto";

interface PaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
  paymentMethod: PaymentMethodType;
  // Boleto specific data
  boletoUrl?: string;
  boletoNumber?: string;
  boletoExpiresAt?: number;
  error?: string;
}

interface SetupIntentResult {
  clientSecret: string;
  setupIntentId: string;
  error?: string;
}

/**
 * Create a Payment Intent for purchasing credits
 * @param paymentMethod - "card" or "boleto"
 */
export async function createCreditsPaymentIntent(
  amount: number, // Amount in reais (BRL)
  userId: string,
  creditsAmount: number,
  paymentMethod: PaymentMethodType = "card"
): Promise<PaymentIntentResult> {
  try {
    const stripe = getStripeClient();

    // Convert reais to centavos (Stripe uses smallest currency unit)
    const amountInCents = Math.round(amount * 100);

    const paymentIntentData: Stripe.PaymentIntentCreateParams = {
      amount: amountInCents,
      currency: "brl",
      payment_method_types: [paymentMethod],
      metadata: {
        userId,
        creditsAmount: creditsAmount.toString(),
        type: "credits",
        paymentMethod,
      },
    };

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

    const result: PaymentIntentResult = {
      clientSecret: paymentIntent.client_secret || "",
      paymentIntentId: paymentIntent.id,
      paymentMethod,
    };

    // For Boleto, extract boleto data if available
    const boletoDetails = paymentIntent.next_action?.boleto_display_details;
    if (paymentMethod === "boleto" && boletoDetails) {
      result.boletoUrl = boletoDetails.hosted_voucher_url ?? undefined;
      result.boletoNumber = boletoDetails.number ?? undefined;
      result.boletoExpiresAt = boletoDetails.expires_at ?? undefined;
    }

    return result;
  } catch (error: any) {
    console.error("Error creating payment intent:", error);
    return {
      clientSecret: "",
      paymentIntentId: "",
      paymentMethod,
      error: error.message || "Falha ao criar a intencao de pagamento",
    };
  }
}

/**
 * Create a Payment Intent for purchasing a course
 * @param paymentMethod - "card" or "boleto"
 */
export async function createCoursePaymentIntent(
  amount: number, // Amount in reais (BRL)
  userId: string,
  courseId: string,
  paymentMethod: PaymentMethodType = "card"
): Promise<PaymentIntentResult> {
  try {
    const stripe = getStripeClient();

    // Convert reais to centavos
    const amountInCents = Math.round(amount * 100);

    const paymentIntentData: Stripe.PaymentIntentCreateParams = {
      amount: amountInCents,
      currency: "brl",
      payment_method_types: [paymentMethod],
      metadata: {
        userId,
        courseId,
        type: "course",
        paymentMethod,
      },
    };

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

    const result: PaymentIntentResult = {
      clientSecret: paymentIntent.client_secret || "",
      paymentIntentId: paymentIntent.id,
      paymentMethod,
    };

    // For Boleto, extract boleto data if available
    const boletoDetails = paymentIntent.next_action?.boleto_display_details;
    if (paymentMethod === "boleto" && boletoDetails) {
      result.boletoUrl = boletoDetails.hosted_voucher_url ?? undefined;
      result.boletoNumber = boletoDetails.number ?? undefined;
      result.boletoExpiresAt = boletoDetails.expires_at ?? undefined;
    }

    return result;
  } catch (error: any) {
    console.error("Error creating course payment intent:", error);
    return {
      clientSecret: "",
      paymentIntentId: "",
      paymentMethod,
      error: error.message || "Falha ao criar a intencao de pagamento",
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
      error: error.message || "Falha ao verificar a intencao de pagamento",
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
      error: error.message || "Falha ao obter ou criar o cliente",
    };
  }
}

/**
 * Verifica se o cliente possui cartão salvo.
 */
export async function hasCustomerCard(customerId: string): Promise<boolean> {
  try {
    const stripe = getStripeClient();
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 1,
    });
    return paymentMethods.data.length > 0;
  } catch (error: any) {
    console.error("Error checking customer cards:", error);
    return false;
  }
}

/**
 * Cria SetupIntent para cadastrar cartão para compras futuras.
 */
export async function createCardSetupIntent(
  customerId: string
): Promise<SetupIntentResult> {
  try {
    const stripe = getStripeClient();
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    return {
      clientSecret: setupIntent.client_secret || "",
      setupIntentId: setupIntent.id,
    };
  } catch (error: any) {
    console.error("Error creating setup intent:", error);
    return {
      clientSecret: "",
      setupIntentId: "",
      error: error.message || "Falha ao criar o cadastro de cartão",
    };
  }
}
