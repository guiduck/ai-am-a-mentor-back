/**
 * OpenAI Transcription Service
 * Handles video transcription using OpenAI Whisper API
 */

import OpenAI from "openai";
import { downloadFileFromR2, uploadFileToR2 } from "./cloudflare-r2";

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
 * Transcribe video from R2 key
 * Downloads video, sends to OpenAI Whisper, and returns transcript
 */
export async function transcribeVideoFromR2(
  r2Key: string
): Promise<{ transcript: string; error?: string }> {
  try {
    console.log("🎤 Starting transcription for:", r2Key);

    // 1. Download video from R2
    const videoBuffer = await downloadFileFromR2(r2Key);
    if (!videoBuffer) {
      return {
        transcript: "",
        error: "Failed to download video from R2",
      };
    }

    console.log("✅ Video downloaded, size:", videoBuffer.length);

    // 2. Create a File-like object for OpenAI API
    // OpenAI Whisper accepts video files directly
    // In Node.js, we need to create a File-like object
    const videoFile = new File(
      [videoBuffer],
      r2Key.split("/").pop() || "video.mp4",
      {
        type: "video/mp4",
      }
    );

    // 3. Send to OpenAI Whisper API
    const client = getOpenAIClient();
    console.log("📤 Sending to OpenAI Whisper API...");

    const transcription = await client.audio.transcriptions.create({
      file: videoFile,
      model: "whisper-1",
      language: "pt", // Portuguese
      response_format: "text",
    });

    // When response_format is "text", OpenAI returns a string directly
    const transcriptText =
      typeof transcription === "string"
        ? transcription
        : (transcription as any).text || "";

    console.log("✅ Transcription completed, length:", transcriptText.length);

    // 4. Store transcript in R2 (optional, for backup)
    const transcriptKey = `transcripts/${r2Key.replace(
      /\.(mp4|webm|mov)$/,
      ".txt"
    )}`;
    const transcriptBuffer = Buffer.from(transcriptText, "utf-8");
    await uploadFileToR2(transcriptKey, transcriptBuffer, "text/plain");

    console.log("✅ Transcript stored in R2:", transcriptKey);

    return {
      transcript: transcriptText,
    };
  } catch (error: any) {
    console.error("❌ Transcription error:", error);
    return {
      transcript: "",
      error: error.message || "Failed to transcribe video",
    };
  }
}

/**
 * Transcribe video from URL (for direct URL access)
 */
export async function transcribeVideoFromUrl(
  videoUrl: string
): Promise<{ transcript: string; error?: string }> {
  try {
    console.log("🎤 Starting transcription from URL:", videoUrl);

    // Download video from URL
    const response = await fetch(videoUrl);
    if (!response.ok) {
      return {
        transcript: "",
        error: `Failed to download video: ${response.statusText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const videoBuffer = Buffer.from(arrayBuffer);
    console.log("✅ Video downloaded, size:", videoBuffer.length);

    // Create File object
    const videoFile = new File([videoBuffer], "video.mp4", {
      type: "video/mp4",
    });

    // Send to OpenAI Whisper
    const client = getOpenAIClient();
    console.log("📤 Sending to OpenAI Whisper API...");

    const transcription = await client.audio.transcriptions.create({
      file: videoFile,
      model: "whisper-1",
      language: "pt",
      response_format: "text",
    });

    // When response_format is "text", OpenAI returns a string directly
    const transcriptText =
      typeof transcription === "string"
        ? transcription
        : (transcription as any).text || "";

    console.log("✅ Transcription completed, length:", transcriptText.length);

    return {
      transcript: transcriptText,
    };
  } catch (error: any) {
    console.error("❌ Transcription error:", error);
    return {
      transcript: "",
      error: error.message || "Failed to transcribe video",
    };
  }
}
