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
  creatorTermsAcceptances,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";
import {
  createCreditsPaymentIntent,
  createCoursePaymentIntent,
  createCardSetupIntent,
  hasCustomerCard,
  verifyPaymentIntent,
  getOrCreateCustomer,
} from "../../services/stripe";
import { resolvePaymentAmount } from "../../services/payment-bypass";
import {
  getUserCreditBalance,
  getUserCredits,
  addCredits,
  deductCredits,
  getUserTransactions,
} from "../../services/credits";
import {
  checkAccountStatus,
  createCoursePaymentWithSplit,
  calculateSplitAmounts,
} from "../../services/stripe-connect";
import {
  ensureSubscriptionCredits,
  getCreatorCommissionRate,
} from "../../services/subscriptions";
import {
  CREATOR_TERMS,
  getCreatorTermsAcceptance,
} from "../../services/creator-terms";

// ============================================================================
// Validation Schemas
// ============================================================================

const paymentMethodSchema = z.enum(["card", "boleto"]).default("card");

const createCreditsPaymentSchema = z.object({
  amount: z.number().positive().min(1),
  creditsAmount: z.number().int().positive().min(1),
  paymentMethod: paymentMethodSchema,
});

const createCoursePaymentSchema = z.object({
  courseId: z.string().uuid(),
  paymentMethod: paymentMethodSchema,
});

const confirmPaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
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
 * Resolve the client IP address from headers or socket.
 */
function resolveRequestIp(request: any): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.ip || request.socket?.remoteAddress || "0.0.0.0";
}

/**
 * Try to apply subscription credits without crashing on missing export.
 */
async function ensureSubscriptionCreditsSafely(userId: string): Promise<void> {
  if (typeof ensureSubscriptionCredits !== "function") {
    console.error(
      "ensureSubscriptionCredits indisponível. Verifique build/deploy do serviço."
    );
    return;
  }

  await ensureSubscriptionCredits(userId);
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
    where: and(
      eq(enrollments.studentId, userId),
      eq(enrollments.courseId, courseId)
    ),
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

/**
 * Parse and validate course price.
 */
function parseCoursePrice(price: string): number | null {
  const parsed = parseFloat(price);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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
        await ensureSubscriptionCreditsSafely(userId);
        const creditBalance = await getUserCreditBalance(userId);

        return {
          balance: creditBalance.balance,
          userId,
          expiresAt: creditBalance.expiresAt
            ? creditBalance.expiresAt.toISOString()
            : null,
          expiresInDays: creditBalance.expiresInDays,
        };
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
  // Creator Terms Routes
  // --------------------------------------------------------------------------

  /**
   * GET /payments/creator-terms - Get creator terms and acceptance status
   */
  fastify.get("/payments/creator-terms", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        if (request.user.role !== "creator") {
          return reply.status(403).send({
            error: "Apenas criadores podem acessar os termos de venda",
          });
        }

        const acceptance = await getCreatorTermsAcceptance(request.user.id);

        return {
          version: CREATOR_TERMS.version,
          title: CREATOR_TERMS.title,
          items: CREATOR_TERMS.items,
          accepted: !!acceptance,
          acceptedAt: acceptance?.acceptedAt || null,
        };
      } catch (error: any) {
        console.error("Error getting creator terms:", error);
        return reply.status(500).send({
          error: "Falha ao obter termos de venda",
        });
      }
    },
  });

  /**
   * POST /payments/creator-terms/accept - Accept creator terms
   */
  fastify.post("/payments/creator-terms/accept", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        if (request.user.role !== "creator") {
          return reply.status(403).send({
            error: "Apenas criadores podem aceitar os termos de venda",
          });
        }

        const schema = z.object({
          version: z.string().optional(),
        });
        const { version } = schema.parse(request.body || {});

        if (version && version !== CREATOR_TERMS.version) {
          return reply.status(400).send({
            error: "Versão dos termos inválida",
          });
        }

        const existing = await getCreatorTermsAcceptance(request.user.id);
        if (existing) {
          return {
            accepted: true,
            version: CREATOR_TERMS.version,
            acceptedAt: existing.acceptedAt,
          };
        }

        const acceptedIp = resolveRequestIp(request);
        const acceptedAt = new Date();

        await db.insert(creatorTermsAcceptances).values({
          creatorId: request.user.id,
          termsVersion: CREATOR_TERMS.version,
          acceptedIp,
          acceptedAt,
        });

        return {
          accepted: true,
          version: CREATOR_TERMS.version,
          acceptedAt,
        };
      } catch (error: any) {
        return handleValidationError(reply, error);
      }
    },
  });

  // --------------------------------------------------------------------------
  // Payment Intent Routes
  // --------------------------------------------------------------------------

  /**
   * POST /payments/credits/create-intent - Create payment intent for credits
   * Supports both card and boleto payments
   */
  fastify.post("/payments/credits/create-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { amount, creditsAmount, paymentMethod } =
          createCreditsPaymentSchema.parse(request.body);

        // Get user
        const user = await getUserById(userId);
        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        const {
          amount: chargeAmount,
          bypassApplied,
          originalAmount,
        } = resolvePaymentAmount(amount, user.email);

        // Get or create Stripe customer
        const { customerId, error: customerError } = await getOrCreateCustomer(
          userId,
          user.email
        );
        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Falha ao criar cliente no Stripe",
          });
        }

        if (paymentMethod === "card") {
          const hasCard = await hasCustomerCard(customerId);
          if (!hasCard) {
            return reply.status(409).send({
              error:
                "Você precisa cadastrar um cartão para continuar. Vamos te levar para esse passo.",
              code: "CARD_REQUIRED",
            });
          }
        }

        // Create payment intent with specified method (card or boleto)
        const result = await createCreditsPaymentIntent(
          chargeAmount,
          userId,
          creditsAmount,
          paymentMethod
        );

        if (result.error || !result.clientSecret) {
          return reply.status(500).send({
            error: result.error || "Falha ao criar intenção de pagamento",
          });
        }

        // Save payment record
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: result.paymentIntentId,
          stripeCustomerId: customerId,
          amount: chargeAmount.toString(),
          status: "pending",
          creditsAwarded: creditsAmount,
          paymentType: "credits",
          metadata: JSON.stringify({
            paymentMethod,
            bypassApplied,
            originalAmount,
          }),
        });

        return {
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId,
          amount: chargeAmount,
          creditsAmount,
          paymentMethod,
          // Boleto specific data
          boletoUrl: result.boletoUrl,
          boletoNumber: result.boletoNumber,
          boletoExpiresAt: result.boletoExpiresAt,
        };
      } catch (error: any) {
        return handleValidationError(reply, error);
      }
    },
  });

  /**
   * POST /payments/course/create-intent - Create payment intent for course
   * Supports both card and boleto payments
   */
  fastify.post("/payments/course/create-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { courseId, paymentMethod } = createCoursePaymentSchema.parse(
          request.body
        );

        // Verify course exists
        const course = await getCourseById(courseId);
        if (!course) {
          return reply.status(404).send({ error: "Curso não encontrado" });
        }

        const coursePrice = parseCoursePrice(course.price);
        if (!coursePrice) {
          return reply.status(400).send({
            error: "Cursos gratuitos não estão disponíveis no MVP",
          });
        }

        // Get user
        const user = await getUserById(userId);
        if (!user) {
          return reply.status(404).send({ error: "Usuário não encontrado" });
        }

        // Check if already enrolled
        if (await isUserEnrolled(userId, courseId)) {
          return reply
            .status(409)
            .send({ error: "Você já está inscrito neste curso" });
        }

        const creator = await getUserById(course.creatorId);
        if (!creator) {
          return reply.status(404).send({ error: "Criador não encontrado" });
        }

        const termsAcceptance = await getCreatorTermsAcceptance(creator.id);
        if (!termsAcceptance) {
          return reply.status(400).send({
            error: "O criador deste curso ainda não aceitou os termos de venda",
            code: "CREATOR_TERMS_REQUIRED",
          });
        }

        // Get or create Stripe customer
        const { customerId, error: customerError } = await getOrCreateCustomer(
          userId,
          user.email
        );
        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Falha ao criar cliente no Stripe",
          });
        }

        if (paymentMethod === "card") {
          const hasCard = await hasCustomerCard(customerId);
          if (!hasCard) {
            return reply.status(409).send({
              error:
                "Você precisa cadastrar um cartão para continuar. Vamos te levar para esse passo.",
              code: "CARD_REQUIRED",
            });
          }
        }

        const {
          amount: chargeAmount,
          bypassApplied,
          originalAmount,
        } = resolvePaymentAmount(coursePrice, user.email);
        const commissionRate = await getCreatorCommissionRate(creator.id);
        const splitAmounts = calculateSplitAmounts(
          chargeAmount,
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
              chargeAmount,
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
            chargeAmount,
            userId,
            courseId,
            paymentMethod
          );

          if (intentResult.error || !intentResult.clientSecret) {
            return reply.status(500).send({
              error:
                intentResult.error || "Falha ao criar intenção de pagamento",
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
          amount: chargeAmount.toString(),
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
            bypassApplied,
            originalAmount,
          }),
        });

        return {
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId,
          amount: chargeAmount,
          courseId,
          paymentMethod,
          platformFee: result.platformFee,
          creatorAmount: result.creatorAmount,
          payoutStatus,
          // Boleto specific data
          boletoUrl: result.boletoUrl,
          boletoNumber: result.boletoNumber,
          boletoExpiresAt: result.boletoExpiresAt,
        };
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
        const {
          status,
          succeeded,
          error: verifyError,
        } = await verifyPaymentIntent(paymentIntentId);
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
          .set({
            status: succeeded ? "succeeded" : status,
            updatedAt: new Date(),
          })
          .where(eq(payments.stripePaymentIntentId, paymentIntentId));

        // If credits purchase succeeded, add credits
        if (
          succeeded &&
          payment.paymentType === "credits" &&
          payment.creditsAwarded
        ) {
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
          const alreadyEnrolled = await isUserEnrolled(
            userId,
            payment.courseId
          );
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
  // AI Credits Usage (for questions and quiz generation)
  // --------------------------------------------------------------------------

  /**
   * POST /payments/ai/use-credits - Use credits for AI features
   * This is used for:
   * - Students asking questions (costs based on tokens)
   * - Creators generating quizzes (fixed cost)
   */
  fastify.post("/payments/ai/use-credits", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        await ensureSubscriptionCreditsSafely(userId);
        const schema = z.object({
          amount: z.number().int().positive(),
          feature: z.enum(["question", "quiz_generation"]),
          description: z.string().optional(),
          entityId: z.string().optional(),
        });

        const { amount, feature, description, entityId } = schema.parse(
          request.body
        );

        // Check balance
        const balance = await getUserCredits(userId);
        if (balance < amount) {
          return reply.status(400).send({
            error: "Créditos insuficientes",
            required: amount,
            current: balance,
          });
        }

        // Deduct credits
        const deductResult = await deductCredits(
          userId,
          amount,
          description || `Uso de IA: ${feature}`,
          entityId,
          feature
        );

        if (!deductResult.success) {
          return reply.status(500).send({
            error: deductResult.error || "Falha ao deduzir créditos",
          });
        }

        return {
          success: true,
          creditsUsed: amount,
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
          return reply.status(500).send({ error: "Webhook nao configurado" });
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

            // Create enrollment + purchase record if course purchase
            if (payment.paymentType === "course" && payment.courseId) {
              const existingPurchase = await db.query.coursePurchases.findFirst(
                {
                  where: eq(coursePurchases.paymentId, payment.id),
                }
              );

              if (!existingPurchase) {
                await db.insert(coursePurchases).values({
                  studentId: payment.userId,
                  courseId: payment.courseId,
                  paymentMethod: "stripe",
                  amount: payment.amount,
                  paymentId: payment.id,
                });
              }

              const alreadyEnrolled = await isUserEnrolled(
                payment.userId,
                payment.courseId
              );
              if (!alreadyEnrolled) {
                await createEnrollment(payment.userId, payment.courseId);
              }
            }
          }
        }

        return { received: true };
      } catch (error: any) {
        console.error("Webhook error:", error);
        return reply
          .status(400)
          .send({ error: `Webhook Error: ${error.message}` });
      }
    },
  });

  // --------------------------------------------------------------------------
  // Card Setup Routes
  // --------------------------------------------------------------------------

  /**
   * POST /payments/cards/setup-intent - Create setup intent for saving a card
   */
  fastify.post("/payments/cards/setup-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const user = await getUserById(userId);
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

        const setupIntent = await createCardSetupIntent(customerId);
        if (setupIntent.error || !setupIntent.clientSecret) {
          return reply.status(500).send({
            error: setupIntent.error || "Falha ao iniciar cadastro de cartão",
          });
        }

        return {
          clientSecret: setupIntent.clientSecret,
          setupIntentId: setupIntent.setupIntentId,
        };
      } catch (error: any) {
        console.error("Error creating setup intent:", error);
        return reply.status(500).send({
          error: error.message || "Falha ao iniciar cadastro de cartão",
        });
      }
    },
  });
}
