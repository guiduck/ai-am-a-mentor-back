import { FastifyInstance } from "fastify";
import { creatorRoutes } from "./modules/creators/creators.routes";
import { studentRoutes } from "./modules/students/students.routes";
import { videoRoutes } from "./modules/videos/videos.routes";
import { userRoutes } from "./modules/users/users.routes";
import { paymentRoutes } from "./modules/payments/payments.routes";
import { connectRoutes } from "./modules/payments/connect.routes";
import { quizRoutes } from "./modules/quizzes/quizzes.routes";

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
  fastify.register(quizRoutes, { prefix: "/api" });
}
