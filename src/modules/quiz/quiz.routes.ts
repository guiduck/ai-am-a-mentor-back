/**
 * Quiz Routes
 * Handles quiz generation, retrieval, and attempt submission
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import { quizzes, quizQuestions, quizAttempts, videos, courses } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { generateQuizForVideo, getQuizGenerationCost } from "../../services/quiz-generator";

export async function quizRoutes(fastify: FastifyInstance) {
  // ==========================================================================
  // QUIZ GENERATION (Creator Only)
  // ==========================================================================

  /**
   * POST /quiz/generate - Generate a quiz for a video using AI
   */
  fastify.post("/quiz/generate", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const userRole = request.user.role;

        if (userRole !== "creator") {
          return reply.status(403).send({ error: "Apenas criadores podem gerar quizzes" });
        }

        const { videoId, numberOfQuestions } = z.object({
          videoId: z.string().uuid(),
          numberOfQuestions: z.number().int().min(3).max(10).default(5),
        }).parse(request.body);

        // Verify creator owns this video
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ error: "Vídeo não encontrado" });
        }

        if (video.course.creatorId !== userId) {
          return reply.status(403).send({ error: "Você não é o criador deste curso" });
        }

        // Generate quiz
        const result = await generateQuizForVideo(videoId, userId, numberOfQuestions);

        if (!result.success) {
          return reply.status(400).send({ error: result.error });
        }

        return {
          message: "Quiz gerado com sucesso!",
          quizId: result.quizId,
          questionsCount: result.questionsCount,
          creditsUsed: result.creditsUsed,
        };
      } catch (error: any) {
        console.error("Error generating quiz:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /quiz/cost - Get the cost to generate a quiz
   */
  fastify.get("/quiz/cost", {
    handler: async () => {
      return { cost: getQuizGenerationCost() };
    },
  });

  // ==========================================================================
  // QUIZ RETRIEVAL
  // ==========================================================================

  /**
   * GET /quiz/video/:videoId - Get quiz for a specific video
   */
  fastify.get("/quiz/video/:videoId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = z.object({
          videoId: z.string().uuid(),
        }).parse(request.params);

        const quiz = await db.query.quizzes.findFirst({
          where: eq(quizzes.videoId, videoId),
          with: {
            questions: {
              orderBy: (q, { asc }) => [asc(q.order)],
            },
          },
        });

        if (!quiz) {
          return reply.status(404).send({ error: "Quiz não encontrado para este vídeo" });
        }

        // Format questions for frontend (hide correct answer for students)
        const formattedQuestions = quiz.questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: JSON.parse(q.options),
          order: q.order,
          // Don't send correctAnswer to client during quiz
        }));

        return {
          id: quiz.id,
          videoId: quiz.videoId,
          title: quiz.title,
          description: quiz.description,
          passingScore: quiz.passingScore,
          questionsCount: quiz.questions.length,
          questions: formattedQuestions,
        };
      } catch (error: any) {
        console.error("Error fetching quiz:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /quiz/:quizId - Get quiz by ID
   */
  fastify.get("/quiz/:quizId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { quizId } = z.object({
          quizId: z.string().uuid(),
        }).parse(request.params);

        const quiz = await db.query.quizzes.findFirst({
          where: eq(quizzes.id, quizId),
          with: {
            questions: {
              orderBy: (q, { asc }) => [asc(q.order)],
            },
          },
        });

        if (!quiz) {
          return reply.status(404).send({ error: "Quiz não encontrado" });
        }

        const formattedQuestions = quiz.questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: JSON.parse(q.options),
          order: q.order,
        }));

        return {
          id: quiz.id,
          videoId: quiz.videoId,
          title: quiz.title,
          description: quiz.description,
          passingScore: quiz.passingScore,
          questionsCount: quiz.questions.length,
          questions: formattedQuestions,
        };
      } catch (error: any) {
        console.error("Error fetching quiz:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // ==========================================================================
  // QUIZ SUBMISSION
  // ==========================================================================

  /**
   * POST /quiz/:quizId/submit - Submit quiz answers
   */
  fastify.post("/quiz/:quizId/submit", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        
        const { quizId } = z.object({
          quizId: z.string().uuid(),
        }).parse(request.params);

        const { answers } = z.object({
          answers: z.array(z.object({
            questionId: z.string().uuid(),
            selectedOption: z.number().int().min(0).max(3),
          })),
        }).parse(request.body);

        // Get quiz with questions
        const quiz = await db.query.quizzes.findFirst({
          where: eq(quizzes.id, quizId),
          with: {
            questions: true,
          },
        });

        if (!quiz) {
          return reply.status(404).send({ error: "Quiz não encontrado" });
        }

        // Calculate score
        let correctCount = 0;
        const detailedResults: Array<{
          questionId: string;
          correct: boolean;
          selectedOption: number;
          correctOption: number;
          explanation: string;
        }> = [];

        for (const answer of answers) {
          const question = quiz.questions.find((q) => q.id === answer.questionId);
          if (question) {
            const correctAnswer = parseInt(question.correctAnswer);
            const isCorrect = answer.selectedOption === correctAnswer;
            
            if (isCorrect) correctCount++;

            detailedResults.push({
              questionId: answer.questionId,
              correct: isCorrect,
              selectedOption: answer.selectedOption,
              correctOption: correctAnswer,
              explanation: question.explanation || "",
            });
          }
        }

        const totalQuestions = quiz.questions.length;
        const score = Math.round((correctCount / totalQuestions) * 100);
        const passed = score >= quiz.passingScore;

        // Save attempt
        const [attempt] = await db
          .insert(quizAttempts)
          .values({
            quizId,
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
          correctCount,
          totalQuestions,
          passingScore: quiz.passingScore,
          results: detailedResults,
        };
      } catch (error: any) {
        console.error("Error submitting quiz:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // ==========================================================================
  // QUIZ HISTORY
  // ==========================================================================

  /**
   * GET /quiz/:quizId/attempts - Get user's attempts for a quiz
   */
  fastify.get("/quiz/:quizId/attempts", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        
        const { quizId } = z.object({
          quizId: z.string().uuid(),
        }).parse(request.params);

        const attempts = await db.query.quizAttempts.findMany({
          where: and(
            eq(quizAttempts.quizId, quizId),
            eq(quizAttempts.studentId, userId)
          ),
          orderBy: (a, { desc }) => [desc(a.completedAt)],
        });

        return {
          attempts: attempts.map((a) => ({
            id: a.id,
            score: a.score,
            passed: a.passed === 1,
            completedAt: a.completedAt,
          })),
          bestScore: attempts.length > 0 ? Math.max(...attempts.map((a) => a.score)) : null,
          hasPassed: attempts.some((a) => a.passed === 1),
        };
      } catch (error: any) {
        console.error("Error fetching attempts:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  /**
   * GET /quiz/course/:courseId/progress - Get quiz progress for all videos in a course
   */
  fastify.get("/quiz/course/:courseId/progress", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        
        const { courseId } = z.object({
          courseId: z.string().uuid(),
        }).parse(request.params);

        // Get all videos in course
        const courseVideos = await db.query.videos.findMany({
          where: eq(videos.courseId, courseId),
        });

        // Get quizzes for these videos
        const videoIds = courseVideos.map((v) => v.id);
        const courseQuizzes = await db.query.quizzes.findMany({
          where: (q, { inArray }) => inArray(q.videoId, videoIds),
        });

        // Get user's best attempts for each quiz
        const progress: Array<{
          videoId: string;
          videoTitle: string;
          hasQuiz: boolean;
          quizId: string | null;
          bestScore: number | null;
          passed: boolean;
        }> = [];

        for (const video of courseVideos) {
          const quiz = courseQuizzes.find((q) => q.videoId === video.id);
          
          let bestScore = null;
          let passed = false;

          if (quiz) {
            const attempts = await db.query.quizAttempts.findMany({
              where: and(
                eq(quizAttempts.quizId, quiz.id),
                eq(quizAttempts.studentId, userId)
              ),
            });

            if (attempts.length > 0) {
              bestScore = Math.max(...attempts.map((a) => a.score));
              passed = attempts.some((a) => a.passed === 1);
            }
          }

          progress.push({
            videoId: video.id,
            videoTitle: video.title,
            hasQuiz: !!quiz,
            quizId: quiz?.id || null,
            bestScore,
            passed,
          });
        }

        const totalQuizzes = courseQuizzes.length;
        const passedQuizzes = progress.filter((p) => p.passed).length;

        return {
          progress,
          totalQuizzes,
          passedQuizzes,
          allPassed: totalQuizzes > 0 && passedQuizzes === totalQuizzes,
        };
      } catch (error: any) {
        console.error("Error fetching course progress:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // ==========================================================================
  // QUIZ MANAGEMENT (Creator Only)
  // ==========================================================================

  /**
   * DELETE /quiz/:quizId - Delete a quiz
   */
  fastify.delete("/quiz/:quizId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const userRole = request.user.role;

        if (userRole !== "creator") {
          return reply.status(403).send({ error: "Apenas criadores podem deletar quizzes" });
        }

        const { quizId } = z.object({
          quizId: z.string().uuid(),
        }).parse(request.params);

        // Get quiz and verify ownership
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

        if (quiz.video.course.creatorId !== userId) {
          return reply.status(403).send({ error: "Você não é o criador deste quiz" });
        }

        // Delete quiz (cascade will delete questions and attempts)
        await db.delete(quizzes).where(eq(quizzes.id, quizId));

        return { message: "Quiz deletado com sucesso" };
      } catch (error: any) {
        console.error("Error deleting quiz:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });
}

