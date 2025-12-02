import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import * as jwt from "jsonwebtoken";

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
  interface FastifyReply {
    setCookie(
      name: string,
      value: string,
      options?: {
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: "strict" | "lax" | "none";
        path?: string;
        maxAge?: number;
        domain?: string;
      }
    ): this;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Get token from Authorization header or cookies
        let token = request.headers.authorization?.replace("Bearer ", "");
        if (!token) {
          token = request.cookies.access_token;
        }

        if (!token) {
          return reply.code(401).send({
            message: "Unauthorized",
            code: "MISSING_TOKEN",
          });
        }

        // Verify JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
          id: string;
          role: string;
          exp?: number;
        };

        request.user = { id: decoded.id, role: decoded.role };
      } catch (err: any) {
        // Differentiate between expired and invalid tokens
        const isExpired = err.name === "TokenExpiredError";
        return reply.code(401).send({
          message: isExpired ? "Token expired" : "Unauthorized",
          code: isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
        });
      }
    }
  );
});
