import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
  interface FastifyRequest {
    user: {
      id: string;
      role: string;
    };
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Debug logging
        console.log("Auth check - URL:", request.url);
        console.log(
          "Auth check - Headers auth:",
          request.headers.authorization ? "Present" : "Missing"
        );
        console.log(
          "Auth check - Cookies:",
          Object.keys(request.cookies || {})
        );

        // Try to get token from Authorization header first
        let token = request.headers.authorization?.replace("Bearer ", "");

        // If no header token, try to get from cookies
        if (!token) {
          token = request.cookies.access_token;
        }

        console.log("Auth check - Token found:", token ? "Yes" : "No");

        if (!token) {
          throw new Error("Missing token");
        }

        console.log("Auth check - Attempting JWT verification...");
        const decoded = jwt.verify(token, process.env.JWT_SECRET!);
        console.log("Auth check - JWT verification successful:", decoded);
        request.user = decoded as { id: string; role: string };
      } catch (err) {
        console.log("Auth check - JWT verification failed:", err.message);
        reply.code(401).send({ message: "Unauthorized" });
      }
    }
  );
});
