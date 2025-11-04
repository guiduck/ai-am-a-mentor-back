import "dotenv/config";
import { fastify } from "./server";

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3333");
    const host = process.env.HOST || "0.0.0.0";
    await fastify.listen({ port, host });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
