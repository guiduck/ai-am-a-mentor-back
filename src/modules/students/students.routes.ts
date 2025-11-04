import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db";
import { users, courses, enrollments } from "../../db/schema";
import { eq, and } from "drizzle-orm";

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
    const { username, email, password } = registerStudentSchema.parse(
      request.body
    );

    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return reply
        .status(409)
        .send({ message: "User with this email already exists" });
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
      message: "Student account successfully created",
      user: newUser[0],
    });
  });

  // Student login
  fastify.post("/students/login", async (request, reply) => {
    const { email, password } = loginStudentSchema.parse(request.body);

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" }
    );

    return { token };
  });

  // Enroll in a course
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
          .send({ message: "Only students can enroll in courses" });
      }

      // Check if course exists
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });

      if (!course) {
        return reply.status(404).send({ message: "Course not found" });
      }

      // Check if already enrolled
      const existingEnrollment = await db.query.enrollments.findFirst({
        where: and(
          eq(enrollments.studentId, studentId),
          eq(enrollments.courseId, courseId)
        ),
      });

      if (existingEnrollment) {
        return reply
          .status(409)
          .send({ message: "Already enrolled in this course" });
      }

      // Create enrollment
      const newEnrollment = await db
        .insert(enrollments)
        .values({
          studentId,
          courseId,
        })
        .returning();

      return reply.status(201).send({
        message: "Successfully enrolled in course",
        enrollment: newEnrollment[0],
      });
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
          .send({ message: "Only students can access this endpoint" });
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
          .send({ message: "Only students can check enrollment status" });
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
