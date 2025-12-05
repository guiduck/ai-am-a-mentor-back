/**
 * Subscription Routes
 * Handles subscription plans, user subscriptions, and usage tracking
 */

import { FastifyInstance } from "fastify";
import {
  getSubscriptionPlans,
  getUserSubscription,
  getUserUsageStatus,
  createSubscriptionCheckout,
  createUserSubscription,
  cancelSubscription,
  canPerformAction,
  getPlanByName,
} from "../../services/subscriptions";

export async function subscriptionRoutes(fastify: FastifyInstance) {
  // Get all available plans
  fastify.get("/subscriptions/plans", {
    handler: async (request, reply) => {
      try {
        const { type } = request.query as { type?: "creator" | "student" };
        const plans = await getSubscriptionPlans(type);

        return {
          plans,
        };
      } catch (error: any) {
        console.error("Error fetching plans:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Get user's current subscription
  fastify.get("/subscriptions/me", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const subscription = await getUserSubscription(userId);
        const usage = await getUserUsageStatus(userId);

        return {
          subscription,
          usage,
        };
      } catch (error: any) {
        console.error("Error fetching subscription:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Check if user can perform action
  fastify.get("/subscriptions/can-perform/:action", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { action } = request.params as { action: string };

        const validActions = ["create_course", "upload_video", "generate_quiz", "ask_ai"];
        if (!validActions.includes(action)) {
          return reply.status(400).send({ error: "Ação inválida" });
        }

        const result = await canPerformAction(
          userId,
          action as "create_course" | "upload_video" | "generate_quiz" | "ask_ai"
        );

        return result;
      } catch (error: any) {
        console.error("Error checking permission:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Create checkout session for subscription
  fastify.post("/subscriptions/checkout", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const email = request.user.email;
        const { planId } = request.body as { planId: string };

        if (!planId) {
          return reply.status(400).send({ error: "planId é obrigatório" });
        }

        const result = await createSubscriptionCheckout(userId, planId, email);

        if ("error" in result) {
          return reply.status(400).send({ error: result.error });
        }

        return { sessionUrl: result.sessionUrl };
      } catch (error: any) {
        console.error("Error creating checkout:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Subscribe to free plan
  fastify.post("/subscriptions/subscribe-free", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const userRole = request.user.role;

        const planName = userRole === "creator" ? "creator_free" : "student_free";
        const plan = await getPlanByName(planName);

        if (!plan) {
          return reply.status(404).send({ error: "Plano gratuito não encontrado" });
        }

        const result = await createUserSubscription(userId, plan.id);

        if ("error" in result) {
          return reply.status(400).send({ error: result.error });
        }

        return {
          success: true,
          message: "Inscrito no plano gratuito com sucesso!",
          subscriptionId: result.subscriptionId,
        };
      } catch (error: any) {
        console.error("Error subscribing to free plan:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Cancel subscription
  fastify.post("/subscriptions/cancel", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { immediate } = request.body as { immediate?: boolean };

        const result = await cancelSubscription(userId, immediate || false);

        if ("error" in result) {
          return reply.status(400).send({ error: result.error });
        }

        return {
          success: true,
          message: immediate
            ? "Assinatura cancelada imediatamente"
            : "Assinatura será cancelada ao final do período",
        };
      } catch (error: any) {
        console.error("Error cancelling subscription:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // NOTE: Leads route is handled by leads.routes.ts

  // ============================================================================
  // WEBHOOK (Stripe subscription events)
  // ============================================================================

  fastify.post("/subscriptions/webhook", {
    config: {
      rawBody: true,
    },
    handler: async (request, reply) => {
      const signature = request.headers["stripe-signature"] as string;

      if (!signature) {
        return reply.status(400).send({ error: "Missing signature" });
      }

      try {
        const Stripe = require("stripe");
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

        const event = stripe.webhooks.constructEvent(
          (request as any).rawBody,
          signature,
          process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
        );

        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object;
            const { userId, planId } = session.metadata;

            if (session.mode === "subscription" && userId && planId) {
              await createUserSubscription(
                userId,
                planId,
                session.subscription,
                session.customer
              );
              console.log(`✅ Subscription created for user ${userId}`);
            }
            break;
          }

          case "customer.subscription.updated": {
            const subscription = event.data.object;
            // Handle subscription updates (status changes, etc.)
            console.log(`📝 Subscription updated: ${subscription.id}`);
            break;
          }

          case "customer.subscription.deleted": {
            const subscription = event.data.object;
            // Handle subscription cancellation
            console.log(`❌ Subscription cancelled: ${subscription.id}`);
            break;
          }

          case "invoice.payment_failed": {
            const invoice = event.data.object;
            // Handle failed payment
            console.log(`💳 Payment failed for invoice: ${invoice.id}`);
            break;
          }
        }

        return { received: true };
      } catch (error: any) {
        console.error("Webhook error:", error);
        return reply.status(400).send({ error: error.message });
      }
    },
  });
}
