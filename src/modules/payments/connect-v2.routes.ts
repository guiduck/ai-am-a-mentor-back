/**
 * Stripe Connect V2 Routes
 * Onboarding, produtos, storefront e webhooks.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import Stripe from "stripe";
import { db } from "../../db";
import {
  connectedAccountPurchases,
  connectedAccountSubscriptions,
  stripeAccountRequirementsUpdates,
  users,
} from "../../db/schema";
import { eq } from "drizzle-orm";
import { getStripeClient } from "../../services/stripe-client";
import {
  createBillingPortalSessionForAccount,
  createCheckoutSessionForAccount,
  createConnectAccountV2,
  createOnboardingLinkV2,
  createProductForAccount,
  createSubscriptionCheckoutForAccount,
  getAccountStatusV2,
  getConnectWebhookSecret,
  getFrontendUrl,
  getThinWebhookSecret,
  listProductsForAccount,
} from "../../services/stripe-connect-v2";

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  priceInCents: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("usd"),
});

const checkoutSchema = z.object({
  accountId: z.string().min(1),
  priceId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  productId: z.string().optional(),
});

function resolveAccountIdFromEvent(
  event: Stripe.Event,
  fallback?: string | null
): string | null {
  return (
    event.account ||
    (event.data?.object as any)?.customer_account ||
    (event.data?.object as any)?.account ||
    fallback ||
    null
  );
}

export async function connectV2Routes(fastify: FastifyInstance) {
  /**
   * POST /connect/v2/create-account
   */
  fastify.post("/connect/v2/create-account", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        if (user.stripeAccountId) {
          return reply.status(400).send({
            error: "Você já possui uma conta Connect",
            accountId: user.stripeAccountId,
          });
        }

        const { accountId } = await createConnectAccountV2(
          user.username,
          user.email
        );

        await db
          .update(users)
          .set({ stripeAccountId: accountId, updatedAt: new Date() })
          .where(eq(users.id, userId));

        return { accountId };
      } catch (error: any) {
        console.error("Error creating V2 account:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao criar conta Connect V2",
        });
      }
    },
  });

  /**
   * POST /connect/v2/onboarding-link
   */
  fastify.post("/connect/v2/onboarding-link", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { returnUrl, refreshUrl } = z
          .object({
            returnUrl: z.string().url(),
            refreshUrl: z.string().url(),
          })
          .parse(request.body);

        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.id),
        });

        if (!user?.stripeAccountId) {
          return reply.status(400).send({
            error: "Você precisa criar uma conta Connect primeiro",
          });
        }

        const { url } = await createOnboardingLinkV2(
          user.stripeAccountId,
          returnUrl,
          refreshUrl
        );

        return { url };
      } catch (error: any) {
        console.error("Error creating onboarding link V2:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao criar link de onboarding V2",
        });
      }
    },
  });

  /**
   * GET /connect/v2/status
   */
  fastify.get("/connect/v2/status", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.id),
        });

        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        if (!user.stripeAccountId) {
          return {
            hasAccount: false,
            accountId: null,
            readyToProcessPayments: false,
            requirementsStatus: null,
            onboardingComplete: false,
          };
        }

        const status = await getAccountStatusV2(user.stripeAccountId);

        return {
          hasAccount: true,
          accountId: user.stripeAccountId,
          ...status,
        };
      } catch (error: any) {
        console.error("Error getting V2 status:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao obter status da conta",
        });
      }
    },
  });

  /**
   * POST /connect/v2/products
   */
  fastify.post("/connect/v2/products", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.id),
        });

        if (!user?.stripeAccountId) {
          return reply.status(400).send({
            error: "Você precisa concluir o onboarding primeiro",
          });
        }

        const { name, description, priceInCents, currency } =
          createProductSchema.parse(request.body);

        const product = await createProductForAccount(
          user.stripeAccountId,
          name,
          description || null,
          priceInCents,
          currency
        );

        return { product };
      } catch (error: any) {
        console.error("Error creating product:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao criar produto",
        });
      }
    },
  });

  /**
   * GET /connect/v2/products
   */
  fastify.get("/connect/v2/products", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.id),
        });

        if (!user?.stripeAccountId) {
          return reply.status(400).send({
            error: "Você precisa concluir o onboarding primeiro",
          });
        }

        const products = await listProductsForAccount(user.stripeAccountId);
        return { products };
      } catch (error: any) {
        console.error("Error listing products:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao listar produtos",
        });
      }
    },
  });

  /**
   * GET /connect/v2/storefront/:accountId/products
   */
  fastify.get("/connect/v2/storefront/:accountId/products", {
    handler: async (request, reply) => {
      try {
        const { accountId } = request.params as { accountId: string };
        const products = await listProductsForAccount(accountId);
        return { products };
      } catch (error: any) {
        console.error("Error listing storefront products:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao listar produtos da loja",
        });
      }
    },
  });

  /**
   * POST /connect/v2/storefront/checkout
   */
  fastify.post("/connect/v2/storefront/checkout", {
    handler: async (request, reply) => {
      try {
        const { accountId, priceId, quantity, productId } =
          checkoutSchema.parse(request.body);
        const frontendUrl = getFrontendUrl();

        const { url, sessionId } = await createCheckoutSessionForAccount({
          accountId,
          priceId,
          quantity,
          productId,
          successUrl: `${frontendUrl}/storefront/${accountId}?success=1`,
          cancelUrl: `${frontendUrl}/storefront/${accountId}?canceled=1`,
        });

        return { url, sessionId };
      } catch (error: any) {
        console.error("Error creating storefront checkout:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao criar checkout",
        });
      }
    },
  });

  /**
   * POST /connect/v2/subscriptions/checkout
   */
  fastify.post("/connect/v2/subscriptions/checkout", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.id),
        });

        if (!user?.stripeAccountId) {
          return reply.status(400).send({
            error: "Você precisa concluir o onboarding primeiro",
          });
        }

        const frontendUrl = getFrontendUrl();
        const { url, sessionId } = await createSubscriptionCheckoutForAccount(
          user.stripeAccountId,
          `${frontendUrl}/connect-v2?subscription=success`,
          `${frontendUrl}/connect-v2?subscription=cancel`
        );

        return { url, sessionId };
      } catch (error: any) {
        console.error("Error creating subscription checkout:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao criar checkout de assinatura",
        });
      }
    },
  });

  /**
   * POST /connect/v2/billing-portal
   */
  fastify.post("/connect/v2/billing-portal", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, request.user.id),
        });

        if (!user?.stripeAccountId) {
          return reply.status(400).send({
            error: "Você precisa concluir o onboarding primeiro",
          });
        }

        const { url } = await createBillingPortalSessionForAccount(
          user.stripeAccountId,
          `${getFrontendUrl()}/connect-v2`
        );

        return { url };
      } catch (error: any) {
        console.error("Error creating billing portal:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao abrir portal de cobrança",
        });
      }
    },
  });

  /**
   * POST /connect/v2/webhooks/thin
   */
  fastify.post("/connect/v2/webhooks/thin", {
    config: {
      rawBody: true,
    },
    handler: async (request, reply) => {
      const signature = request.headers["stripe-signature"] as string | undefined;
      if (!signature) {
        return reply.status(400).send({ error: "Assinatura ausente" });
      }

      try {
        const stripeClient = getStripeClient();
        const payload = (request as any).rawBody;
        const thinEvent = stripeClient.parseThinEvent(
          payload,
          signature,
          getThinWebhookSecret()
        );
        const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);
        const accountId = resolveAccountIdFromEvent(event, thinEvent.account);

        switch (event.type) {
          case "v2.core.account[requirements].updated":
          case "v2.core.account[configuration.merchant].capability_status_updated":
          case "v2.core.account[configuration.customer].capability_status_updated":
          case "v2.core.account[configuration.recipient].capability_status_updated": {
            if (accountId) {
              await db.insert(stripeAccountRequirementsUpdates).values({
                stripeAccountId: accountId,
                eventId: event.id,
                eventType: event.type,
                requirementsStatus:
                  (event.data?.object as any)?.requirements?.summary
                    ?.minimum_deadline?.status || null,
                capabilities: JSON.stringify(
                  (event.data?.object as any)?.configuration?.merchant
                    ?.capabilities || {}
                ),
                payload: JSON.stringify(event),
              });
            }
            break;
          }
          default:
            break;
        }

        return { received: true };
      } catch (error: any) {
        console.error("Error processing thin webhook:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao processar webhook",
        });
      }
    },
  });

  /**
   * POST /connect/v2/webhooks
   */
  fastify.post("/connect/v2/webhooks", {
    config: {
      rawBody: true,
    },
    handler: async (request, reply) => {
      const signature = request.headers["stripe-signature"] as string | undefined;
      if (!signature) {
        return reply.status(400).send({ error: "Assinatura ausente" });
      }

      try {
        const stripeClient = getStripeClient();
        const event = stripeClient.webhooks.constructEvent(
          (request as any).rawBody,
          signature,
          getConnectWebhookSecret()
        );

        const upsertSubscription = async (
          subscription: Stripe.Subscription,
          sourceEvent: Stripe.Event
        ) => {
          const accountId = resolveAccountIdFromEvent(sourceEvent, null);
          if (!accountId) return;

          const existing = await db.query.connectedAccountSubscriptions.findFirst(
            {
              where: eq(
                connectedAccountSubscriptions.stripeSubscriptionId,
                subscription.id
              ),
            }
          );

          const user = await db.query.users.findFirst({
            where: eq(users.stripeAccountId, accountId),
          });

          const payload = {
            userId: user?.id || null,
            stripeAccountId: accountId,
            stripeSubscriptionId: subscription.id,
            priceId: subscription.items.data[0]?.price?.id || null,
            quantity: subscription.items.data[0]?.quantity || null,
            status: subscription.status,
            currentPeriodStart: subscription.current_period_start
              ? new Date(subscription.current_period_start * 1000)
              : null,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
            metadata: JSON.stringify(subscription.metadata || {}),
            updatedAt: new Date(),
          };

          if (existing) {
            await db
              .update(connectedAccountSubscriptions)
              .set(payload)
              .where(
                eq(
                  connectedAccountSubscriptions.stripeSubscriptionId,
                  subscription.id
                )
              );
            return;
          }

          await db.insert(connectedAccountSubscriptions).values(payload);
        };

        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const accountId = resolveAccountIdFromEvent(event, null);
            if (!accountId || session.mode !== "payment") break;

            const existing = await db.query.connectedAccountPurchases.findFirst({
              where: eq(
                connectedAccountPurchases.stripeCheckoutSessionId,
                session.id
              ),
            });

            if (existing) break;

            await db.insert(connectedAccountPurchases).values({
              stripeAccountId: accountId,
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id || null,
              productId: session.metadata?.productId || null,
              priceId: session.metadata?.priceId || null,
              amountInCents: session.amount_total || null,
              currency: session.currency || null,
              customerEmail:
                session.customer_details?.email || session.customer_email || null,
              status: session.payment_status || "unknown",
              metadata: JSON.stringify(session.metadata || {}),
            });
            break;
          }
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            const subscription = event.data.object as Stripe.Subscription;
            await upsertSubscription(subscription, event);
            break;
          }
          case "payment_method.attached":
          case "payment_method.detached":
          case "customer.updated":
          case "customer.tax_id.created":
          case "customer.tax_id.deleted":
          case "customer.tax_id.updated":
          case "billing_portal.configuration.created":
          case "billing_portal.configuration.updated":
          case "billing_portal.session.created":
            break;
          default:
            break;
        }

        return { received: true };
      } catch (error: any) {
        console.error("Error processing webhook:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao processar webhook",
        });
      }
    },
  });
}
