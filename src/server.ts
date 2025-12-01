import Fastify from "fastify";
import { routes } from "./routes";
import authPlugin from "./plugins/auth";

const fastify = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB - enough for JSON requests, videos are uploaded directly to R2
  requestTimeout: 300000, // 5 minutes - transcription can take a while
  connectionTimeout: 300000, // 5 minutes
});

// Register multipart support for file uploads with increased limits
// Note: For large video uploads, we recommend using direct R2 upload (presigned URLs)
// This limit is kept for backward compatibility with the old upload method
fastify.register(require("@fastify/multipart"), {
  limits: {
    fieldNameSize: 100, // Max field name size in bytes
    fieldSize: 100, // Max field value size in bytes
    fields: 10, // Max number of non-file fields
    fileSize: 2 * 1024 * 1024 * 1024, // Max file size: 2GB (browser limit)
    files: 1, // Max number of file fields
    headerPairs: 2000, // Max number of header key=>value pairs
  },
});

// Register cookie support
fastify.register(require("@fastify/cookie"));

// Register CORS
fastify.register(require("@fastify/cors"), {
  origin: (
    origin: string | undefined,
    cb: (err: Error | null, allow: boolean) => void
  ) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return cb(null, true);

    // Build list of allowed origins
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://localhost:3000",
      process.env.FRONTEND_URL?.replace(/\/$/, ""),
    ].filter(Boolean);

    // Check if origin is in allowed list or is a Netlify deploy
    const isNetlifyDeploy = origin.endsWith(".netlify.app");
    const isAllowed = allowedOrigins.includes(origin) || isNetlifyDeploy;

    if (isAllowed) {
      cb(null, true);
    } else {
      // For development, allow all origins (convenience)
      if (process.env.NODE_ENV !== "production") {
        cb(null, true);
      } else {
        // In production, only allow configured origins
        console.warn(`CORS blocked origin: ${origin}`);
        console.warn(`Allowed origins: ${allowedOrigins.join(", ")}`);
        cb(new Error("Not allowed by CORS"), false);
      }
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Type", "Authorization"],
});

// Global error handler for better logging
fastify.setErrorHandler((error, request, reply) => {
  console.error("❌ Global error handler triggered:");
  console.error("❌ Error name:", error.name);
  console.error("❌ Error message:", error.message);
  console.error("❌ Error code:", error.code);
  console.error("❌ Error statusCode:", error.statusCode);
  console.error("❌ Request URL:", request.url);
  console.error("❌ Request method:", request.method);
  console.error("❌ Request headers:", {
    "content-type": request.headers["content-type"],
    "content-length": request.headers["content-length"],
  });

  // Handle body size errors specifically
  if (
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE" ||
    error.message?.includes("413") ||
    error.message?.includes("Maximum content size")
  ) {
    console.error("❌ Body size limit exceeded!");
    return reply.status(413).send({
      error:
        "Request body too large. The transcription endpoint only accepts a videoId in JSON format. Videos are stored in R2 and downloaded server-side.",
      code: "BODY_TOO_LARGE",
      suggestion:
        "Ensure you're only sending { videoId: 'uuid' } in the request body.",
    });
  }

  // Default error response
  reply.status(error.statusCode || 500).send({
    error: error.message || "Internal server error",
    code: error.code,
  });
});

fastify.register(authPlugin);
fastify.register(routes);

export { fastify };
