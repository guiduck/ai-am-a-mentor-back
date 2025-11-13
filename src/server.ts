import Fastify from "fastify";
import { routes } from "./routes";
import authPlugin from "./plugins/auth";

const fastify = Fastify({
  logger: true,
});

// Register multipart support for file uploads with increased limits
fastify.register(require("@fastify/multipart"), {
  limits: {
    fieldNameSize: 100, // Max field name size in bytes
    fieldSize: 100, // Max field value size in bytes
    fields: 10, // Max number of non-file fields
    fileSize: 500 * 1024 * 1024, // Max file size: 500MB
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
      process.env.FRONTEND_URL,
    ].filter(Boolean);

    if (allowedOrigins.includes(origin)) {
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
});

fastify.register(authPlugin);
fastify.register(routes);

export { fastify };
