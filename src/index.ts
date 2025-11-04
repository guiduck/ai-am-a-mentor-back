import "dotenv/config";
import { fastify } from "./server";

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3333");
    await fastify.listen({ port });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
