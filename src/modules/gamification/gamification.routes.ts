/**
 * Gamification Routes
 * Handles XP, levels, badges, streaks, and leaderboards
 */

import { FastifyInstance } from "fastify";
import {
  getUserProgress,
  getUserBadges,
  getAllBadges,
  getLeaderboard,
} from "../../services/gamification";

export async function gamificationRoutes(fastify: FastifyInstance) {
  // Get user's progress (XP, level, streak)
  fastify.get("/gamification/progress", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const progress = await getUserProgress(userId);

        return {
          success: true,
          progress,
        };
      } catch (error: any) {
        console.error("Error fetching progress:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Get user's badges
  fastify.get("/gamification/badges", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const badges = await getUserBadges(userId);

        return {
          success: true,
          badges,
        };
      } catch (error: any) {
        console.error("Error fetching badges:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Get all available badges
  fastify.get("/gamification/badges/all", {
    handler: async (request, reply) => {
      try {
        const badges = await getAllBadges();

        return {
          success: true,
          badges,
        };
      } catch (error: any) {
        console.error("Error fetching all badges:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });

  // Get leaderboard
  fastify.get("/gamification/leaderboard", {
    handler: async (request, reply) => {
      try {
        const { limit } = request.query as { limit?: string };
        const leaderboard = await getLeaderboard(
          limit ? parseInt(limit, 10) : 10
        );

        return {
          success: true,
          leaderboard,
        };
      } catch (error: any) {
        console.error("Error fetching leaderboard:", error);
        return reply.status(500).send({ error: error.message });
      }
    },
  });
}

