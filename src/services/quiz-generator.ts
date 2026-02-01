/**
 * Quiz Generator Service
 * Uses OpenAI GPT to generate quiz questions from video transcripts
 */

import OpenAI from "openai";
import { db } from "../db";
import { transcripts, quizzes, quizQuestions } from "../db/schema";
import { eq } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number; // Index of correct option (0-3)
  explanation: string;
}

export interface GeneratedQuiz {
  title: string;
  description: string;
  questions: QuizQuestion[];
}

/**
 * Generate a quiz from a video's transcript using AI
 */
export async function generateQuizFromTranscript(
  videoId: string,
  videoTitle: string,
  numQuestions: number = 5
): Promise<GeneratedQuiz | null> {
  try {
    console.log("📝 [Quiz Service] Searching transcript for video:", videoId);

    // Get transcript for the video
    const transcript = await db.query.transcripts.findFirst({
      where: eq(transcripts.videoId, videoId),
    });

    console.log(
      "📝 [Quiz Service] Transcript found:",
      transcript
        ? {
            id: transcript.id,
            videoId: transcript.videoId,
            contentLength: transcript.content?.length || 0,
            hasContent: !!transcript.content,
          }
        : null
    );

    if (!transcript || !transcript.content) {
      console.error(
        "📝 [Quiz Service] ❌ No transcript found for video:",
        videoId
      );
      return null;
    }

    console.log("📝 [Quiz Service] ✅ Transcript exists, generating quiz...");

    // Limit transcript size to avoid token limits
    const maxTranscriptLength = 8000;
    const transcriptText = transcript.content.slice(0, maxTranscriptLength);

    const prompt = `Você é um professor especialista criando um quiz para testar a compreensão de uma aula.

Baseado na seguinte transcrição de uma aula sobre "${videoTitle}", crie ${numQuestions} perguntas de múltipla escolha.

TRANSCRIÇÃO:
${transcriptText}

REGRAS:
1. Cada pergunta deve ter exatamente 4 opções (A, B, C, D)
2. Apenas UMA opção deve estar correta
3. As perguntas devem testar compreensão real do conteúdo, não apenas memorização
4. Inclua uma breve explicação do porquê a resposta correta está certa
5. As opções incorretas devem ser plausíveis mas claramente erradas
6. Varie a dificuldade das perguntas (algumas fáceis, algumas difíceis)

Responda APENAS com um JSON válido no seguinte formato (sem markdown, sem comentários):
{
  "title": "Quiz: ${videoTitle}",
  "description": "Teste seus conhecimentos sobre o conteúdo desta aula",
  "questions": [
    {
      "question": "Pergunta aqui?",
      "options": ["Opção A", "Opção B", "Opção C", "Opção D"],
      "correctAnswer": 0,
      "explanation": "Explicação do porquê esta é a resposta correta"
    }
  ]
}`;

    console.log(
      `📝 [Quiz Service] Calling OpenAI for video ${videoId} with ${numQuestions} questions...`
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente que gera quizzes educacionais em formato JSON. Sempre responda com JSON válido, sem markdown ou código extra.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content;

    console.log(
      "📝 [Quiz Service] OpenAI response received, length:",
      content?.length || 0
    );

    if (!content) {
      console.error("📝 [Quiz Service] ❌ No content in OpenAI response");
      return null;
    }

    // Parse the JSON response
    try {
      // Remove potential markdown code blocks
      const cleanedContent = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      console.log("📝 [Quiz Service] Parsing JSON response...");

      const quiz: GeneratedQuiz = JSON.parse(cleanedContent);

      console.log(
        "📝 [Quiz Service] ✅ Quiz parsed successfully, questions:",
        quiz.questions?.length || 0
      );

      // Validate structure
      if (
        !quiz.questions ||
        !Array.isArray(quiz.questions) ||
        quiz.questions.length === 0
      ) {
        console.error(
          "📝 [Quiz Service] ❌ Invalid quiz structure: no questions"
        );
        return null;
      }

      // Validate each question
      for (const q of quiz.questions) {
        if (
          !q.question ||
          !Array.isArray(q.options) ||
          q.options.length !== 4 ||
          typeof q.correctAnswer !== "number" ||
          q.correctAnswer < 0 ||
          q.correctAnswer > 3
        ) {
          console.error("📝 [Quiz Service] ❌ Invalid question structure:", q);
          return null;
        }
      }

      console.log(
        `📝 [Quiz Service] ✅ Successfully generated ${quiz.questions.length} questions`
      );
      return quiz;
    } catch (parseError: any) {
      console.error(
        "📝 [Quiz Service] ❌ Error parsing quiz JSON:",
        parseError.message
      );
      console.error(
        "📝 [Quiz Service] Raw content:",
        content?.substring(0, 200)
      );
      return null;
    }
  } catch (error: any) {
    console.error("📝 [Quiz Service] ❌ Error generating quiz:", error.message);
    return null;
  }
}

/**
 * Save generated quiz to database
 */
export async function saveQuizToDatabase(
  videoId: string,
  quiz: GeneratedQuiz
): Promise<string | null> {
  try {
    // Check if quiz already exists for this video
    const existingQuiz = await db.query.quizzes.findFirst({
      where: eq(quizzes.videoId, videoId),
    });

    if (existingQuiz) {
      // Delete existing quiz (cascade will delete questions)
      await db.delete(quizzes).where(eq(quizzes.id, existingQuiz.id));
    }

    // Create new quiz
    const [newQuiz] = await db
      .insert(quizzes)
      .values({
        videoId,
        title: quiz.title,
        description: quiz.description,
        passingScore: 70,
      })
      .returning();

    // Insert questions
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      await db.insert(quizQuestions).values({
        quizId: newQuiz.id,
        question: q.question,
        questionType: "multiple_choice",
        options: JSON.stringify(q.options),
        correctAnswer: q.correctAnswer.toString(),
        explanation: q.explanation || "",
        order: i,
      });
    }

    console.log(`💾 [saveQuizToDatabase] ✅ Quiz saved with ID: ${newQuiz.id}`);
    return newQuiz.id;
  } catch (error: any) {
    const pgCode = error?.cause?.code ?? error?.code;
    const pgMessage = error?.cause?.message ?? error?.message;

    // Postgres error 42P01 => undefined_table (e.g. missing migrations in production)
    if (
      pgCode === "42P01" ||
      (typeof pgMessage === "string" &&
        pgMessage.includes('relation "quizzes" does not exist'))
    ) {
      const migrationError = new Error(
        "Banco de dados sem as tabelas de quiz (migrações pendentes)."
      );
      (migrationError as any).code = "DB_MIGRATION_MISSING";
      throw migrationError;
    }

    console.error(
      "💾 [saveQuizToDatabase] ❌ Error saving quiz to database:",
      error.message
    );
    return null;
  }
}

/**
 * Generate and save quiz in one operation
 */
export async function createQuizForVideo(
  videoId: string,
  videoTitle: string,
  numQuestions: number = 5
): Promise<{ quizId: string; questionsCount: number } | null> {
  console.log("🎯 [createQuizForVideo] Starting:", {
    videoId,
    videoTitle,
    numQuestions,
  });

  const generatedQuiz = await generateQuizFromTranscript(
    videoId,
    videoTitle,
    numQuestions
  );

  if (!generatedQuiz) {
    console.error(
      "🎯 [createQuizForVideo] ❌ Failed to generate quiz from transcript"
    );
    return null;
  }

  console.log("🎯 [createQuizForVideo] Quiz generated, saving to database...");

  const quizId = await saveQuizToDatabase(videoId, generatedQuiz);

  if (!quizId) {
    console.error("🎯 [createQuizForVideo] ❌ Failed to save quiz to database");
    return null;
  }

  console.log("🎯 [createQuizForVideo] ✅ Quiz created successfully:", {
    quizId,
    questionsCount: generatedQuiz.questions.length,
  });

  return {
    quizId,
    questionsCount: generatedQuiz.questions.length,
  };
}

/**
 * Estimate credit cost for quiz generation
 * Baseado no número de perguntas
 */
export function estimateQuizCreditCost(numQuestions: number = 5): number {
  // MVP: 1 crédito a cada 5 perguntas (1-5 => 1, 6-10 => 2)
  return Math.max(1, Math.ceil(numQuestions / 5));
}
