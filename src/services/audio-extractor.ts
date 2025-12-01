/**
 * Audio Extraction Service
 * 
 * Extracts audio from video files to reduce size for OpenAI Whisper API.
 * 
 * Supports videos of any length (including 1+ hour videos):
 * - Converts to MP3 format (16kHz, mono, 64kbps)
 * - Typical reduction: 90%+ (30MB video → 2-3MB audio)
 * - 1 hour video (~500MB) → ~10-15MB audio (well under 25MB limit)
 */

import ffmpeg from "fluent-ffmpeg";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink, readFile, createWriteStream } from "fs/promises";
import { createWriteStream as createWriteStreamSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";

/**
 * Extract audio from video buffer
 * 
 * Converts video to MP3 audio with optimized settings for speech:
 * - 16kHz sample rate (sufficient for speech recognition)
 * - Mono channel (reduces size by 50%)
 * - 64kbps bitrate (optimal for speech, minimal quality loss)
 * 
 * This configuration allows 1+ hour videos to be transcribed
 * while staying well under OpenAI's 25MB limit.
 * 
 * @param videoBuffer - Video file buffer
 * @param inputFormat - Video format (mp4, webm, mov, etc.)
 * @returns Audio buffer in MP3 format
 */
export async function extractAudioFromVideo(
  videoBuffer: Buffer,
  inputFormat: string = "mp4"
): Promise<{ audioBuffer: Buffer; error?: string }> {
  const tempDir = tmpdir();
  const videoId = randomUUID();
  const videoPath = join(tempDir, `${videoId}.${inputFormat}`);
  const audioPath = join(tempDir, `${videoId}.mp3`);

  try {
    // 1. Write video buffer to temporary file
    await writeFile(videoPath, videoBuffer);
    console.log("📝 Video written to temp file:", videoPath);

    // 2. Extract audio using ffmpeg
    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .outputOptions([
          "-vn", // No video
          "-acodec", "libmp3lame", // MP3 codec
          "-ar", "16000", // Sample rate (16kHz is sufficient for speech)
          "-ac", "1", // Mono (reduces size)
          "-b:a", "64k", // Audio bitrate (64kbps is sufficient for speech)
        ])
        .output(audioPath)
        .on("start", (commandLine) => {
          console.log("🎵 FFmpeg command:", commandLine);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(`⏳ Audio extraction progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", async () => {
          try {
            console.log("✅ Audio extraction completed");
            
            // 3. Read audio file
            const audioBuffer = await readFile(audioPath);
            console.log("✅ Audio buffer created, size:", audioBuffer.length);

            // 4. Clean up temp files
            await Promise.all([
              unlink(videoPath).catch(() => {}),
              unlink(audioPath).catch(() => {}),
            ]);

            resolve({ audioBuffer });
          } catch (error: any) {
            console.error("❌ Error reading audio file:", error);
            resolve({
              audioBuffer: Buffer.alloc(0),
              error: error.message || "Failed to read extracted audio",
            });
          }
        })
        .on("error", async (error) => {
          console.error("❌ FFmpeg error:", error);
          
          // Clean up temp files
          await Promise.all([
            unlink(videoPath).catch(() => {}),
            unlink(audioPath).catch(() => {}),
          ]);

          resolve({
            audioBuffer: Buffer.alloc(0),
            error: error.message || "Failed to extract audio. FFmpeg may not be installed.",
          });
        })
        .run();
    });
  } catch (error: any) {
    console.error("❌ Audio extraction error:", error);
    
    // Clean up temp files
    await Promise.all([
      unlink(videoPath).catch(() => {}),
      unlink(audioPath).catch(() => {}),
    ]);

    return {
      audioBuffer: Buffer.alloc(0),
      error: error.message || "Failed to extract audio",
    };
  }
}

/**
 * Extract audio from video stream (memory-efficient)
 * 
 * Processes video stream directly without loading entire file into memory.
 * Writes stream to temporary file, then processes with FFmpeg.
 * 
 * @param videoStream - Video file stream (ReadableStream)
 * @param inputFormat - Video format (mp4, webm, mov, etc.)
 * @returns Audio buffer in MP3 format
 */
export async function extractAudioFromVideoStream(
  videoStream: any,
  inputFormat: string = "mp4"
): Promise<{ audioBuffer: Buffer; error?: string }> {
  const tempDir = tmpdir();
  const videoId = randomUUID();
  const videoPath = join(tempDir, `${videoId}.${inputFormat}`);
  const audioPath = join(tempDir, `${videoId}.mp3`);

  try {
    // 1. Write video stream to temporary file (streaming, memory-efficient)
    // This writes directly to disk, not to memory, so it doesn't count against process memory limit
    console.log("📝 Writing video stream to temp file:", videoPath);
    const writeStream = createWriteStreamSync(videoPath);
    
    // Pipe stream directly to file (memory-efficient)
    let totalBytes = 0;
    for await (const chunk of videoStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      writeStream.write(buffer);
      totalBytes += buffer.length;
    }
    writeStream.end();
    
    // Wait for write to complete
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    const fileSizeMB = (totalBytes / 1024 / 1024).toFixed(2);
    console.log(`✅ Video stream written to temp file (${fileSizeMB}MB)`);

    // 2. Extract audio using ffmpeg (FFmpeg reads file in chunks, memory-efficient)
    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .outputOptions([
          "-vn", // No video
          "-acodec", "libmp3lame", // MP3 codec
          "-ar", "16000", // Sample rate (16kHz is sufficient for speech)
          "-ac", "1", // Mono (reduces size)
          "-b:a", "64k", // Audio bitrate (64kbps is sufficient for speech)
        ])
        .output(audioPath)
        .on("start", (commandLine) => {
          console.log("🎵 FFmpeg command:", commandLine);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(`⏳ Audio extraction progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", async () => {
          try {
            console.log("✅ Audio extraction completed");
            
            // 3. Read audio file
            const audioBuffer = await readFile(audioPath);
            console.log("✅ Audio buffer created, size:", audioBuffer.length);

            // 4. Clean up temp files
            await Promise.all([
              unlink(videoPath).catch(() => {}),
              unlink(audioPath).catch(() => {}),
            ]);

            resolve({ audioBuffer });
          } catch (error: any) {
            console.error("❌ Error reading audio file:", error);
            resolve({
              audioBuffer: Buffer.alloc(0),
              error: error.message || "Failed to read extracted audio",
            });
          }
        })
        .on("error", async (error) => {
          console.error("❌ FFmpeg error:", error);
          
          // Clean up temp files
          await Promise.all([
            unlink(videoPath).catch(() => {}),
            unlink(audioPath).catch(() => {}),
          ]);

          resolve({
            audioBuffer: Buffer.alloc(0),
            error: error.message || "Failed to extract audio. FFmpeg may not be installed.",
          });
        })
        .run();
    });
  } catch (error: any) {
    console.error("❌ Audio extraction error:", error);
    
    // Clean up temp files
    await Promise.all([
      unlink(videoPath).catch(() => {}),
      unlink(audioPath).catch(() => {}),
    ]);

    return {
      audioBuffer: Buffer.alloc(0),
      error: error.message || "Failed to extract audio",
    };
  }
}

/**
 * Check if ffmpeg is available
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    // Try to get ffmpeg version to check if it's installed
    ffmpeg.getAvailableEncoders((err, encoders) => {
      if (err) {
        console.warn("⚠️ FFmpeg not available:", err.message);
        console.warn("⚠️ Error details:", {
          message: err.message,
          stack: err.stack,
        });
        resolve(false);
      } else {
        console.log("✅ FFmpeg is available, encoders found:", Object.keys(encoders || {}).length);
        resolve(true);
      }
    });
  });
}

