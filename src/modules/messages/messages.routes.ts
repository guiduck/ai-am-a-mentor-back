import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db";
import {
  conversations,
  courses,
  enrollments,
  messageNotificationLogs,
  messageReads,
  messages,
  users,
} from "../../db/schema";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { getUserPlanFeatures } from "../../services/subscriptions";
import { sendMessageNotificationEmail } from "../../services/email";

const EMAIL_RATE_LIMIT_MINUTES = 15;

const messageSchema = z.object({
  message: z
    .string()
    .min(1, "Mensagem obrigatória")
    .max(2000, "Mensagem muito longa"),
});

const startConversationSchema = z.object({
  courseId: z.string().uuid("Curso inválido"),
  recipientId: z.string().uuid("Usuário inválido").optional(),
  message: z.string().max(2000, "Mensagem muito longa").optional(),
});

const listMessagesQuerySchema = z.object({
  since: z.string().optional(),
});

function parseSinceDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

async function ensureCreatorChatAccess(
  creatorId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const features = await getUserPlanFeatures(creatorId);
  if (features.support === "community") {
    return {
      allowed: false,
      reason: "Chat indisponível no plano atual do criador.",
    };
  }

  return { allowed: true };
}

/**
 * Retorna o destinatário se ele pode receber emails de notificação.
 */
async function getNotificationRecipient(
  recipientId: string
): Promise<{ email: string; username: string | null } | null> {
  try {
    const recipient = await db.query.users.findFirst({
      where: eq(users.id, recipientId),
      columns: { email: true, username: true, emailNotificationsEnabled: true },
    });

    if (!recipient?.email) {
      return null;
    }

    if (recipient.emailNotificationsEnabled !== 1) {
      return null;
    }

    const lastNotification = await db.query.messageNotificationLogs.findFirst({
      where: eq(messageNotificationLogs.userId, recipientId),
      columns: { createdAt: true },
      orderBy: (log, { desc }) => [desc(log.createdAt)],
    });

    if (lastNotification?.createdAt) {
      const elapsedMs = Date.now() - lastNotification.createdAt.getTime();
      if (elapsedMs < EMAIL_RATE_LIMIT_MINUTES * 60 * 1000) {
        return null;
      }
    }

    return {
      email: recipient.email,
      username: recipient.username,
    };
  } catch (error) {
    console.error("Erro ao validar destinatario do email:", error);
    return null;
  }
}

/**
 * Envia email de notificação e registra log para rate limit.
 */
async function sendNotificationEmail(params: {
  recipientId: string;
  conversationId: string;
  senderName: string;
  courseTitle: string;
  messageBody: string;
}) {
  try {
    const recipient = await getNotificationRecipient(params.recipientId);
    if (!recipient) {
      return;
    }

    const result = await sendMessageNotificationEmail({
      toEmail: recipient.email,
      toName: recipient.username,
      senderName: params.senderName,
      courseTitle: params.courseTitle,
      messageBody: params.messageBody,
    });

    if (!result.success) {
      return;
    }

    await db.insert(messageNotificationLogs).values({
      userId: params.recipientId,
      conversationId: params.conversationId,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("Erro ao enviar email de notificacao:", error);
  }
}

async function getUnreadCount(
  conversationId: string,
  userId: string
): Promise<number> {
  const conversationMessages = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    columns: { id: true, senderId: true },
  });

  const unreadMessageIds = conversationMessages
    .filter((message) => message.senderId !== userId)
    .map((message) => message.id);

  if (unreadMessageIds.length === 0) {
    return 0;
  }

  const reads = await db.query.messageReads.findMany({
    where: and(
      eq(messageReads.userId, userId),
      inArray(messageReads.messageId, unreadMessageIds)
    ),
    columns: { messageId: true },
  });

  const readIds = new Set(reads.map((read) => read.messageId));
  return unreadMessageIds.filter((id) => !readIds.has(id)).length;
}

/**
 * Registra rotas de mensagens (inbox e conversa).
 */
export async function messagesRoutes(fastify: FastifyInstance) {
  fastify.get("/messages/contacts", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const role = request.user.role;

        if (role === "creator") {
          const rows = await db
            .select({
              courseId: courses.id,
              courseTitle: courses.title,
              studentId: users.id,
              studentName: users.username,
            })
            .from(courses)
            .innerJoin(enrollments, eq(enrollments.courseId, courses.id))
            .innerJoin(users, eq(enrollments.studentId, users.id))
            .where(eq(courses.creatorId, userId))
            .orderBy(courses.title, users.username);

          const grouped: Record<
            string,
            {
              courseId: string;
              courseTitle: string;
              students: { id: string; name: string }[];
            }
          > = {};

          rows.forEach((row) => {
            if (!grouped[row.courseId]) {
              grouped[row.courseId] = {
                courseId: row.courseId,
                courseTitle: row.courseTitle,
                students: [],
              };
            }

            grouped[row.courseId].students.push({
              id: row.studentId,
              name: row.studentName,
            });
          });

          return Object.values(grouped);
        }

        const rows = await db
          .select({
            courseId: courses.id,
            courseTitle: courses.title,
            creatorId: users.id,
            creatorName: users.username,
          })
          .from(enrollments)
          .innerJoin(courses, eq(enrollments.courseId, courses.id))
          .innerJoin(users, eq(courses.creatorId, users.id))
          .where(eq(enrollments.studentId, userId))
          .orderBy(courses.title);

        return rows.map((row) => ({
          courseId: row.courseId,
          courseTitle: row.courseTitle,
          creatorId: row.creatorId,
          creatorName: row.creatorName,
        }));
      } catch (error: any) {
        console.error("Error loading message contacts:", error);
        return reply.status(500).send({
          error: "Falha ao carregar contatos",
        });
      }
    },
  });

  fastify.get("/messages/conversations", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const role = request.user.role;

        const list = await db.query.conversations.findMany({
          where:
            role === "creator"
              ? eq(conversations.creatorId, userId)
              : eq(conversations.studentId, userId),
          with: {
            course: {
              columns: { id: true, title: true },
            },
            creator: {
              columns: { id: true, username: true },
            },
            student: {
              columns: { id: true, username: true },
            },
          },
          orderBy: (conversation, { desc }) => [
            desc(conversation.lastMessageAt),
            desc(conversation.createdAt),
          ],
        });

        const formatted = await Promise.all(
          list.map(async (conversation) => {
            const isCreator = conversation.creatorId === userId;
            const participant = isCreator
              ? conversation.student
              : conversation.creator;
            const unreadCount = await getUnreadCount(conversation.id, userId);

            return {
              id: conversation.id,
              courseId: conversation.courseId,
              courseTitle: conversation.course.title,
              participantId: participant.id,
              participantName: participant.username,
              lastMessageAt: conversation.lastMessageAt,
              createdAt: conversation.createdAt,
              unreadCount,
            };
          })
        );

        return { conversations: formatted };
      } catch (error: any) {
        console.error("Error loading conversations:", error);
        return reply.status(500).send({
          error: "Falha ao carregar conversas",
        });
      }
    },
  });

  fastify.get("/messages/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const userId = request.user.id;

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, id),
          with: {
            course: {
              columns: { id: true, title: true },
            },
            creator: {
              columns: { id: true, username: true },
            },
            student: {
              columns: { id: true, username: true },
            },
          },
        });

        if (!conversation) {
          return reply.status(404).send({ error: "Conversa não encontrada" });
        }

        if (
          conversation.creatorId !== userId &&
          conversation.studentId !== userId
        ) {
          return reply
            .status(403)
            .send({ error: "Você não tem acesso a esta conversa" });
        }

        return {
          id: conversation.id,
          courseId: conversation.courseId,
          courseTitle: conversation.course.title,
          creator: conversation.creator,
          student: conversation.student,
          lastMessageAt: conversation.lastMessageAt,
        };
      } catch (error: any) {
        console.error("Error loading conversation:", error);
        return reply.status(500).send({
          error: "Falha ao carregar conversa",
        });
      }
    },
  });

  fastify.get("/messages/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const query = listMessagesQuerySchema.parse(request.query);
        const sinceDate = parseSinceDate(query.since);

        if (query.since && !sinceDate) {
          return reply.status(400).send({ error: "Filtro de data inválido" });
        }

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, id),
        });

        if (!conversation) {
          return reply.status(404).send({ error: "Conversa não encontrada" });
        }

        const userId = request.user.id;
        if (
          conversation.creatorId !== userId &&
          conversation.studentId !== userId
        ) {
          return reply
            .status(403)
            .send({ error: "Você não tem acesso a esta conversa" });
        }

        const messageList = await db.query.messages.findMany({
          where: sinceDate
            ? and(
                eq(messages.conversationId, id),
                gt(messages.createdAt, sinceDate)
              )
            : eq(messages.conversationId, id),
          orderBy: (message, { asc }) => [asc(message.createdAt)],
          limit: 100,
        });

        return { messages: messageList };
      } catch (error: any) {
        console.error("Error loading messages:", error);
        return reply.status(500).send({
          error: "Falha ao carregar mensagens",
        });
      }
    },
  });

  fastify.post("/messages/conversations/start", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const role = request.user.role;
        const data = startConversationSchema.parse(request.body);

        const course = await db.query.courses.findFirst({
          where: eq(courses.id, data.courseId),
        });

        if (!course) {
          return reply.status(404).send({ error: "Curso não encontrado" });
        }

        let creatorId = course.creatorId;
        let studentId = userId;
        let recipientId = course.creatorId;

        if (role === "creator") {
          if (course.creatorId !== userId) {
            return reply
              .status(403)
              .send({ error: "Curso inválido para este criador" });
          }

          if (!data.recipientId) {
            return reply
              .status(400)
              .send({ error: "Selecione um aluno para iniciar a conversa" });
          }

          const enrollment = await db.query.enrollments.findFirst({
            where: and(
              eq(enrollments.courseId, course.id),
              eq(enrollments.studentId, data.recipientId)
            ),
          });

          if (!enrollment) {
            return reply
              .status(403)
              .send({ error: "Aluno não matriculado neste curso" });
          }

          creatorId = userId;
          studentId = data.recipientId;
          recipientId = data.recipientId;
        } else {
          const enrollment = await db.query.enrollments.findFirst({
            where: and(
              eq(enrollments.courseId, course.id),
              eq(enrollments.studentId, userId)
            ),
          });

          if (!enrollment) {
            return reply
              .status(403)
              .send({ error: "Você precisa estar matriculado no curso" });
          }
        }

        const chatAccess = await ensureCreatorChatAccess(creatorId);
        if (!chatAccess.allowed) {
          return reply.status(403).send({ error: chatAccess.reason });
        }

        const message = data.message?.trim();

        let conversation = await db.query.conversations.findFirst({
          where: and(
            eq(conversations.courseId, course.id),
            eq(conversations.creatorId, creatorId),
            eq(conversations.studentId, studentId)
          ),
        });

        if (!conversation) {
          const [created] = await db
            .insert(conversations)
            .values({
              courseId: course.id,
              creatorId,
              studentId,
              lastMessageAt: message ? new Date() : null,
              updatedAt: new Date(),
            })
            .returning();

          conversation = created;
        }

        if (!message) {
          return {
            conversationId: conversation.id,
            messageId: null,
          };
        }

        const [createdMessage] = await db
          .insert(messages)
          .values({
            conversationId: conversation.id,
            senderId: userId,
            body: message,
            createdAt: new Date(),
          })
          .returning();

        await db
          .update(conversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));

        await db.insert(messageReads).values({
          messageId: createdMessage.id,
          userId,
          readAt: new Date(),
        });

        const sender = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { username: true },
        });

        if (sender?.username) {
          await sendNotificationEmail({
            recipientId,
            conversationId: conversation.id,
            senderName: sender.username,
            courseTitle: course.title,
            messageBody: message,
          });
        }

        return {
          conversationId: conversation.id,
          messageId: createdMessage.id,
        };
      } catch (error: any) {
        console.error("Error starting conversation:", error);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: "Dados inválidos",
            details: error.issues,
          });
        }
        return reply.status(500).send({
          error: "Falha ao iniciar conversa",
        });
      }
    },
  });

  fastify.post("/messages/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const userId = request.user.id;
        const data = messageSchema.parse(request.body);

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, id),
          with: {
            course: {
              columns: { title: true },
            },
          },
        });

        if (!conversation) {
          return reply.status(404).send({ error: "Conversa não encontrada" });
        }

        if (
          conversation.creatorId !== userId &&
          conversation.studentId !== userId
        ) {
          return reply
            .status(403)
            .send({ error: "Você não tem acesso a esta conversa" });
        }

        const chatAccess = await ensureCreatorChatAccess(
          conversation.creatorId
        );
        if (!chatAccess.allowed) {
          return reply.status(403).send({ error: chatAccess.reason });
        }

        const [createdMessage] = await db
          .insert(messages)
          .values({
            conversationId: conversation.id,
            senderId: userId,
            body: data.message,
            createdAt: new Date(),
          })
          .returning();

        await db
          .update(conversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));

        await db.insert(messageReads).values({
          messageId: createdMessage.id,
          userId,
          readAt: new Date(),
        });

        const sender = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { username: true },
        });

        const recipientId =
          conversation.creatorId === userId
            ? conversation.studentId
            : conversation.creatorId;

        if (sender?.username) {
          await sendNotificationEmail({
            recipientId,
            conversationId: conversation.id,
            senderName: sender.username,
            courseTitle: conversation.course.title,
            messageBody: data.message,
          });
        }

        return {
          messageId: createdMessage.id,
          createdAt: createdMessage.createdAt,
        };
      } catch (error: any) {
        console.error("Error sending message:", error);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: error.issues });
        }
        return reply.status(500).send({
          error: "Falha ao enviar mensagem",
        });
      }
    },
  });

  fastify.post("/messages/conversations/:id/read", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const userId = request.user.id;

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, id),
        });

        if (!conversation) {
          return reply.status(404).send({ error: "Conversa não encontrada" });
        }

        if (
          conversation.creatorId !== userId &&
          conversation.studentId !== userId
        ) {
          return reply
            .status(403)
            .send({ error: "Você não tem acesso a esta conversa" });
        }

        const conversationMessages = await db.query.messages.findMany({
          where: eq(messages.conversationId, id),
          columns: { id: true, senderId: true },
        });

        const unreadIds = conversationMessages
          .filter((message) => message.senderId !== userId)
          .map((message) => message.id);

        if (unreadIds.length === 0) {
          return { success: true, readCount: 0 };
        }

        const existingReads = await db.query.messageReads.findMany({
          where: and(
            eq(messageReads.userId, userId),
            inArray(messageReads.messageId, unreadIds)
          ),
          columns: { messageId: true },
        });

        const existingIds = new Set(
          existingReads.map((read) => read.messageId)
        );
        const newReads = unreadIds.filter((id) => !existingIds.has(id));

        if (newReads.length === 0) {
          return { success: true, readCount: 0 };
        }

        await db.insert(messageReads).values(
          newReads.map((messageId) => ({
            messageId,
            userId,
            readAt: new Date(),
          }))
        );

        return { success: true, readCount: newReads.length };
      } catch (error: any) {
        console.error("Error marking messages as read:", error);
        return reply.status(500).send({
          error: "Falha ao atualizar leitura",
        });
      }
    },
  });
}
