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
import { getR2FileStream, uploadFileToR2 } from "./cloudflare-r2";
import { extractAudioFromVideoStream, isFFmpegAvailable } from "./audio-extractor";

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
    console.log("🎤 R2 Key:", r2Key);
    console.log("🎤 OpenAI API Key configured:", !!process.env.OPENAI_API_KEY);

    // 1. Get video stream from R2 (memory-efficient, doesn't load entire file)
    console.log("📥 Step 1: Getting video stream from R2...");
    const videoStream = await getR2FileStream(r2Key);
    if (!videoStream || !videoStream.Body) {
      return {
        transcript: "",
        error: "Failed to get video stream from R2",
      };
    }

    const fileSizeMB = videoStream.ContentLength
      ? (videoStream.ContentLength / 1024 / 1024).toFixed(2)
      : "unknown";
    console.log("✅ Video stream obtained, size:", fileSizeMB, "MB");

    // 2. Always extract audio for optimal size reduction
    // This allows us to transcribe videos of any length (1+ hours)
    // Audio is typically 90% smaller than video
    // Process directly from stream to avoid loading entire video in memory
    console.log("🎵 Starting audio extraction process...");

    // Check if ffmpeg is available
    console.log("🔍 Checking FFmpeg availability...");
    const ffmpegAvailable = await isFFmpegAvailable();
    console.log("🔍 FFmpeg available:", ffmpegAvailable);

    if (!ffmpegAvailable) {
      console.error("❌ FFmpeg is not available - cannot extract audio");
      return {
        transcript: "",
        error: `FFmpeg is not available. Please install FFmpeg to enable video transcription. Audio extraction is required for videos of any size. Run: apt-get update && apt-get install -y ffmpeg`,
      };
    }

    console.log("🎵 FFmpeg is available, proceeding with audio extraction...");

    // Extract audio from video stream (memory-efficient)
    const extension = r2Key.split(".").pop() || "mp4";
    console.log(
      `🎵 Extracting audio from ${extension} video stream (${fileSizeMB}MB)...`
    );

    const { audioBuffer: extractedAudio, error: extractError } =
      await extractAudioFromVideoStream(videoStream.Body, extension);

    if (extractError) {
      console.error("❌ Audio extraction error:", extractError);
      return {
        transcript: "",
        error: extractError || "Failed to extract audio from video",
      };
    }

    if (!extractedAudio || extractedAudio.length === 0) {
      console.error("❌ Audio extraction returned empty buffer");
      return {
        transcript: "",
        error:
          "Audio extraction returned empty buffer. The video may not contain audio track.",
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
    console.log("📤 Step 4: Sending audio to OpenAI Whisper API...");
    console.log("📤 Audio file size:", audioSizeMB, "MB");
    console.log("📤 Audio file name:", fileName);

    const client = getOpenAIClient();
    console.log("📤 OpenAI client created, creating transcription request...");

    console.log("📤 Sending to OpenAI Whisper API...");
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

    console.log("✅ Transcription completed from OpenAI");
    console.log("✅ Transcript length:", transcriptText.length);
    console.log("✅ Transcript preview:", transcriptText.substring(0, 200));

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
    console.error("❌ Error stack:", error.stack);
    console.error("❌ Error details:", {
      message: error.message,
      status: error.status,
      code: error.code,
    });

    // If it's a 413 error, it means we're still sending the video directly
    // This should not happen if audio extraction is working
    if (error.status === 413 || error.message?.includes("413")) {
      return {
        transcript: "",
        error: `File size limit exceeded. Audio extraction may have failed. Please ensure FFmpeg is installed and try again. Original error: ${error.message}`,
      };
    }

    return {
      transcript: "",
      error: error.message || "Failed to transcribe video",
    };
  }
}
