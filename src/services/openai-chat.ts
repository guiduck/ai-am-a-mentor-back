/**
 * OpenAI Chat Service
 * Handles AI chat responses using OpenAI GPT with video transcript context
 */

import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
}

/**
 * Generate AI response based on video transcript and user question
 */
export async function generateAIResponse(
  transcript: string,
  question: string,
  videoTitle?: string
): Promise<{ response: string; error?: string }> {
  try {
    console.log("🤖 Generating AI response for question:", question.substring(0, 50));

    const client = getOpenAIClient();

    // Build system prompt
    const systemPrompt = `Você é um mentor de IA especializado em ajudar estudantes a entenderem o conteúdo de aulas em vídeo.

Sua função é:
- Responder perguntas dos estudantes baseado APENAS no conteúdo da transcrição do vídeo
- Explicar conceitos de forma clara e didática
- Se a pergunta não estiver relacionada ao conteúdo do vídeo, informe educadamente que você só pode ajudar com questões sobre esta aula específica
- Use linguagem clara e acessível, como um tutor paciente

IMPORTANTE: Baseie suas respostas exclusivamente na transcrição fornecida. Se a informação não estiver na transcrição, diga que não tem essa informação disponível neste vídeo.`;

    // Build user message with context
    const contextMessage = videoTitle
      ? `Transcrição da aula "${videoTitle}":\n\n${transcript}\n\n---\n\nPergunta do estudante: ${question}`
      : `Transcrição da aula:\n\n${transcript}\n\n---\n\nPergunta do estudante: ${question}`;

    console.log("📤 Sending to OpenAI Chat API...");

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // Using gpt-4o-mini for cost efficiency
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: contextMessage,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const response = completion.choices[0]?.message?.content || "";

    console.log("✅ AI response generated, length:", response.length);

    return {
      response,
    };
  } catch (error: any) {
    console.error("❌ AI chat error:", error);
    return {
      response: "",
      error: error.message || "Failed to generate AI response",
    };
  }
}




