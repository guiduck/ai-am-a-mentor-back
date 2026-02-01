import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";
import { db } from "../../db";
import { users, courses, enrollments } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import "@fastify/cookie";

const registerStudentSchema = z.object({
  username: z.string(),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginStudentSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function studentRoutes(fastify: FastifyInstance) {
  fastify.post("/students/register", async (request, reply) => {
    try {
      const { username, email, password } = registerStudentSchema.parse(
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

      const passwordHash = await bcrypt.hash(password, 10);

      const newUser = await db
        .insert(users)
        .values({
          username,
          email,
          passwordHash,
          role: "student",
        })
        .returning();

      return reply.status(201).send({
        message: "Conta de aluno criada com sucesso",
        user: newUser[0],
      });
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
        "Error registering student"
      );

      console.error("Error registering student:", {
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
        message: "Falha ao criar conta de aluno",
        details: error.message,
        code: error.code,
      });
    }
  });

  // Student login
  fastify.post("/students/login", async (request, reply) => {
    try {
      const { email, password } = loginStudentSchema.parse(request.body);

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

      console.error("Erro no login de aluno:", error);
      return reply.status(500).send({
        message: "Erro interno do servidor",
      });
    }
  });

  // Enroll in a course (cursos gratuitos nao sao permitidos no MVP)
  fastify.post(
    "/students/enroll/:courseId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const studentId = request.user.id;

      // Check if student role
      if (request.user.role !== "student") {
        return reply
          .status(403)
          .send({ message: "Apenas alunos podem se matricular em cursos" });
      }

      // Check if course exists
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });

      if (!course) {
        return reply.status(404).send({ message: "Curso nao encontrado" });
      }

      // Check if course is free (price = 0 and no credit cost)
      const isFree =
        parseFloat(course.price) === 0 &&
        (!course.creditCost || course.creditCost === 0);

      if (isFree) {
        return reply.status(400).send({
          message: "Cursos gratuitos não estão disponíveis no MVP",
        });
      }

      if (!isFree) {
        return reply.status(400).send({
          message:
            "Este curso exige pagamento. Use /payments/course/purchase-with-credits ou /payments/course/create-intent",
          price: course.price,
          creditCost: course.creditCost,
        });
      }
    }
  );

  // Get student's enrolled courses
  fastify.get(
    "/students/courses",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const studentId = request.user.id;

      // Check if student role
      if (request.user.role !== "student") {
        return reply
          .status(403)
          .send({ message: "Apenas alunos podem acessar este endpoint" });
      }

      const enrolledCourses = await db
        .select({
          id: courses.id,
          title: courses.title,
          description: courses.description,
          price: courses.price,
          createdAt: courses.createdAt,
          enrolledAt: enrollments.enrolledAt,
        })
        .from(enrollments)
        .innerJoin(courses, eq(enrollments.courseId, courses.id))
        .where(eq(enrollments.studentId, studentId));

      return enrolledCourses;
    }
  );

  // Check enrollment status for a course
  fastify.get(
    "/students/enrollment/:courseId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const studentId = request.user.id;

      // Check if student role
      if (request.user.role !== "student") {
        return reply
          .status(403)
          .send({ message: "Apenas alunos podem checar matricula" });
      }

      const enrollment = await db.query.enrollments.findFirst({
        where: and(
          eq(enrollments.studentId, studentId),
          eq(enrollments.courseId, courseId)
        ),
      });

      return {
        isEnrolled: !!enrollment,
        enrolledAt: enrollment?.enrolledAt || null,
      };
    }
  );
}
