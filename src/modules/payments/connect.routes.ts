/**
 * Stripe Connect Routes
 * Handles creator account setup and payment splitting
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import { users, courses, payments, enrollments } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import {
  createConnectAccount,
  createOnboardingLink,
  checkAccountStatus,
  createCoursePaymentWithSplit,
  calculateSplitAmounts,
  getCreatorDashboardLink,
  getCreatorBalance,
} from "../../services/stripe-connect";
import {
  createCoursePaymentIntent,
  getOrCreateCustomer,
} from "../../services/stripe";
import { getCreatorCommissionRate } from "../../services/subscriptions";
import { hasAcceptedCreatorTerms } from "../../services/creator-terms";

const paymentMethodSchema = z.enum(["card", "boleto"]).default("card");

export async function connectRoutes(fastify: FastifyInstance) {
  /**
   * POST /connect/create-account - Create Stripe Connect account for creator
   */
  fastify.post("/connect/create-account", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const userRole = request.user.role;

        // Only creators can create Connect accounts
        if (userRole !== "creator") {
          return reply.status(403).send({ error: "Apenas criadores podem cadastrar dados bancários" });
        }

        // Get user email
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        // Check if already has account
        if (user.stripeAccountId) {
          return reply.status(400).send({ 
            error: "Você já possui uma conta Stripe Connect",
            accountId: user.stripeAccountId,
          });
        }

        const result = await createConnectAccount(userId, user.email);
        
        if (result.error) {
          return reply.status(500).send({ error: result.error });
        }

        return {
          message: "Conta criada com sucesso",
          accountId: result.accountId,
        };
      } catch (error: any) {
        console.error("Error creating Connect account:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * POST /connect/onboarding-link - Get onboarding link for Stripe setup
   */
  fastify.post("/connect/onboarding-link", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { returnUrl, refreshUrl } = z.object({
          returnUrl: z.string().url(),
          refreshUrl: z.string().url(),
        }).parse(request.body);

        // Get user
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user || !user.stripeAccountId) {
          return reply.status(400).send({ 
            error: "Você precisa criar uma conta Connect primeiro" 
          });
        }

        const result = await createOnboardingLink(
          user.stripeAccountId,
          returnUrl,
          refreshUrl
        );
        
        if (result.error) {
          return reply.status(500).send({ error: result.error });
        }

        return { url: result.url };
      } catch (error: any) {
        console.error("Error creating onboarding link:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /connect/status - Check creator's Connect account status
   */
  fastify.get("/connect/status", {
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

        if (!user.stripeAccountId) {
          return {
            hasAccount: false,
            isComplete: false,
            chargesEnabled: false,
            payoutsEnabled: false,
          };
        }

        const status = await checkAccountStatus(user.stripeAccountId);

        return {
          hasAccount: true,
          accountId: user.stripeAccountId,
          ...status,
        };
      } catch (error: any) {
        console.error("Error checking Connect status:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /connect/dashboard-link - Get link to creator's Stripe dashboard
   */
  fastify.get("/connect/dashboard-link", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user || !user.stripeAccountId) {
          return reply.status(400).send({ 
            error: "Você não possui uma conta Connect configurada" 
          });
        }

        const result = await getCreatorDashboardLink(user.stripeAccountId);
        
        if (result.error) {
          return reply.status(500).send({ error: result.error });
        }

        return { url: result.url };
      } catch (error: any) {
        console.error("Error getting dashboard link:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /connect/balance - Get creator's balance
   */
  fastify.get("/connect/balance", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user || !user.stripeAccountId) {
          return reply.status(400).send({ 
            error: "Você não possui uma conta Connect configurada" 
          });
        }

        const balance = await getCreatorBalance(user.stripeAccountId);
        
        if (balance.error) {
          return reply.status(500).send({ error: balance.error });
        }

        return balance;
      } catch (error: any) {
        console.error("Error getting balance:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * POST /connect/purchase-course - Buy course with creator payment split
   */
  fastify.post("/connect/purchase-course", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { courseId, paymentMethod } = z.object({
          courseId: z.string().uuid(),
          paymentMethod: paymentMethodSchema,
        }).parse(request.body);

        // Get course with creator info
        const course = await db.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });

        if (!course) {
          return reply.status(404).send({ error: "Curso não encontrado" });
        }

        const coursePrice = parseFloat(course.price);
        if (!Number.isFinite(coursePrice) || coursePrice <= 0) {
          return reply.status(400).send({
            error: "Cursos gratuitos não estão disponíveis no MVP",
          });
        }

        // Check if already enrolled
        const existingEnrollment = await db.query.enrollments.findFirst({
          where: and(
            eq(enrollments.studentId, userId),
            eq(enrollments.courseId, courseId)
          ),
        });

        if (existingEnrollment) {
          return reply.status(409).send({
            error: "Você já está inscrito neste curso",
          });
        }

        const creator = await db.query.users.findFirst({
          where: eq(users.id, course.creatorId),
        });

        if (!creator) {
          return reply.status(404).send({ error: "Criador não encontrado" });
        }

        const hasAcceptedTerms = await hasAcceptedCreatorTerms(creator.id);
        if (!hasAcceptedTerms) {
          return reply.status(400).send({
            error:
              "O criador deste curso ainda não aceitou os termos de venda",
          });
        }

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        const { customerId, error: customerError } = await getOrCreateCustomer(
          userId,
          user.email
        );
        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Falha ao criar cliente no Stripe",
          });
        }

        const commissionRate = await getCreatorCommissionRate(creator.id);
        const splitAmounts = calculateSplitAmounts(
          coursePrice,
          commissionRate
        );
        let payoutStatus: "split" | "pending_onboarding" = "pending_onboarding";
        let result:
          | {
              clientSecret: string;
              paymentIntentId: string;
              platformFee: number;
              creatorAmount: number;
              boletoUrl?: string;
              boletoNumber?: string;
              boletoExpiresAt?: number;
              error?: string;
            }
          | undefined;

        if (creator.stripeAccountId) {
          const accountStatus = await checkAccountStatus(
            creator.stripeAccountId
          );

          if (accountStatus.isComplete) {
            const splitResult = await createCoursePaymentWithSplit(
              coursePrice,
              userId,
              courseId,
              creator.stripeAccountId,
              commissionRate,
              paymentMethod,
              customerId
            );

            if (splitResult.error || !splitResult.clientSecret) {
              return reply.status(500).send({
                error: splitResult.error || "Falha ao criar pagamento",
              });
            }

            result = splitResult;
            payoutStatus = "split";
          }
        }

        if (!result) {
          const intentResult = await createCoursePaymentIntent(
            coursePrice,
            userId,
            courseId,
            paymentMethod
          );

          if (intentResult.error || !intentResult.clientSecret) {
            return reply.status(500).send({
              error: intentResult.error || "Falha ao criar intenção de pagamento",
            });
          }

          result = {
            clientSecret: intentResult.clientSecret,
            paymentIntentId: intentResult.paymentIntentId,
            platformFee: splitAmounts.platformFee,
            creatorAmount: splitAmounts.creatorAmount,
            boletoUrl: intentResult.boletoUrl,
            boletoNumber: intentResult.boletoNumber,
            boletoExpiresAt: intentResult.boletoExpiresAt,
          };
        }

        // Save payment record
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: result.paymentIntentId,
          stripeCustomerId: customerId,
          amount: coursePrice.toString(),
          status: "pending",
          paymentType: "course",
          courseId,
          metadata: JSON.stringify({
            paymentMethod,
            platformFee: splitAmounts.platformFee,
            creatorAmount: splitAmounts.creatorAmount,
            commissionRate,
            payoutStatus,
            creatorId: creator.id,
            creatorStripeAccountId: creator.stripeAccountId || null,
          }),
        });

        return {
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId,
          amount: coursePrice,
          platformFee: result.platformFee,
          creatorAmount: result.creatorAmount,
          paymentMethod,
          payoutStatus,
        };
      } catch (error: any) {
        console.error("Error purchasing course:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });
}
