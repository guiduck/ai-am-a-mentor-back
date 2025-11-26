import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcrypt";
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

  // Update current user profile (authenticated)
  const updateUserSchema = z.object({
    username: z.string().min(3).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
  });

  fastify.put(
    "/users/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.id;
        const updateData = updateUserSchema.parse(request.body);

        // Get current user
        const currentUser = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!currentUser) {
          return reply.status(404).send({ message: "User not found" });
        }

        // Check if username is being changed and if it's already taken
        if (updateData.username && updateData.username !== currentUser.username) {
          const existingUser = await db.query.users.findFirst({
            where: eq(users.username, updateData.username),
          });

          if (existingUser) {
            return reply.status(409).send({
              message: "Username already taken",
            });
          }
        }

        // Check if email is being changed and if it's already taken
        if (updateData.email && updateData.email !== currentUser.email) {
          const existingUser = await db.query.users.findFirst({
            where: eq(users.email, updateData.email),
          });

          if (existingUser) {
            return reply.status(409).send({
              message: "Email already in use",
            });
          }
        }

        // Prepare update object
        const updateFields: {
          username?: string;
          email?: string;
          passwordHash?: string;
          updatedAt?: Date;
        } = {
          updatedAt: new Date(),
        };

        if (updateData.username) {
          updateFields.username = updateData.username;
        }

        if (updateData.email) {
          updateFields.email = updateData.email;
        }

        if (updateData.password) {
          updateFields.passwordHash = await bcrypt.hash(updateData.password, 10);
        }

        // Update user
        const updatedUser = await db
          .update(users)
          .set(updateFields)
          .where(eq(users.id, userId))
          .returning({
            id: users.id,
            username: users.username,
            email: users.email,
            role: users.role,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          });

        return {
          message: "Profile updated successfully",
          user: updatedUser[0],
        };
      } catch (error: any) {
        console.error("Error updating user profile:", error);

        // Handle Zod validation errors
        if (error.name === "ZodError") {
          return reply.status(400).send({
            message: "Validation error",
            errors: error.errors,
          });
        }

        // Handle unique constraint violations
        if (error.code === "23505") {
          return reply.status(409).send({
            message: "Username or email already in use",
          });
        }

        return reply.status(500).send({ message: "Internal server error" });
      }
    }
  );
}
