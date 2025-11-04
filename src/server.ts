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
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
});

fastify.register(authPlugin);
fastify.register(routes);

export { fastify };
