import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import { videos, courses, enrollments, transcripts } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import {
  generateUploadUrl,
  generateStreamUrl,
  isR2Configured,
  uploadFileToR2,
  getR2FileStream,
  deleteFileFromR2,
} from "../../services/cloudflare-r2";
import { transcribeVideoFromR2 } from "../../services/openai-transcription";
import { generateAIResponse } from "../../services/openai-chat";

// Type declarations for Fastify multipart plugin
declare module "fastify" {
  interface FastifyRequest {
    file(): Promise<{
      filename: string;
      mimetype: string;
      toBuffer(): Promise<Buffer>;
    } | null>;
  }
}

const uploadUrlSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
});

const createVideoSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(255),
  r2Key: z.string().min(1),
  duration: z.number().int().positive().optional(),
});

const updateVideoSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  duration: z.number().int().positive().optional(),
});

const transcribeSchema = z.object({
  videoId: z.string().uuid(),
});

const chatSchema = z.object({
  videoId: z.string().uuid(),
  question: z.string().min(1, "Pergunta é obrigatória"),
});

export async function videoRoutes(fastify: FastifyInstance) {
  // Generate presigned URL for direct upload to Cloudflare R2
  fastify.post("/videos/upload-direct", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Handle multipart form data
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({ error: "No file uploaded" });
        }

        const { filename, mimetype } = data;
        const buffer = await data.toBuffer();

        // Generate unique key
        const key = `videos/${Date.now()}-${filename}`;

        // Check if R2 is configured
        if (!isR2Configured()) {
          return reply.status(500).send({
            error: "Cloudflare R2 not configured",
            message: "Please configure Cloudflare R2 environment variables",
          });
        }

        // Upload directly to R2
        const success = await uploadFileToR2(key, buffer, mimetype);

        if (!success) {
          return reply.status(500).send({ error: "Failed to upload to R2" });
        }

        return {
          key,
          filename,
          contentType: mimetype,
          size: buffer.length,
          message: "Upload successful",
        };
      } catch (error) {
        console.error("Direct upload failed:", error);
        return reply.status(500).send({ error: "Upload failed" });
      }
    },
  });
  fastify.post("/videos/upload-url", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { filename, contentType } = uploadUrlSchema.parse(request.body);

        // Check if Cloudflare R2 is configured
        if (!isR2Configured()) {
          return reply.status(500).send({
            error: "Cloudflare R2 not configured",
            message: "Please configure Cloudflare R2 environment variables",
          });
        }

        const key = `videos/${Date.now()}-${filename}`;

        // Generate actual presigned POST URL for R2 upload
        const { url, fields } = await generateUploadUrl(key, contentType);

        return {
          uploadUrl: url,
          fields,
          key,
          filename,
          contentType,
          bucket: process.env.CLOUDFLARE_BUCKET_NAME,
        };
      } catch (error) {
        console.error("Upload URL generation failed:", error);
        return reply
          .status(500)
          .send({ error: "Failed to generate upload URL" });
      }
    },
  });

  // Transcribe video using OpenAI Whisper
  fastify.post("/videos/transcribe", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        console.log("📥 Transcription request received");
        console.log("📥 Request body:", request.body);
        console.log("📥 Request headers:", {
          "content-type": request.headers["content-type"],
          "content-length": request.headers["content-length"],
        });

        const { videoId } = transcribeSchema.parse(request.body);
        const userId = request.user.id;

        console.log("📥 Parsed videoId:", videoId);
        console.log("📥 User ID:", userId);

        if (!process.env.OPENAI_API_KEY) {
          return reply.status(500).send({ error: "OpenAI not configured" });
        }

        // 1. Get video from database
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ error: "Video not found" });
        }

        // 2. Check if user has access (creator or enrolled student)
        const isCreator = video.course.creatorId === userId;
        const isEnrolled = await db.query.enrollments.findFirst({
          where: and(
            eq(enrollments.studentId, userId),
            eq(enrollments.courseId, video.courseId)
          ),
        });

        if (!isCreator && !isEnrolled) {
          return reply.status(403).send({
            error: "You don't have access to this video",
          });
        }

        // 3. Check if transcript already exists
        const existingTranscript = await db.query.transcripts.findFirst({
          where: eq(transcripts.videoId, videoId),
        });

        if (existingTranscript) {
          return {
            message: "Transcript already exists",
            transcript: existingTranscript.content,
            videoId,
          };
        }

        // 4. Transcribe video using OpenAI Whisper
        // IMPORTANT: This is a long-running operation that can take minutes.
        // We process it in the background to avoid Render's 30s timeout.
        console.log("🎤 Starting transcription for video:", videoId);

        // Return immediately and process in background
        reply.status(202).send({
          message: "Transcription started. This may take a few minutes.",
          videoId,
          status: "processing",
        });

        // Process transcription in background (don't block the response)
        // Use process.nextTick to ensure it runs after the response is sent
        process.nextTick(async () => {
          try {
            console.log("🔄 Background transcription started for:", videoId);
            console.log("🔄 Video R2 Key:", video.r2Key);

            // Wrap in try-catch to prevent server crash
            const { transcript, error } = await transcribeVideoFromR2(
              video.r2Key
            );

            if (error || !transcript) {
              console.error("❌ Background transcription failed:", error);
              console.error("❌ Video ID:", videoId);
              console.error("❌ R2 Key:", video.r2Key);
              // Optionally, you could store the error in the database or send a notification
              return;
            }

            // Save transcript to database
            console.log("💾 Saving transcript to database...");
            console.log("💾 Transcript length:", transcript.length);
            console.log("💾 Video ID:", videoId);

            const [savedTranscript] = await db
              .insert(transcripts)
              .values({
                videoId: videoId,
                content: transcript,
              })
              .returning();

            console.log("✅ Transcript saved to database:", {
              id: savedTranscript.id,
              videoId: savedTranscript.videoId,
              contentLength: savedTranscript.content.length,
            });

            // Update video with transcript R2 key (optional, for backup)
            const transcriptKey = `transcripts/${video.r2Key.replace(
              /\.(mp4|webm|mov)$/,
              ".txt"
            )}`;
            await db
              .update(videos)
              .set({ transcriptR2Key: transcriptKey })
              .where(eq(videos.id, videoId));

            console.log(
              "✅ Video updated with transcript R2 key:",
              transcriptKey
            );
            console.log(
              "✅ Background transcription completed successfully for:",
              videoId
            );
          } catch (error: any) {
            console.error("❌ Background transcription error:", error);
            console.error("❌ Error stack:", error.stack);
          }
        });

        // Response already sent, don't return anything
        return;
      } catch (error: any) {
        console.error("❌ Transcription endpoint error:", error);
        console.error("❌ Error name:", error.name);
        console.error("❌ Error message:", error.message);
        console.error("❌ Error stack:", error.stack);
        console.error("❌ Error code:", error.code);
        console.error("❌ Error status:", error.status);
        console.error("❌ Error statusCode:", error.statusCode);

        // If it's a body size error, provide helpful message
        if (
          error.message?.includes("413") ||
          error.message?.includes("Maximum content size") ||
          error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ) {
          return reply.status(413).send({
            error:
              "Request body too large. The transcription endpoint only accepts a videoId in JSON format. If you're trying to upload a video, use the direct R2 upload endpoint instead.",
            code: "BODY_TOO_LARGE",
          });
        }

        return reply.status(500).send({
          error: error.message || "Failed to transcribe video",
        });
      }
    },
  });

  // Get transcript for a video
  fastify.get("/videos/:videoId/transcript", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const userId = request.user.id;

        // 1. Get video and check access
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ error: "Video not found" });
        }

        const isCreator = video.course.creatorId === userId;
        const isEnrolled = await db.query.enrollments.findFirst({
          where: and(
            eq(enrollments.studentId, userId),
            eq(enrollments.courseId, video.courseId)
          ),
        });

        if (!isCreator && !isEnrolled) {
          return reply.status(403).send({
            error: "You don't have access to this video",
          });
        }

        // 2. Get transcript from database
        const transcript = await db.query.transcripts.findFirst({
          where: eq(transcripts.videoId, videoId),
        });

        if (!transcript) {
          return reply.status(404).send({
            error: "Transcript not found. Please transcribe the video first.",
          });
        }

        return {
          transcript: transcript.content,
          videoId,
          createdAt:
            transcript.createdAt?.toISOString() || new Date().toISOString(),
        };
      } catch (error: any) {
        console.error("Error fetching transcript:", error);
        return reply.status(500).send({
          error: error.message || "Failed to fetch transcript",
        });
      }
    },
  });

  // AI Chat endpoint - answer questions based on video transcript
  fastify.post("/videos/chat", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId, question } = chatSchema.parse(request.body);
        const userId = request.user.id;

        if (!process.env.OPENAI_API_KEY) {
          return reply.status(500).send({ error: "OpenAI not configured" });
        }

        // 1. Get video and check access
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ error: "Video not found" });
        }

        const isCreator = video.course.creatorId === userId;
        const isEnrolled = await db.query.enrollments.findFirst({
          where: and(
            eq(enrollments.studentId, userId),
            eq(enrollments.courseId, video.courseId)
          ),
        });

        if (!isCreator && !isEnrolled) {
          return reply.status(403).send({
            error: "You don't have access to this video",
          });
        }

        // 2. Get transcript
        console.log("📚 Fetching transcript for video:", videoId);
        const transcript = await db.query.transcripts.findFirst({
          where: eq(transcripts.videoId, videoId),
        });

        console.log("📚 Transcript found:", !!transcript);
        if (transcript) {
          console.log("📚 Transcript length:", transcript.content.length);
          console.log(
            "📚 Transcript preview:",
            transcript.content.substring(0, 100)
          );
        }

        if (!transcript) {
          console.error("❌ Transcript not found for video:", videoId);
          return reply.status(404).send({
            error: "Transcript not found. Please transcribe the video first.",
          });
        }

        // 3. Generate AI response
        console.log("🤖 Generating AI response for video:", videoId);
        console.log("🤖 Question:", question);
        console.log("🤖 Video title:", video.title);
        const { response, error } = await generateAIResponse(
          transcript.content,
          question,
          video.title
        );

        if (error || !response) {
          return reply.status(500).send({
            error: error || "Failed to generate AI response",
          });
        }

        return {
          response,
          videoId,
          question,
        };
      } catch (error: any) {
        console.error("AI chat error:", error);
        return reply.status(500).send({
          error: error.message || "Failed to process chat request",
        });
      }
    },
  });

  // Create a video/lesson for a course (creators only)
  fastify.post("/videos", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { courseId, title, r2Key, duration } = createVideoSchema.parse(
          request.body
        );
        const creatorId = request.user.id;

        // Verify the course exists and belongs to the creator
        const course = await db.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });

        if (!course) {
          return reply.status(404).send({ message: "Course not found" });
        }

        if (course.creatorId !== creatorId) {
          return reply
            .status(403)
            .send({ message: "You can only add videos to your own courses" });
        }

        // Check if course already has 500 videos (limit)
        const videoCount = await db
          .select()
          .from(videos)
          .where(eq(videos.courseId, courseId));
        if (videoCount.length >= 500) {
          return reply
            .status(400)
            .send({ message: "Course has reached maximum of 500 videos" });
        }

        // Create the video
        const newVideo = await db
          .insert(videos)
          .values({
            courseId,
            title,
            r2Key,
            duration,
          })
          .returning();

        return reply.status(201).send({
          message: "Video created successfully",
          video: newVideo[0],
        });
      } catch (error) {
        console.error("Error creating video:", error);
        return reply.status(500).send({ message: "Failed to create video" });
      }
    },
  });

  // Get videos for a specific course
  fastify.get("/courses/:courseId/videos", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { courseId } = request.params as { courseId: string };
        const userId = request.user.id;
        const userRole = request.user.role;

        // Verify the course exists
        const course = await db.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });

        if (!course) {
          return reply.status(404).send({ message: "Course not found" });
        }

        // If user is a creator, they can only see videos from their own courses
        // If user is a student, they can only see videos from courses they're enrolled in
        if (userRole === "creator" && course.creatorId !== userId) {
          return reply.status(403).send({
            message: "You can only view videos from your own courses",
          });
        }

        if (userRole === "student") {
          // Check if student is enrolled in this course
          const enrollment = await db.query.enrollments.findFirst({
            where: and(
              eq(enrollments.studentId, userId),
              eq(enrollments.courseId, courseId)
            ),
          });

          if (!enrollment) {
            return reply.status(403).send({
              message: "You must be enrolled in this course to view videos",
            });
          }
        }

        // Get all videos for the course
        const courseVideos = await db.query.videos.findMany({
          where: eq(videos.courseId, courseId),
        });

        return courseVideos;
      } catch (error) {
        console.error("Error fetching course videos:", error);
        return reply.status(500).send({ message: "Failed to fetch videos" });
      }
    },
  });

  // Get a specific video by ID
  fastify.get("/videos/:videoId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const userId = request.user.id;
        const userRole = request.user.role;

        // Get the video with course information
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ message: "Video not found" });
        }

        // Check access permissions
        if (userRole === "creator" && video.course.creatorId !== userId) {
          return reply.status(403).send({
            message: "You can only access videos from your own courses",
          });
        }

        if (userRole === "student") {
          // Check if student is enrolled in this course
          const enrollment = await db.query.enrollments.findFirst({
            where: and(
              eq(enrollments.studentId, userId),
              eq(enrollments.courseId, video.courseId)
            ),
          });

          if (!enrollment) {
            return reply.status(403).send({
              message: "You must be enrolled in this course to view this video",
            });
          }
        }

        return video;
      } catch (error) {
        console.error("Error fetching video:", error);
        return reply.status(500).send({ message: "Failed to fetch video" });
      }
    },
  });

  // Update a video (creators only)
  fastify.put("/videos/:videoId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const updateData = updateVideoSchema.parse(request.body);
        const creatorId = request.user.id;

        // Get the video with course information
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ message: "Video not found" });
        }

        // Check if the creator owns this course
        if (video.course.creatorId !== creatorId) {
          return reply.status(403).send({
            message: "You can only update videos from your own courses",
          });
        }

        // Update the video
        const updatedVideo = await db
          .update(videos)
          .set(updateData)
          .where(eq(videos.id, videoId))
          .returning();

        return {
          message: "Video updated successfully",
          video: updatedVideo[0],
        };
      } catch (error) {
        console.error("Error updating video:", error);
        return reply.status(500).send({ message: "Failed to update video" });
      }
    },
  });

  // Delete a video (creators only)
  fastify.delete("/videos/:videoId", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const creatorId = request.user.id;

        // Get the video with course information
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ message: "Video not found" });
        }

        // Check if the creator owns this course
        if (video.course.creatorId !== creatorId) {
          return reply.status(403).send({
            message: "You can only delete videos from your own courses",
          });
        }

        // Delete video file from R2 before deleting from database
        if (video.r2Key) {
          await deleteFileFromR2(video.r2Key);
        }

        // Delete transcript file from R2 if exists
        if (video.transcriptR2Key) {
          await deleteFileFromR2(video.transcriptR2Key);
        }

        // Delete the video (transcripts will be deleted by CASCADE)
        await db.delete(videos).where(eq(videos.id, videoId));

        return { message: "Video deleted successfully" };
      } catch (error) {
        console.error("Error deleting video:", error);
        return reply.status(500).send({ message: "Failed to delete video" });
      }
    },
  });

  // Generate streaming URL for a video
  fastify.get("/videos/:videoId/stream", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const userId = request.user.id;
        const userRole = request.user.role;

        // Get the video with course information
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ message: "Video not found" });
        }

        // Check access permissions
        if (userRole === "creator" && video.course.creatorId !== userId) {
          return reply.status(403).send({
            message: "You can only access videos from your own courses",
          });
        }

        if (userRole === "student") {
          // Check if student is enrolled in this course
          const enrollment = await db.query.enrollments.findFirst({
            where: and(
              eq(enrollments.studentId, userId),
              eq(enrollments.courseId, video.courseId)
            ),
          });

          if (!enrollment) {
            return reply.status(403).send({
              message: "You must be enrolled in this course to view this video",
            });
          }
        }

        // Check if R2 is configured
        if (!isR2Configured()) {
          return reply.status(500).send({
            error: "Cloudflare R2 not configured",
            message: "Video streaming is not available",
          });
        }

        // Generate streaming URL
        const streamUrl = await generateStreamUrl(video.r2Key);

        return {
          streamUrl,
          video: {
            id: video.id,
            title: video.title,
            duration: video.duration,
          },
        };
      } catch (error) {
        console.error("Error generating stream URL:", error);
        return reply
          .status(500)
          .send({ message: "Failed to generate stream URL" });
      }
    },
  });

  // Proxy endpoint to stream video directly (avoids CORS issues)
  fastify.get("/videos/:videoId/proxy", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { videoId } = request.params as { videoId: string };
        const userId = request.user.id;
        const userRole = request.user.role;

        // Get the video with course information
        const video = await db.query.videos.findFirst({
          where: eq(videos.id, videoId),
          with: {
            course: true,
          },
        });

        if (!video) {
          return reply.status(404).send({ message: "Video not found" });
        }

        // Check access permissions
        if (userRole === "creator" && video.course.creatorId !== userId) {
          return reply.status(403).send({
            message: "You can only access videos from your own courses",
          });
        }

        if (userRole === "student") {
          // Check if student is enrolled in this course
          const enrollment = await db.query.enrollments.findFirst({
            where: and(
              eq(enrollments.studentId, userId),
              eq(enrollments.courseId, video.courseId)
            ),
          });

          if (!enrollment) {
            return reply.status(403).send({
              message: "You must be enrolled in this course to view this video",
            });
          }
        }

        // Check if R2 is configured
        if (!isR2Configured()) {
          return reply.status(500).send({
            error: "Cloudflare R2 not configured",
            message: "Video streaming is not available",
          });
        }

        // Get file stream from R2
        console.log("🎬 Requesting video stream:", {
          videoId,
          r2Key: video.r2Key,
          userId,
          userRole,
        });

        const fileStream = await getR2FileStream(video.r2Key);

        if (!fileStream || !fileStream.Body) {
          console.error("❌ Failed to get file stream from R2:", {
            videoId,
            r2Key: video.r2Key,
            hasFileStream: !!fileStream,
            hasBody: !!fileStream?.Body,
          });
          return reply.status(404).send({
            message: "Video file not found in R2",
            r2Key: video.r2Key,
          });
        }

        // Support range requests for video seeking
        const range = request.headers.range;
        const contentLength = fileStream.ContentLength || 0;

        // Parse range if present
        let start = 0;
        let end = contentLength - 1;
        let chunkSize = contentLength;

        if (range && contentLength) {
          const parts = range.replace(/bytes=/, "").split("-");
          start = parseInt(parts[0], 10);
          end = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;
          chunkSize = end - start + 1;
        }

        // Set headers for video streaming
        reply.header("Accept-Ranges", "bytes");
        reply.header("Content-Type", fileStream.ContentType || "video/mp4");
        reply.header("Cache-Control", "public, max-age=3600");

        // Handle range requests (for video seeking)
        if (range && contentLength) {
          reply
            .code(206)
            .header("Content-Range", `bytes ${start}-${end}/${contentLength}`)
            .header("Content-Length", chunkSize.toString());
        } else {
          if (contentLength) {
            reply.header("Content-Length", contentLength.toString());
          }
        }

        console.log("📤 Sending stream to client:", {
          statusCode: range && contentLength ? 206 : 200,
          contentType: fileStream.ContentType,
          contentLength: range && contentLength ? chunkSize : contentLength,
          hasStream: !!fileStream.Body,
          isPipeable: fileStream.Body?.pipe ? true : false,
          range: range || "none",
        });

        // Add event listeners to track stream lifecycle
        if (fileStream.Body && fileStream.Body.on) {
          fileStream.Body.on("data", (chunk: Buffer | Uint8Array) => {
            // Log first chunk to confirm streaming started
            if (!fileStream.Body._loggedFirstChunk) {
              console.log(
                "📦 First chunk received from R2, size:",
                chunk.length
              );
              fileStream.Body._loggedFirstChunk = true;
            }
          });

          fileStream.Body.on("end", () => {
            console.log("✅ R2 stream ended successfully");
          });

          fileStream.Body.on("error", (error: Error) => {
            console.error("❌ R2 stream error:", error);
          });

          fileStream.Body.on("close", () => {
            console.log("📪 R2 stream closed");
          });
        }

        // Track reply events before piping
        reply.raw.on("close", () => {
          console.log("📪 Client connection closed");
          // Clean up R2 stream when client disconnects
          if (fileStream.Body && fileStream.Body.destroy) {
            fileStream.Body.destroy();
          }
        });

        reply.raw.on("finish", () => {
          console.log("✅ Response finished sending");
        });

        reply.raw.on("error", (error: Error) => {
          console.error("❌ Response stream error:", error);
          // Clean up on error
          if (fileStream.Body && fileStream.Body.destroy) {
            fileStream.Body.destroy();
          }
        });

        // Handle R2 stream errors
        if (fileStream.Body && fileStream.Body.on) {
          fileStream.Body.on("error", (error: Error) => {
            console.error("❌ R2 stream error:", error);
            if (!reply.raw.destroyed) {
              reply.raw.destroy();
            }
          });

          fileStream.Body.on("end", () => {
            console.log("✅ R2 stream ended successfully");
          });
        }

        // Pipe R2 stream directly to response
        // Use pipeline for better error handling
        const stream = fileStream.Body;
        if (stream && stream.pipe) {
          console.log("📤 Piping R2 stream directly to client...");
          stream.pipe(reply.raw);

          // Don't return anything - let the pipe handle it
          return;
        } else {
          // Fallback to reply.send if pipe is not available
          console.log("📤 Using reply.send as fallback...");
          return reply.send(stream);
        }
      } catch (error) {
        console.error("Error streaming video:", error);
        return reply.status(500).send({ message: "Failed to stream video" });
      }
    },
  });
}
