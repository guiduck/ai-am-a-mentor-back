/**
 * Stripe Connect V2 Service
 * Implementa onboarding, produtos e checkout com contas conectadas V2.
 */

import Stripe from "stripe";
import { getStripeClient } from "./stripe-client";

export type V2AccountStatus = {
  readyToProcessPayments: boolean;
  requirementsStatus: string | null;
  onboardingComplete: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} não configurada. Defina a variável de ambiente para continuar.`
    );
  }
  return value;
}

function getApplicationFeePercent(): number {
  const raw = requireEnv("STRIPE_CONNECT_APPLICATION_FEE_PERCENT");
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(
      "STRIPE_CONNECT_APPLICATION_FEE_PERCENT inválida. Use decimal entre 0 e 1 (ex: 0.1)."
    );
  }
  return parsed;
}

/**
 * Cria conta conectada V2 com propriedades obrigatórias.
 */
export async function createConnectAccountV2(
  displayName: string,
  contactEmail: string
): Promise<{ accountId: string }> {
  const stripeClient = getStripeClient();

  const account = await stripeClient.v2.core.accounts.create({
    display_name: displayName,
    contact_email: contactEmail,
    identity: {
      country: "us",
    },
    dashboard: "full",
    defaults: {
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
      },
    },
    configuration: {
      customer: {},
      merchant: {
        capabilities: {
          card_payments: {
            requested: true,
          },
        },
      },
    },
  });

  return { accountId: account.id };
}

/**
 * Gera link de onboarding para contas V2.
 */
export async function createOnboardingLinkV2(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<{ url: string }> {
  const stripeClient = getStripeClient();

  const accountLink = await stripeClient.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant", "customer"],
        refresh_url: refreshUrl,
        return_url: returnUrl,
      },
    },
  });

  return { url: accountLink.url };
}

/**
 * Consulta status de onboarding direto na API V2.
 */
export async function getAccountStatusV2(
  stripeAccountId: string
): Promise<V2AccountStatus> {
  const stripeClient = getStripeClient();

  const account = await stripeClient.v2.core.accounts.retrieve(
    stripeAccountId,
    {
      include: ["configuration.merchant", "requirements"],
    }
  );

  const readyToProcessPayments =
    account?.configuration?.merchant?.capabilities?.card_payments?.status ===
    "active";
  const requirementsStatus =
    account?.requirements?.summary?.minimum_deadline?.status ?? null;
  const onboardingComplete =
    requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

  return { readyToProcessPayments, requirementsStatus, onboardingComplete };
}

/**
 * Cria produto com preço padrão na conta conectada.
 */
export async function createProductForAccount(
  accountId: string,
  name: string,
  description: string | null,
  priceInCents: number,
  currency: string
): Promise<Stripe.Product> {
  const stripeClient = getStripeClient();

  return stripeClient.products.create(
    {
      name,
      description: description || undefined,
      default_price_data: {
        unit_amount: priceInCents,
        currency,
      },
    },
    {
      stripeAccount: accountId,
    }
  );
}

/**
 * Lista produtos da conta conectada para storefront.
 */
export async function listProductsForAccount(
  accountId: string
): Promise<Stripe.ApiList<Stripe.Product>> {
  const stripeClient = getStripeClient();

  return stripeClient.products.list(
    {
      limit: 20,
      active: true,
      expand: ["data.default_price"],
    },
    {
      stripeAccount: accountId,
    }
  );
}

/**
 * Cria checkout para compra direta na conta conectada.
 */
export async function createCheckoutSessionForAccount(input: {
  accountId: string;
  priceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
  productId?: string;
}): Promise<{ sessionId: string; url: string | null }> {
  const stripeClient = getStripeClient();
  const feePercent = getApplicationFeePercent();

  const price = await stripeClient.prices.retrieve(
    input.priceId,
    {},
    { stripeAccount: input.accountId }
  );

  const unitAmount = price.unit_amount || 0;
  const totalAmount = unitAmount * input.quantity;
  const applicationFeeAmount = Math.round(totalAmount * feePercent);

  const session = await stripeClient.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ price: input.priceId, quantity: input.quantity }],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
      },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        productId: input.productId || "",
        priceId: input.priceId,
      },
    },
    {
      stripeAccount: input.accountId,
    }
  );

  return { sessionId: session.id, url: session.url };
}

/**
 * Cria checkout de assinatura usando customer_account.
 */
export async function createSubscriptionCheckoutForAccount(
  accountId: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ sessionId: string; url: string | null }> {
  const stripeClient = getStripeClient();
  const priceId = requireEnv("STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID");

  const session = await stripeClient.checkout.sessions.create({
    customer_account: accountId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Cria sessão do portal de cobrança.
 */
export async function createBillingPortalSessionForAccount(
  accountId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const stripeClient = getStripeClient();

  const session = await stripeClient.billingPortal.sessions.create({
    customer_account: accountId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Resolve URL base do frontend.
 */
export function getFrontendUrl(): string {
  return requireEnv("FRONTEND_URL");
}

export function getThinWebhookSecret(): string {
  return requireEnv("STRIPE_CONNECT_V2_THIN_WEBHOOK_SECRET");
}

export function getConnectWebhookSecret(): string {
  return requireEnv("STRIPE_CONNECT_WEBHOOK_SECRET");
}
