import { FastifyInstance } from "fastify";
import { db } from "../../db";
import { users } from "../../db/schema";
import { eq } from "drizzle-orm";

export async function userRoutes(fastify: FastifyInstance) {
  // Get current user (authenticated)
  fastify.get(
    "/users/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.id;

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: {
            id: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!user) {
          return reply.status(404).send({ message: "User not found" });
        }

        return user;
      } catch (error) {
        console.error("Error fetching current user:", error);
        return reply.status(500).send({ message: "Internal server error" });
      }
    }
  );

  // Get user by ID (authenticated)
  fastify.get(
    "/users/:userId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };

        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: {
            id: true,
            username: true,
            email: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!user) {
          return reply.status(404).send({ message: "User not found" });
        }

        return user;
      } catch (error) {
        console.error("Error fetching user:", error);
        return reply.status(500).send({ message: "Internal server error" });
      }
    }
  );
}
