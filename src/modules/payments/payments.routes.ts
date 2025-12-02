/**
 * Payments Routes
 * Handles payment processing, credits, and transactions
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import {
  payments,
  users,
  courses,
  enrollments,
  coursePurchases,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";
import {
  createCreditsPaymentIntent,
  createCoursePaymentIntent,
  verifyPaymentIntent,
  getOrCreateCustomer,
} from "../../services/stripe";
import {
  getUserCredits,
  initializeUserCredits,
  addCredits,
  deductCredits,
  getUserTransactions,
} from "../../services/credits";

// ============================================================================
// Validation Schemas
// ============================================================================

const createCreditsPaymentSchema = z.object({
  amount: z.number().positive().min(1),
  creditsAmount: z.number().int().positive().min(1),
});

const createCoursePaymentSchema = z.object({
  courseId: z.string().uuid(),
  amount: z.number().positive().min(0.01),
});

const confirmPaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
});

const purchaseWithCreditsSchema = z.object({
  courseId: z.string().uuid(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle Zod validation errors
 */
function handleValidationError(reply: any, error: any) {
  if (error.name === "ZodError") {
    return reply.status(400).send({
      error: "Dados inválidos",
      details: error.errors,
    });
  }
  throw error;
}

/**
 * Get user by ID with error handling
 */
async function getUserById(userId: string) {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

/**
 * Get course by ID with error handling
 */
async function getCourseById(courseId: string) {
  return db.query.courses.findFirst({
    where: eq(courses.id, courseId),
  });
}

/**
 * Check if user is enrolled in a course
 */
async function isUserEnrolled(userId: string, courseId: string) {
  const enrollment = await db.query.enrollments.findFirst({
    where: and(eq(enrollments.studentId, userId), eq(enrollments.courseId, courseId)),
  });
  return !!enrollment;
}

/**
 * Create enrollment for user in course
 */
async function createEnrollment(userId: string, courseId: string) {
  return db.insert(enrollments).values({
    studentId: userId,
    courseId,
  });
}

// ============================================================================
// Routes
// ============================================================================

export async function paymentRoutes(fastify: FastifyInstance) {
  // --------------------------------------------------------------------------
  // Credits Routes
  // --------------------------------------------------------------------------

  /**
   * GET /credits/balance - Get user's credit balance
   */
  fastify.get("/credits/balance", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        await initializeUserCredits(userId);
        const balance = await getUserCredits(userId);

        return { balance, userId };
      } catch (error: any) {
        console.error("Error getting credit balance:", error);
        return reply.status(500).send({
          error: "Falha ao obter saldo de créditos",
        });
      }
    },
  });

  /**
   * GET /credits/transactions - Get user's transaction history
   */
  fastify.get("/credits/transactions", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const transactions = await getUserTransactions(request.user.id, 50);
        return transactions;
      } catch (error: any) {
        console.error("Error getting transactions:", error);
        return reply.status(500).send({
          error: "Falha ao obter histórico de transações",
        });
      }
    },
  });

  // --------------------------------------------------------------------------
  // Payment Intent Routes
  // --------------------------------------------------------------------------

  /**
   * POST /payments/credits/create-intent - Create payment intent for credits
   */
  fastify.post("/payments/credits/create-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { amount, creditsAmount } = createCreditsPaymentSchema.parse(request.body);

        // Get user
        const user = await getUserById(userId);
        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        // Get or create Stripe customer
        const { customerId, error: customerError } = await getOrCreateCustomer(userId, user.email);
        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Falha ao criar cliente no Stripe",
          });
        }

        // Create payment intent
        const { clientSecret, paymentIntentId, error } = await createCreditsPaymentIntent(
          amount,
          userId,
          creditsAmount
        );
        if (error || !clientSecret) {
          return reply.status(500).send({
            error: error || "Falha ao criar intenção de pagamento",
          });
        }

        // Save payment record
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: paymentIntentId,
          stripeCustomerId: customerId,
          amount: amount.toString(),
          status: "pending",
          creditsAwarded: creditsAmount,
          paymentType: "credits",
        });

        return { clientSecret, paymentIntentId, amount, creditsAmount };
      } catch (error: any) {
        return handleValidationError(reply, error);
      }
    },
  });

  /**
   * POST /payments/course/create-intent - Create payment intent for course
   */
  fastify.post("/payments/course/create-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { courseId, amount } = createCoursePaymentSchema.parse(request.body);

        // Verify course exists
        const course = await getCourseById(courseId);
        if (!course) {
          return reply.status(404).send({ error: "Curso não encontrado" });
        }

        // Get user
        const user = await getUserById(userId);
        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        // Check if already enrolled
        if (await isUserEnrolled(userId, courseId)) {
          return reply.status(409).send({ error: "Você já está inscrito neste curso" });
        }

        // Get or create Stripe customer
        const { customerId, error: customerError } = await getOrCreateCustomer(userId, user.email);
        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Falha ao criar cliente no Stripe",
          });
        }

        // Create payment intent
        const { clientSecret, paymentIntentId, error } = await createCoursePaymentIntent(
          amount,
          userId,
          courseId
        );
        if (error || !clientSecret) {
          return reply.status(500).send({
            error: error || "Falha ao criar intenção de pagamento",
          });
        }

        // Save payment record
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: paymentIntentId,
          stripeCustomerId: customerId,
          amount: amount.toString(),
          status: "pending",
          paymentType: "course",
          courseId,
        });

        return { clientSecret, paymentIntentId, amount, courseId };
      } catch (error: any) {
        return handleValidationError(reply, error);
      }
    },
  });

  // --------------------------------------------------------------------------
  // Payment Confirmation Routes
  // --------------------------------------------------------------------------

  /**
   * POST /payments/confirm - Confirm payment after Stripe processes it
   */
  fastify.post("/payments/confirm", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { paymentIntentId } = confirmPaymentSchema.parse(request.body);

        // Verify payment with Stripe
        const { status, succeeded, error: verifyError } = await verifyPaymentIntent(paymentIntentId);
        if (verifyError) {
          return reply.status(500).send({ error: verifyError });
        }

        // Get payment record
        const payment = await db.query.payments.findFirst({
          where: eq(payments.stripePaymentIntentId, paymentIntentId),
        });
        if (!payment) {
          return reply.status(404).send({ error: "Pagamento não encontrado" });
        }

        // Verify ownership
        if (payment.userId !== userId) {
          return reply.status(403).send({ error: "Acesso negado" });
        }

        // Update payment status
        await db
          .update(payments)
          .set({ status: succeeded ? "succeeded" : status, updatedAt: new Date() })
          .where(eq(payments.stripePaymentIntentId, paymentIntentId));

        // If credits purchase succeeded, add credits
        if (succeeded && payment.paymentType === "credits" && payment.creditsAwarded) {
          await addCredits(
            userId,
            payment.creditsAwarded,
            `Compra de ${payment.creditsAwarded} créditos`,
            payment.id,
            "payment"
          );
        }

        // If course purchase succeeded, create enrollment
        if (succeeded && payment.paymentType === "course" && payment.courseId) {
          const alreadyEnrolled = await isUserEnrolled(userId, payment.courseId);
          if (!alreadyEnrolled) {
            await createEnrollment(userId, payment.courseId);
            await db.insert(coursePurchases).values({
              studentId: userId,
              courseId: payment.courseId,
              paymentMethod: "stripe",
              amount: payment.amount,
              paymentId: payment.id,
            });
          }
        }

        return { success: succeeded, status, paymentIntentId };
      } catch (error: any) {
        return handleValidationError(reply, error);
      }
    },
  });

  // --------------------------------------------------------------------------
  // Credit Purchase Routes
  // --------------------------------------------------------------------------

  /**
   * POST /payments/course/purchase-with-credits - Purchase course with credits
   */
  fastify.post("/payments/course/purchase-with-credits", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { courseId } = purchaseWithCreditsSchema.parse(request.body);

        // Get course
        const course = await getCourseById(courseId);
        if (!course) {
          return reply.status(404).send({ error: "Curso não encontrado" });
        }

        // Check if course can be purchased with credits
        if (!course.creditCost || course.creditCost <= 0) {
          return reply.status(400).send({
            error: "Este curso não pode ser comprado com créditos",
          });
        }

        // Check balance
        const balance = await getUserCredits(userId);
        if (balance < course.creditCost) {
          return reply.status(400).send({
            error: "Créditos insuficientes",
            required: course.creditCost,
            current: balance,
          });
        }

        // Check if already enrolled
        if (await isUserEnrolled(userId, courseId)) {
          return reply.status(409).send({ error: "Você já está inscrito neste curso" });
        }

        // Deduct credits
        const deductResult = await deductCredits(
          userId,
          course.creditCost,
          `Compra do curso: ${course.title}`,
          courseId,
          "course"
        );
        if (!deductResult.success) {
          return reply.status(500).send({
            error: deductResult.error || "Falha ao deduzir créditos",
          });
        }

        // Create enrollment
        await createEnrollment(userId, courseId);

        // Create purchase record
        await db.insert(coursePurchases).values({
          studentId: userId,
          courseId,
          paymentMethod: "credits",
          creditsUsed: course.creditCost,
          transactionId: deductResult.transactionId,
        });

        return {
          success: true,
          message: "Curso comprado com sucesso",
          creditsUsed: course.creditCost,
          newBalance: deductResult.newBalance,
        };
      } catch (error: any) {
        return handleValidationError(reply, error);
      }
    },
  });

  // --------------------------------------------------------------------------
  // Webhook Route
  // --------------------------------------------------------------------------

  /**
   * POST /payments/webhook - Stripe webhook handler
   */
  fastify.post("/payments/webhook", {
    handler: async (request, reply) => {
      try {
        const sig = request.headers["stripe-signature"] as string;
        const body = request.body;

        if (!process.env.STRIPE_WEBHOOK_SECRET) {
          console.error("STRIPE_WEBHOOK_SECRET not configured");
          return reply.status(500).send({ error: "Webhook not configured" });
        }

        // Verify webhook signature
        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
        const event = stripe.webhooks.constructEvent(
          body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );

        // Handle payment_intent.succeeded
        if (event.type === "payment_intent.succeeded") {
          const paymentIntent = event.data.object;
          const paymentIntentId = paymentIntent.id;

          const payment = await db.query.payments.findFirst({
            where: eq(payments.stripePaymentIntentId, paymentIntentId),
          });

          if (payment && payment.status !== "succeeded") {
            // Update status
            await db
              .update(payments)
              .set({ status: "succeeded", updatedAt: new Date() })
              .where(eq(payments.stripePaymentIntentId, paymentIntentId));

            // Add credits if applicable
            if (payment.paymentType === "credits" && payment.creditsAwarded) {
              await addCredits(
                payment.userId,
                payment.creditsAwarded,
                `Compra de ${payment.creditsAwarded} créditos`,
                payment.id,
                "payment"
              );
            }

            // Create enrollment if course purchase
            if (payment.paymentType === "course" && payment.courseId) {
              const alreadyEnrolled = await isUserEnrolled(payment.userId, payment.courseId);
              if (!alreadyEnrolled) {
                await createEnrollment(payment.userId, payment.courseId);
              }
            }
          }
        }

        return { received: true };
      } catch (error: any) {
        console.error("Webhook error:", error);
        return reply.status(400).send({ error: `Webhook Error: ${error.message}` });
      }
    },
  });
}
