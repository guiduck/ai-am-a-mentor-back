import { FastifyInstance } from "fastify";
import { creatorRoutes } from "./modules/creators/creators.routes";
import { studentRoutes } from "./modules/students/students.routes";
import { videoRoutes } from "./modules/videos/videos.routes";
import { userRoutes } from "./modules/users/users.routes";

export async function routes(fastify: FastifyInstance) {
  fastify.get("/health", async (request, reply) => {
    return { status: "ok" };
  });

  fastify.register(creatorRoutes, { prefix: "/api" });
  fastify.register(studentRoutes, { prefix: "/api" });
  fastify.register(videoRoutes, { prefix: "/api" });
  fastify.register(userRoutes, { prefix: "/api" });
}
