import { FastifyInstance } from "fastify";
import { creatorRoutes } from "./modules/creators/creators.routes";
import { studentRoutes } from "./modules/students/students.routes";
import { videoRoutes } from "./modules/videos/videos.routes";
import { userRoutes } from "./modules/users/users.routes";
import { paymentRoutes } from "./modules/payments/payments.routes";
import { connectRoutes } from "./modules/payments/connect.routes";
import { connectV2Routes } from "./modules/payments/connect-v2.routes";
import { quizRoutes } from "./modules/quizzes/quizzes.routes";
import { leadsRoutes } from "./modules/leads/leads.routes";
import { subscriptionRoutes } from "./modules/subscriptions/subscriptions.routes";
import { gamificationRoutes } from "./modules/gamification/gamification.routes";
import { messagesRoutes } from "./modules/messages/messages.routes";

export async function routes(fastify: FastifyInstance) {
  fastify.get("/health", async (request, reply) => {
    return { status: "ok" };
  });

  fastify.register(creatorRoutes, { prefix: "/api" });
  fastify.register(studentRoutes, { prefix: "/api" });
  fastify.register(videoRoutes, { prefix: "/api" });
  fastify.register(userRoutes, { prefix: "/api" });
  fastify.register(paymentRoutes, { prefix: "/api" });
  fastify.register(connectRoutes, { prefix: "/api" });
  fastify.register(connectV2Routes, { prefix: "/api" });
  fastify.register(quizRoutes, { prefix: "/api" });
  fastify.register(leadsRoutes, { prefix: "/api" });
  fastify.register(subscriptionRoutes, { prefix: "/api" });
  fastify.register(gamificationRoutes, { prefix: "/api" });
  fastify.register(messagesRoutes, { prefix: "/api" });
}
