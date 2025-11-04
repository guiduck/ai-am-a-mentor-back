import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db";
import { users, courses } from "../../db/schema";
import { eq } from "drizzle-orm";

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
  price: z.number(),
});

export async function creatorRoutes(fastify: FastifyInstance) {
  fastify.post("/creators/register", async (request, reply) => {
    const { username, email, password } = registerCreatorSchema.parse(
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
      .send({ message: "Creator created successfully", user: newUser[0] });
  });

  fastify.post("/creators/login", async (request, reply) => {
    const { email, password } = loginCreatorSchema.parse(request.body);

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

  fastify.post(
    "/courses",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { title, description, price } = createCourseSchema.parse(
        request.body
      );
      const creatorId = request.user.id;

      const newCourse = await db
        .insert(courses)
        .values({
          title,
          description,
          price: price.toString(),
          creatorId,
        })
        .returning();

      return reply
        .status(201)
        .send({ message: "Course created successfully", course: newCourse[0] });
    }
  );

  fastify.put(
    "/courses/:courseId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const { title, description, price } = createCourseSchema.parse(
        request.body
      );

      const updatedCourse = await db
        .update(courses)
        .set({
          title,
          description,
          price: price.toString(),
        })
        .where(eq(courses.id, courseId))
        .returning();

      return {
        message: "Course updated successfully",
        course: updatedCourse[0],
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

      return course;
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
      });

      if (!course) {
        return reply.status(404).send({ message: "Course not found" });
      }

      if (course.creatorId !== creatorId) {
        return reply
          .status(403)
          .send({ message: "You can only delete your own courses" });
      }

      // Delete the course (videos will be deleted by CASCADE)
      await db.delete(courses).where(eq(courses.id, courseId));

      return { message: "Course deleted successfully" };
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
      },
    });

    return allCourses;
  });
}
