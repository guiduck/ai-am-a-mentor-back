/**
 * Payments Routes
 * Handles payment processing, credits, and transactions
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import { payments, userCredits, users, courses } from "../../db/schema";
import { eq } from "drizzle-orm";
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

// Validation schemas
const createCreditsPaymentSchema = z.object({
  amount: z.number().positive().min(1), // Amount in reais
  creditsAmount: z.number().int().positive().min(1), // Credits to award
});

const createCoursePaymentSchema = z.object({
  courseId: z.string().uuid(),
  amount: z.number().positive().min(0.01), // Amount in reais
});

const confirmPaymentSchema = z.object({
  paymentIntentId: z.string(),
});

export async function paymentRoutes(fastify: FastifyInstance) {
  // Get user's credit balance
  fastify.get("/credits/balance", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        // Initialize if needed
        await initializeUserCredits(userId);

        const balance = await getUserCredits(userId);

        return {
          balance,
          userId,
        };
      } catch (error: any) {
        console.error("Error getting credit balance:", error);
        return reply.status(500).send({
          error: error.message || "Failed to get credit balance",
        });
      }
    },
  });

  // Get user's transaction history
  fastify.get("/credits/transactions", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const transactions = await getUserTransactions(userId, 50);

        return transactions;
      } catch (error: any) {
        console.error("Error getting transactions:", error);
        return reply.status(500).send({
          error: error.message || "Failed to get transactions",
        });
      }
    },
  });

  // Create payment intent for purchasing credits
  fastify.post("/payments/credits/create-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { amount, creditsAmount } = createCreditsPaymentSchema.parse(
          request.body
        );

        // Get user email for Stripe customer
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Get or create Stripe customer
        const { customerId, error: customerError } = await getOrCreateCustomer(
          userId,
          user.email
        );

        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Failed to create customer",
          });
        }

        // Create payment intent
        const { clientSecret, paymentIntentId, error } =
          await createCreditsPaymentIntent(amount, userId, creditsAmount);

        if (error || !clientSecret) {
          return reply.status(500).send({
            error: error || "Failed to create payment intent",
          });
        }

        // Create payment record in database
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: paymentIntentId,
          stripeCustomerId: customerId,
          amount: amount.toString(),
          status: "pending",
          creditsAwarded: creditsAmount,
          paymentType: "credits",
        });

        return {
          clientSecret,
          paymentIntentId,
          amount,
          creditsAmount,
        };
      } catch (error: any) {
        console.error("Error creating credits payment intent:", error);
        if (error.name === "ZodError") {
          return reply.status(400).send({
            error: "Invalid request data",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          error: error.message || "Failed to create payment intent",
        });
      }
    },
  });

  // Create payment intent for purchasing a course
  fastify.post("/payments/course/create-intent", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { courseId, amount } = createCoursePaymentSchema.parse(
          request.body
        );

        // Verify course exists
        const course = await db.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });

        if (!course) {
          return reply.status(404).send({ error: "Course not found" });
        }

        // Get user email
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }

        // Get or create Stripe customer
        const { customerId, error: customerError } = await getOrCreateCustomer(
          userId,
          user.email
        );

        if (customerError || !customerId) {
          return reply.status(500).send({
            error: customerError || "Failed to create customer",
          });
        }

        // Create payment intent
        const { clientSecret, paymentIntentId, error } =
          await createCoursePaymentIntent(amount, userId, courseId);

        if (error || !clientSecret) {
          return reply.status(500).send({
            error: error || "Failed to create payment intent",
          });
        }

        // Create payment record
        await db.insert(payments).values({
          userId,
          stripePaymentIntentId: paymentIntentId,
          stripeCustomerId: customerId,
          amount: amount.toString(),
          status: "pending",
          paymentType: "course",
          courseId,
        });

        return {
          clientSecret,
          paymentIntentId,
          amount,
          courseId,
        };
      } catch (error: any) {
        console.error("Error creating course payment intent:", error);
        if (error.name === "ZodError") {
          return reply.status(400).send({
            error: "Invalid request data",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          error: error.message || "Failed to create payment intent",
        });
      }
    },
  });

  // Confirm payment (webhook or manual confirmation)
  fastify.post("/payments/confirm", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { paymentIntentId } = confirmPaymentSchema.parse(request.body);

        // Verify payment intent
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
          return reply.status(404).send({ error: "Payment not found" });
        }

        // Verify user owns this payment
        if (payment.userId !== userId) {
          return reply.status(403).send({
            error: "You don't have access to this payment",
          });
        }

        // Update payment status
        await db
          .update(payments)
          .set({
            status: succeeded ? "succeeded" : status,
            updatedAt: new Date(),
          })
          .where(eq(payments.stripePaymentIntentId, paymentIntentId));

        // If succeeded and it's a credits purchase, add credits
        if (
          succeeded &&
          payment.paymentType === "credits" &&
          payment.creditsAwarded
        ) {
          await addCredits(
            userId,
            payment.creditsAwarded,
            `Purchase of ${payment.creditsAwarded} credits`,
            payment.id,
            "payment"
          );
        }

        return {
          success: succeeded,
          status,
          paymentIntentId,
        };
      } catch (error: any) {
        console.error("Error confirming payment:", error);
        if (error.name === "ZodError") {
          return reply.status(400).send({
            error: "Invalid request data",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          error: error.message || "Failed to confirm payment",
        });
      }
    },
  });

  // Stripe webhook handler (for automatic payment confirmation)
  fastify.post("/payments/webhook", {
    handler: async (request, reply) => {
      try {
        const sig = request.headers["stripe-signature"] as string;
        const body = request.body;

        if (!process.env.STRIPE_WEBHOOK_SECRET) {
          return reply.status(500).send({
            error: "Webhook secret not configured",
          });
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

          // Get payment record
          const payment = await db.query.payments.findFirst({
            where: eq(payments.stripePaymentIntentId, paymentIntentId),
          });

          if (payment) {
            // Update payment status
            await db
              .update(payments)
              .set({
                status: "succeeded",
                updatedAt: new Date(),
              })
              .where(eq(payments.stripePaymentIntentId, paymentIntentId));

            // Add credits if it's a credits purchase
            if (payment.paymentType === "credits" && payment.creditsAwarded) {
              await addCredits(
                payment.userId,
                payment.creditsAwarded,
                `Purchase of ${payment.creditsAwarded} credits`,
                payment.id,
                "payment"
              );
            }
          }
        }

        return { received: true };
      } catch (error: any) {
        console.error("Webhook error:", error);
        return reply.status(400).send({
          error: `Webhook Error: ${error.message}`,
        });
      }
    },
  });

  // Purchase course with credits
  fastify.post("/payments/course/purchase-with-credits", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { courseId } = z
          .object({ courseId: z.string().uuid() })
          .parse(request.body);

        // Get course
        const course = await db.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });

        if (!course) {
          return reply.status(404).send({ error: "Course not found" });
        }

        // Check if course has credit cost
        if (!course.creditCost || course.creditCost <= 0) {
          return reply.status(400).send({
            error: "This course cannot be purchased with credits",
          });
        }

        // Check if user has enough credits
        const balance = await getUserCredits(userId);
        if (balance < course.creditCost) {
          return reply.status(400).send({
            error: "Insufficient credits",
            required: course.creditCost,
            current: balance,
          });
        }

        // Check if already enrolled
        const { enrollments, coursePurchases } = await import(
          "../../db/schema"
        );
        const existingEnrollment = await db.query.enrollments.findFirst({
          where: and(
            eq(enrollments.studentId, userId),
            eq(enrollments.courseId, courseId)
          ),
        });

        if (existingEnrollment) {
          return reply.status(409).send({
            error: "Already enrolled in this course",
          });
        }

        // Deduct credits
        const deductResult = await deductCredits(
          userId,
          course.creditCost,
          `Purchase of course: ${course.title}`,
          courseId,
          "course"
        );

        if (!deductResult.success) {
          return reply.status(500).send({
            error: deductResult.error || "Failed to deduct credits",
          });
        }

        // Create enrollment
        await db.insert(enrollments).values({
          studentId: userId,
          courseId,
        });

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
          message: "Course purchased successfully",
          creditsUsed: course.creditCost,
          newBalance: deductResult.newBalance,
        };
      } catch (error: any) {
        console.error("Error purchasing course with credits:", error);
        if (error.name === "ZodError") {
          return reply.status(400).send({
            error: "Invalid request data",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          error: error.message || "Failed to purchase course",
        });
      }
    },
  });
}
