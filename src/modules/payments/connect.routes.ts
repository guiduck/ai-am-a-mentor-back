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
  getCreatorDashboardLink,
  getCreatorBalance,
} from "../../services/stripe-connect";

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

        // Get creator's Stripe account
        const creator = await db.query.users.findFirst({
          where: eq(users.id, course.creatorId),
        });

        if (!creator || !creator.stripeAccountId) {
          return reply.status(400).send({ 
            error: "O criador deste curso ainda não configurou o recebimento de pagamentos" 
          });
        }

        // Check creator account status
        const accountStatus = await checkAccountStatus(creator.stripeAccountId);
        if (!accountStatus.isComplete) {
          return reply.status(400).send({ 
            error: "O criador deste curso ainda não completou a configuração bancária" 
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
          return reply.status(400).send({ error: "Você já está matriculado neste curso" });
        }

        const amount = parseFloat(course.price);
        if (amount <= 0) {
          // Free course - just enroll
          await db.insert(enrollments).values({
            studentId: userId,
            courseId,
          });
          return { message: "Matriculado com sucesso em curso gratuito" };
        }

        // Create payment with split
        const result = await createCoursePaymentWithSplit(
          amount,
          userId,
          courseId,
          creator.stripeAccountId,
          paymentMethod
        );

        if (result.error) {
          return reply.status(500).send({ error: result.error });
        }

        // Save payment record
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: result.paymentIntentId,
          amount: amount.toString(),
          status: "pending",
          paymentType: "course",
          courseId,
          metadata: JSON.stringify({
            paymentMethod,
            platformFee: result.platformFee,
            creatorAmount: result.creatorAmount,
            creatorAccountId: creator.stripeAccountId,
          }),
        });

        return {
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId,
          amount,
          platformFee: result.platformFee,
          creatorAmount: result.creatorAmount,
          paymentMethod,
        };
      } catch (error: any) {
        console.error("Error purchasing course:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });
}

