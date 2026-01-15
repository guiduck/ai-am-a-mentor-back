/**
 * Leads Routes
 * Handles lead capture from landing page
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import { leads } from "../../db/schema";

const createLeadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  type: z.enum(["creator", "student"]),
  source: z.string().optional(),
  utmSource: z.string().nullable().optional(),
  utmMedium: z.string().nullable().optional(),
  utmCampaign: z.string().nullable().optional(),
});

export async function leadsRoutes(fastify: FastifyInstance) {
  // Create a new lead
  fastify.post("/leads", {
    handler: async (request, reply) => {
      try {
        const data = createLeadSchema.parse(request.body);

        const [lead] = await db
          .insert(leads)
          .values({
            name: data.name,
            email: data.email,
            phone: data.phone,
            type: data.type,
            source: data.source || "landing",
            utmSource: data.utmSource,
            utmMedium: data.utmMedium,
            utmCampaign: data.utmCampaign,
          })
          .returning();

        return reply.status(201).send({
          success: true,
          lead: {
            id: lead.id,
            email: lead.email,
          },
        });
      } catch (error: any) {
        console.error("Error creating lead:", error);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            message: "Dados invalidos",
            details: error.issues,
          });
        }
        return reply.status(500).send({ message: "Falha ao criar lead" });
      }
    },
  });

  // Get all leads (admin only - for future use)
  fastify.get("/leads", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // TODO: Add admin check
        const allLeads = await db.query.leads.findMany({
          orderBy: (leads, { desc }) => [desc(leads.createdAt)],
        });

        return reply.send({ leads: allLeads });
      } catch (error: any) {
        console.error("Error fetching leads:", error);
        return reply.status(500).send({ message: "Falha ao buscar leads" });
      }
    },
  });
}
