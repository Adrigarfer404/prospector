import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { sendEmail } from "@/lib/emailer";

export const runtime = "nodejs";

const BodySchema = z.object({
  leadId: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  /** Email destino; si falta, se usa el del lead. */
  to: z.string().email().optional(),
  identityId: z.string().optional(),
});

/**
 * Envío manual de un email a un lead concreto (por ejemplo, después de
 * escribir a mano un mensaje en el detalle del lead). Si no hay SMTP
 * configurado, el mensaje se registra como pendiente de envío.
 */
export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("Datos inválidos");
    const data = parsed.data;

    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId: workspace.id },
    });
    if (!lead) return fail("Lead no encontrado", 404);

    const to = data.to ?? lead.email;
    if (!to) return fail("El lead no tiene email: añade uno o indica un destinatario");

    const identity = data.identityId
      ? await prisma.identity.findFirst({
          where: { id: data.identityId, workspaceId: workspace.id },
        })
      : await prisma.identity.findFirst({
          where: { workspaceId: workspace.id, isDefault: true },
        }) ??
        (await prisma.identity.findFirst({ where: { workspaceId: workspace.id } }));

    if (!identity) return fail("No hay ninguna identidad de envío configurada");

    const smtp = identity.smtpHost
      ? {
          host: identity.smtpHost,
          port: identity.smtpPort ?? 587,
          user: identity.smtpUser,
          pass: identity.smtpPass,
          secure: identity.smtpSecure,
        }
      : null;

    const result = await sendEmail({
      from: { name: identity.name, email: identity.email },
      to: { name: lead.fullName, email: to },
      subject: data.subject,
      body: data.body,
      replyTo: identity.email,
      smtp,
    });

    await prisma.conversation.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        channel: "email",
        direction: "outbound",
        subject: data.subject,
        body: data.body,
        status: result.sent ? "closed" : "open",
        sentAt: result.sent ? new Date() : null,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "contacted", lastContactedAt: new Date() },
    });

    return ok({
      sent: result.sent,
      queued: result.queued,
      error: result.error ?? null,
      to,
    });
  } catch (err) {
    return serverError(err);
  }
}
