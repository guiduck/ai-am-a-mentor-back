/**
 * Quiz Routes
 * Handles quiz generation, retrieval, and submissions
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import {
  quizzes,
  quizQuestions,
  quizAttempts,
  videos,
  courses,
  enrollments,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";
import {
  createQuizForVideo,
  estimateQuizCreditCost,
} from "../../services/quiz-generator";
import { getUserCredits, deductCredits } from "../../services/credits";

// ============================================================================
// Validation Schemas
// ============================================================================

const generateQuizSchema = z.object({
  videoId: z.string().uuid(),
  numQuestions: z.number().int().min(3).max(10).optional().default(5),
});

const submitQuizSchema = z.object({
  answers: z.array(z.number().int().min(0).max(3)),
});

// ============================================================================
// Helper Functions
// ============================================================================

async function isCreatorOfVideo(
  userId: string,
  videoId: string
): Promise<boolean> {
  const video = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
    with: {
      course: true,
    },
  });

  if (!video) return false;
  return video.course.creatorId === userId;
}

async function isEnrolledInCourse(
  studentId: string,
  courseId: string
): Promise<boolean> {
  const enrollment = await db.query.enrollments.findFirst({
    where: and(
      eq(enrollments.studentId, studentId),
      eq(enrollments.courseId, courseId)
    ),
  });
  return !!enrollment;
}

// ============================================================================
// Routes
// ============================================================================

export async function quizRoutes(fastify: FastifyInstance) {
  /**
   * POST /quizzes/generate - Generate a quiz for a video using AI
   * Only creators can generate quizzes for their videos
   * Costs credits
   */
  fastify.post("/quizzes/generate", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const userRole = request.user.role;
        const { videoId, numQuestions } = generateQuizSchema.parse(
          request.body
        );

        console.log("🧠 [Quiz Generate] Request received:", {
          userId,
          userRole,
          videoId,
          numQuestions,
        });

        // Only creators can generate quizzes
        if (userRole !== "creator") {
          return reply.status(403).send({
            error: "Apenas criadores podem gerar quizzes",
          });
        }

        // Check if user is creator of this video
        const isOwner = await isCreatorOfVideo(userId, videoId);
        console.log("🧠 [Quiz Generate] Is owner:", isOwner);

        if (!isOwner) {
          return reply.status(403).send({
            error: "Você só pode gerar quizzes para seus próprios vídeos",
          });
        }

        // Get video info
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
        });

        console.log(
          "🧠 [Quiz Generate] Video found:",
          video
            ? {
                id: video.id,
                title: video.title,
                courseId: video.courseId,
              }
            : null
        );

        if (!video) {
          return reply.status(404).send({ error: "Vídeo não encontrado" });
        }

        // Check credits
        const creditCost = estimateQuizCreditCost(numQuestions);
        const currentCredits = await getUserCredits(userId);

        console.log("🧠 [Quiz Generate] Credits check:", {
          creditCost,
          currentCredits,
          hasEnough: currentCredits >= creditCost,
        });

        if (currentCredits < creditCost) {
          return reply.status(402).send({
            error: `Créditos insuficientes. Necessário: ${creditCost}, Disponível: ${currentCredits}`,
            required: creditCost,
            available: currentCredits,
          });
        }

        console.log("🧠 [Quiz Generate] Starting quiz generation...");

        // Generate quiz
        const result = await createQuizForVideo(
          videoId,
          video.title,
          numQuestions
        );

        console.log(
          "🧠 [Quiz Generate] Generation result:",
          result
            ? {
                quizId: result.quizId,
                questionsCount: result.questionsCount,
              }
            : null
        );

        if (!result) {
          console.error("🧠 [Quiz Generate] ❌ Failed to generate quiz");
          return reply.status(500).send({
            error:
              "Erro ao gerar quiz. Verifique se o vídeo possui transcrição.",
          });
        }

        // Deduct credits
        await deductCredits(
          userId,
          creditCost,
          `Geração de quiz: ${video.title}`,
          result.quizId,
          "quiz"
        );

        return {
          message: "Quiz gerado com sucesso!",
          quizId: result.quizId,
          questionsCount: result.questionsCount,
          creditsUsed: creditCost,
        };
      } catch (error: any) {
        console.error("Error generating quiz:", error);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: error.issues });
        }
        if (error?.code === "DB_MIGRATION_MISSING") {
          return reply.status(503).send({
            error:
              "O sistema de quizzes ainda está sendo configurado no servidor. Tente novamente em alguns minutos.",
            code: "DB_MIGRATION_MISSING",
          });
        }
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /quizzes/video/:videoId - Get quiz for a specific video
   */
  fastify.get("/quizzes/video/:videoId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const userId = request.user.id;
        const userRole = request.user.role;

        // Get video and course info
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ error: "Vídeo não encontrado" });
        }

        // Check access - creator or enrolled student
        const isOwner = video.course.creatorId === userId;
        const enrolled = await isEnrolledInCourse(userId, video.courseId);

        if (!isOwner && !enrolled) {
          return reply.status(403).send({
            error:
              "Você precisa estar matriculado no curso para acessar o quiz",
          });
        }

        // Get quiz with questions
        const quiz = await db.query.quizzes.findFirst({
          where: eq(quizzes.videoId, videoId),
          with: {
            questions: {
              orderBy: (questions, { asc }) => [asc(questions.order)],
            },
          },
        });

        if (!quiz) {
          return reply.status(404).send({
            error: "Quiz não encontrado para este vídeo",
            hasQuiz: false,
          });
        }

        // Format questions (hide correct answer for students)
        const questions = quiz.questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: JSON.parse(q.options),
          order: q.order,
          // Only show correct answer and explanation to creators
          ...(isOwner
            ? {
                correctAnswer: parseInt(q.correctAnswer),
                explanation: q.explanation,
              }
            : {}),
        }));

        // Get user's best attempt if student
        let bestAttempt = null;
        if (!isOwner) {
          const attempts = await db.query.quizAttempts.findMany({
            where: and(
              eq(quizAttempts.quizId, quiz.id),
              eq(quizAttempts.studentId, userId)
            ),
          });

          if (attempts.length > 0) {
            bestAttempt = attempts.reduce((best, current) =>
              current.score > best.score ? current : best
            );
          }
        }

        return {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          passingScore: quiz.passingScore,
          questionsCount: questions.length,
          questions,
          bestAttempt: bestAttempt
            ? {
                score: bestAttempt.score,
                passed: bestAttempt.passed === 1,
                completedAt: bestAttempt.completedAt,
              }
            : null,
        };
      } catch (error: any) {
        console.error("Error getting quiz:", error);
        if (
          error?.cause?.code === "42P01" ||
          error?.code === "42P01" ||
          (typeof error?.message === "string" &&
            error.message.includes('relation "quizzes" does not exist'))
        ) {
          return reply.status(503).send({
            error:
              "O sistema de quizzes ainda está sendo configurado no servidor. Tente novamente em alguns minutos.",
            code: "DB_MIGRATION_MISSING",
          });
        }
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * POST /quizzes/:quizId/submit - Submit quiz answers
   * Only students can submit
   */
  fastify.post("/quizzes/:quizId/submit", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { quizId } = request.params as { quizId: string };
        const userId = request.user.id;
        const userRole = request.user.role;
        const { answers } = submitQuizSchema.parse(request.body);

        // Only students can submit quizzes
        if (userRole !== "student") {
          return reply.status(403).send({
            error: "Apenas alunos podem responder quizzes",
          });
        }

        // Get quiz with questions
        const quiz = await db.query.quizzes.findFirst({
          where: eq(quizzes.id, quizId),
          with: {
            questions: {
              orderBy: (questions, { asc }) => [asc(questions.order)],
            },
            video: {
              with: {
                course: true,
              },
            },
          },
        });

        if (!quiz) {
          return reply.status(404).send({ error: "Quiz não encontrado" });
        }

        // Check enrollment
        const enrolled = await isEnrolledInCourse(userId, quiz.video.courseId);
        if (!enrolled) {
          return reply.status(403).send({
            error:
              "Você precisa estar matriculado no curso para responder o quiz",
          });
        }

        // Validate answer count
        if (answers.length !== quiz.questions.length) {
          return reply.status(400).send({
            error: `Número incorreto de respostas. Esperado: ${quiz.questions.length}, Recebido: ${answers.length}`,
          });
        }

        // Calculate score
        let correctCount = 0;
        const results = quiz.questions.map((q, index) => {
          const correctAnswer = parseInt(q.correctAnswer);
          const userAnswer = answers[index];
          const isCorrect = userAnswer === correctAnswer;

          if (isCorrect) correctCount++;

          return {
            questionId: q.id,
            question: q.question,
            userAnswer,
            correctAnswer,
            isCorrect,
            explanation: q.explanation,
            options: JSON.parse(q.options),
          };
        });

        const score = Math.round((correctCount / quiz.questions.length) * 100);
        const passed = score >= quiz.passingScore;

        // Save attempt
        const [attempt] = await db
          .insert(quizAttempts)
          .values({
            quizId: quiz.id,
            studentId: userId,
            score,
            passed: passed ? 1 : 0,
            answers: JSON.stringify(answers),
          })
          .returning();

        return {
          attemptId: attempt.id,
          score,
          passed,
          passingScore: quiz.passingScore,
          correctCount,
          totalQuestions: quiz.questions.length,
          results,
          message: passed
            ? "Parabéns! Você passou no quiz! 🎉"
            : "Você não atingiu a pontuação mínima. Tente novamente!",
        };
      } catch (error: any) {
        console.error("Error submitting quiz:", error);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: error.issues });
        }
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /quizzes/:quizId/attempts - Get user's quiz attempts
   */
  fastify.get("/quizzes/:quizId/attempts", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { quizId } = request.params as { quizId: string };
        const userId = request.user.id;

        const attempts = await db.query.quizAttempts.findMany({
          where: and(
            eq(quizAttempts.quizId, quizId),
            eq(quizAttempts.studentId, userId)
          ),
          orderBy: (attempts, { desc }) => [desc(attempts.completedAt)],
        });

        return {
          attempts: attempts.map((a) => ({
            id: a.id,
            score: a.score,
            passed: a.passed === 1,
            completedAt: a.completedAt,
          })),
          totalAttempts: attempts.length,
          bestScore:
            attempts.length > 0
              ? Math.max(...attempts.map((a) => a.score))
              : null,
        };
      } catch (error: any) {
        console.error("Error getting attempts:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * DELETE /quizzes/:quizId - Delete a quiz (creator only)
   */
  fastify.delete("/quizzes/:quizId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { quizId } = request.params as { quizId: string };
        const userId = request.user.id;
        const userRole = request.user.role;

        if (userRole !== "creator") {
          return reply.status(403).send({
            error: "Apenas criadores podem deletar quizzes",
          });
        }

        // Get quiz
        const quiz = await db.query.quizzes.findFirst({
          where: eq(quizzes.id, quizId),
          with: {
            video: {
              with: {
                course: true,
              },
            },
          },
        });

        if (!quiz) {
          return reply.status(404).send({ error: "Quiz não encontrado" });
        }

        // Check ownership
        if (quiz.video.course.creatorId !== userId) {
          return reply.status(403).send({
            error: "Você só pode deletar quizzes dos seus próprios vídeos",
          });
        }

        // Delete quiz (cascade deletes questions and attempts)
        await db.delete(quizzes).where(eq(quizzes.id, quizId));

        return { message: "Quiz deletado com sucesso" };
      } catch (error: any) {
        console.error("Error deleting quiz:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /quizzes/estimate-cost - Get estimated credit cost for quiz generation
   */
  fastify.get("/quizzes/estimate-cost", {
    handler: async (request, reply) => {
      const { numQuestions } = request.query as { numQuestions?: string };
      const questions = parseInt(numQuestions || "5");
      const cost = estimateQuizCreditCost(Math.min(10, Math.max(3, questions)));

      return { numQuestions: questions, estimatedCost: cost };
    },
  });
}
