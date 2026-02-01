import sgMail from "@sendgrid/mail";

const DEFAULT_FROM_NAME = "AI Am A Mentor";
let sendGridConfigured = false;

function getSendGridClient(): boolean {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    return false;
  }

  if (!sendGridConfigured) {
    sgMail.setApiKey(apiKey);
    sendGridConfigured = true;
  }

  return true;
}

function buildMessagePreview(message: string, maxLength: number = 160): string {
  if (message.length <= maxLength) {
    return message;
  }

  return `${message.slice(0, maxLength - 3)}...`;
}

export interface MessageNotificationEmailParams {
  toEmail: string;
  toName?: string | null;
  senderName: string;
  courseTitle: string;
  messageBody: string;
}

/**
 * Envia email de notificação para nova mensagem.
 */
export async function sendMessageNotificationEmail(
  params: MessageNotificationEmailParams
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const fromName = process.env.SENDGRID_FROM_NAME || DEFAULT_FROM_NAME;
  const frontendUrl = process.env.FRONTEND_URL;

  if (!getSendGridClient() || !fromEmail) {
    return { success: false, skipped: true };
  }

  const messagePreview = buildMessagePreview(params.messageBody);
  const subject = `Nova mensagem de ${params.senderName}`;
  const messagesUrl = frontendUrl ? `${frontendUrl}/messages` : null;

  const textBody = [
    `Olá${params.toName ? `, ${params.toName}` : ""}!`,
    "",
    `Você recebeu uma nova mensagem de ${params.senderName}.`,
    `Curso: ${params.courseTitle}.`,
    "",
    `Mensagem: ${messagePreview}`,
    messagesUrl ? "" : null,
    messagesUrl ? `Acesse: ${messagesUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const htmlBody = `
    <p>Olá${params.toName ? `, ${params.toName}` : ""}!</p>
    <p>Você recebeu uma nova mensagem de <strong>${params.senderName}</strong>.</p>
    <p><strong>Curso:</strong> ${params.courseTitle}</p>
    <p><strong>Mensagem:</strong> ${messagePreview}</p>
    ${messagesUrl ? `<p><a href="${messagesUrl}">Abrir mensagens</a></p>` : ""}
  `;

  try {
    await sgMail.send({
      to: params.toEmail,
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject,
      text: textBody,
      html: htmlBody,
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error sending message notification email:", error);
    return { success: false, error: error?.message || "Falha ao enviar email" };
  }
}
