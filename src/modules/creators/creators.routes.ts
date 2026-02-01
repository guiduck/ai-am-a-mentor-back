import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";
import { db } from "../../db";
import { users, courses, videos } from "../../db/schema";
import { eq } from "drizzle-orm";
import "@fastify/cookie";

const registerCreatorSchema = z.object({
  username: z.string(),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginCreatorSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const createCourseSchema = z.object({
  title: z.string(),
  description: z.string(),
  price: z.number().positive().min(0.01),
  tags: z.array(z.string()).optional().default([]),
});

export async function creatorRoutes(fastify: FastifyInstance) {
  fastify.post("/creators/register", async (request, reply) => {
    try {
      const { username, email, password } = registerCreatorSchema.parse(
        request.body
      );

      // Check if email already exists
      const existingUserByEmail = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (existingUserByEmail) {
        return reply.status(409).send({
          message: "Ja existe um usuario com este email",
        });
      }

      // Check if username already exists
      const existingUserByUsername = await db.query.users.findFirst({
        where: eq(users.username, username),
      });

      if (existingUserByUsername) {
        return reply.status(409).send({
          message: "Nome de usuario ja em uso",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await db
        .insert(users)
        .values({
          username,
          email,
          passwordHash: hashedPassword,
          role: "creator",
        })
        .returning();

      return reply
        .status(201)
        .send({ message: "Conta de criador criada com sucesso", user: newUser[0] });
    } catch (error: any) {
      // Log detailed error information
      fastify.log.error(
        {
          error: error.message,
          code: error.code,
          constraint: error.constraint,
          stack: error.stack,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        },
        "Error registering creator"
      );

      console.error("Error registering creator:", {
        message: error.message,
        code: error.code,
        constraint: error.constraint,
        cause: error.cause,
        stack: error.stack,
      });

      // Handle unique constraint violations
      if (error.code === "23505") {
        // PostgreSQL unique violation
        if (error.constraint === "users_email_unique") {
          return reply.status(409).send({
            message: "Ja existe um usuario com este email",
          });
        }
        if (error.constraint === "users_username_unique") {
          return reply.status(409).send({
            message: "Nome de usuario ja em uso",
          });
        }
      }

      // Handle Drizzle ORM errors
      if (
        error.message?.includes("Failed query") ||
        error.type === "DrizzleQueryError"
      ) {
        fastify.log.error(
          {
            query: error.query,
            params: error.params,
            cause: error.cause,
          },
          "Database query failed"
        );

        return reply.status(500).send({
          message:
            "Erro no banco de dados. Verifique se as migrations estao atualizadas.",
          details: {
            error: error.message,
            query: error.query,
            params: error.params,
          },
        });
      }

      return reply.status(500).send({
        message: "Falha ao criar conta de criador",
        details: error.message,
        code: error.code,
      });
    }
  });

  fastify.post("/creators/login", async (request, reply) => {
    try {
      const { email, password } = loginCreatorSchema.parse(request.body);

      const [user] = await db
        .select({
          id: users.id,
          role: users.role,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user || !user.passwordHash) {
        return reply.status(401).send({ message: "Credenciais invalidas" });
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

      if (!isPasswordValid) {
        return reply.status(401).send({ message: "Credenciais invalidas" });
      }

      if (!process.env.JWT_SECRET) {
        return reply.status(500).send({
          message: "JWT_SECRET nao configurado no servidor",
        });
      }

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // Set cookie for automatic authentication (needed for video streaming)
      // For cross-origin cookies, we need SameSite=None and Secure=true
      const isProduction = process.env.NODE_ENV === "production";
      reply.setCookie("access_token", token, {
        httpOnly: false, // Allow JavaScript to read it
        secure: isProduction, // HTTPS required for SameSite=None
        sameSite: isProduction ? "none" : "lax", // None for cross-origin, lax for same-origin
        path: "/", // Available for all paths
        maxAge: 3600, // 1 hour (same as token expiration)
        domain: undefined, // Let browser handle domain (don't set for cross-origin)
      });

      return { access_token: token, token }; // Return both for compatibility
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return reply.status(400).send({
          message: "Dados invalidos",
          details: error.errors,
        });
      }

      console.error("Erro no login de criador:", error);
      return reply.status(500).send({
        message: "Erro interno do servidor",
      });
    }
  });

  fastify.post(
    "/courses",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const {
        title,
        description,
        price,
        tags = [],
      } = createCourseSchema.parse(request.body);
      const creatorId = request.user.id;

      const newCourse = await db
        .insert(courses)
        .values({
          title,
          description,
          price: price.toString(),
          creatorId,
          tags: tags.length > 0 ? JSON.stringify(tags) : null,
        })
        .returning();

      // Parse tags back to array for response
      const courseWithTags = {
        ...newCourse[0],
        tags: newCourse[0].tags ? JSON.parse(newCourse[0].tags) : [],
      };

      return reply.status(201).send({
        message: "Curso criado com sucesso",
        course: courseWithTags,
      });
    }
  );

  fastify.put(
    "/courses/:courseId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const {
        title,
        description,
        price,
        tags = [],
      } = createCourseSchema.parse(request.body);

      const updatedCourse = await db
        .update(courses)
        .set({
          title,
          description,
          price: price.toString(),
          tags: tags.length > 0 ? JSON.stringify(tags) : null,
        })
        .where(eq(courses.id, courseId))
        .returning();

      // Parse tags back to array for response
      const courseWithTags = {
        ...updatedCourse[0],
        tags: updatedCourse[0].tags ? JSON.parse(updatedCourse[0].tags) : [],
      };

      return {
        message: "Curso atualizado com sucesso",
        course: courseWithTags,
      };
    }
  );

  fastify.get(
    "/courses/:courseId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };

      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });

      if (!course) {
        return reply.status(404).send({ message: "Curso nao encontrado" });
      }

      // Parse tags from JSON string to array
      const courseWithTags = {
        ...course,
        tags: course.tags ? JSON.parse(course.tags) : [],
      };

      return courseWithTags;
    }
  );

  // Delete course (creators only)
  fastify.delete(
    "/courses/:courseId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const creatorId = request.user.id;

      // Check if course exists and belongs to the creator
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
        with: {
          videos: true,
        },
      });

      if (!course) {
        return reply.status(404).send({ message: "Curso nao encontrado" });
      }

      if (course.creatorId !== creatorId) {
        return reply
          .status(403)
          .send({ message: "Voce so pode deletar seus proprios cursos" });
      }

      // Delete all video files from R2 before deleting the course
      const { deleteFileFromR2 } = await import("../../services/cloudflare-r2");

      for (const video of course.videos) {
        // Delete video file from R2
        if (video.r2Key) {
          await deleteFileFromR2(video.r2Key);
        }
        // Delete transcript file from R2 if exists
        if (video.transcriptR2Key) {
          await deleteFileFromR2(video.transcriptR2Key);
        }
      }

      // Delete the course (videos will be deleted by CASCADE)
      await db.delete(courses).where(eq(courses.id, courseId));

      return { message: "Curso deletado com sucesso" };
    }
  );

  fastify.get(
    "/creators/courses",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const creatorId = request.user.id;

      const creatorCourses = await db.query.courses.findMany({
        where: eq(courses.creatorId, creatorId),
      });

      return creatorCourses;
    }
  );

  // Get all courses (public endpoint for browsing)
  fastify.get("/courses", async (request, reply) => {
    const allCourses = await db.query.courses.findMany({
      with: {
        creator: {
          columns: {
            id: true,
            username: true,
          },
        },
        videos: {
          columns: {
            duration: true,
          },
        },
      },
    });

    // Calculate total duration and parse tags for each course
    const coursesWithDuration = allCourses.map((course) => {
      const totalDuration = course.videos
        ? course.videos.reduce((sum, video) => sum + (video.duration || 0), 0)
        : 0;

      // Parse tags from JSON string to array
      const tags = course.tags ? JSON.parse(course.tags) : [];

      // Remove videos array and add totalDuration and parsed tags
      const { videos, ...courseWithoutVideos } = course;
      return {
        ...courseWithoutVideos,
        totalDuration, // in seconds
        videoCount: videos?.length || 0,
        tags, // parsed array of strings
      };
    });

    return coursesWithDuration;
  });
}
