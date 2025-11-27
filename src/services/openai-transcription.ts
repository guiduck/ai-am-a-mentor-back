/**
 * OpenAI Transcription Service
 * Handles video transcription using OpenAI Whisper API
 *
 * Supports videos of any size (including 1+ hour videos) by automatically
 * extracting audio, which is much smaller than video files.
 *
 * Audio extraction reduces file size by ~90%, allowing transcription of
 * very long videos while staying within OpenAI's 25MB limit.
 */

import OpenAI from "openai";
import { downloadFileFromR2, uploadFileToR2 } from "./cloudflare-r2";
import { extractAudioFromVideo, isFFmpegAvailable } from "./audio-extractor";

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
 *
 * Always extracts audio from video for optimal size reduction.
 * Supports videos of any length (including 1+ hour videos).
 *
 * @param r2Key - Cloudflare R2 key of the video file
 * @returns Transcript text or error message
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

    const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
    console.log("✅ Video downloaded, size:", fileSizeMB, "MB");

    // 2. Always extract audio for optimal size reduction
    // This allows us to transcribe videos of any length (1+ hours)
    // Audio is typically 90% smaller than video
    console.log("🎵 Extracting audio from video...");

    // Check if ffmpeg is available
    const ffmpegAvailable = await isFFmpegAvailable();
    if (!ffmpegAvailable) {
      return {
        transcript: "",
        error: `FFmpeg is not available. Please install FFmpeg to enable video transcription. Audio extraction is required for videos of any size.`,
      };
    }

    // Extract audio from video (always, regardless of size)
    const extension = r2Key.split(".").pop() || "mp4";
    const { audioBuffer: extractedAudio, error: extractError } =
      await extractAudioFromVideo(videoBuffer, extension);

    if (extractError || !extractedAudio || extractedAudio.length === 0) {
      return {
        transcript: "",
        error: extractError || "Failed to extract audio from video",
      };
    }

    const audioSizeMB = (extractedAudio.length / 1024 / 1024).toFixed(2);
    console.log(
      `✅ Audio extracted, size: ${audioSizeMB}MB (reduced from ${fileSizeMB}MB)`
    );

    // Check OpenAI's 25MB limit (audio should always be well under this)
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB in bytes
    if (extractedAudio.length > MAX_FILE_SIZE) {
      // This should be extremely rare (would require ~4+ hours of audio at 64kbps)
      return {
        transcript: "",
        error: `Extracted audio is too large (${audioSizeMB}MB). This video may be too long. Please split into smaller segments.`,
      };
    }

    const fileName = `${
      r2Key
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") || "audio"
    }.mp3`;

    // 3. Create a File-like object for OpenAI API
    const audioFile = new File([extractedAudio], fileName, {
      type: "audio/mpeg",
    });

    // 4. Send to OpenAI Whisper API
    const client = getOpenAIClient();
    console.log("📤 Sending audio to OpenAI Whisper API...");

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
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

    // 5. Store transcript in R2 (optional, for backup)
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
