import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

const Recovery = z.object({ outcome: z.enum(["not_sent", "sent"]) });
const STALE_MS = 15 * 60 * 1000;

/** La persona comprueba fuera de la app si el envío llegó a producirse. */
export async function POST(request: Request, context: { params: Promise<{ id: string; recipientId: string }> }) {
  try {
    const workspace = await getWorkspace();
    const { id, recipientId } = await context.params;
    const parsed = Recovery.safeParse(await request.json());
    if (!parsed.success) return fail("Selecciona el resultado comprobado");
    const result = await prisma.$transaction(async tx => {
      const recipient = await tx.campaignRecipient.findFirst({
        where: { id: recipientId, campaignId: id, campaign: { workspaceId: workspace.id } },
        include: { campaign: { include: { steps: { orderBy: { order: "asc" } } } }, lead: true },
      });
      if (!recipient) return { error: "Destinatario no encontrado", status: 404 };
      if (recipient.campaign.status !== "paused") return { error: "Pausa la campaña antes de resolver el envío", status: 409 };
      if (recipient.status !== "sending" || Date.now() - recipient.updatedAt.getTime() < STALE_MS) return { error: "El envío sigue activo o su estado ya ha cambiado", status: 409 };
      const step = recipient.campaign.steps[recipient.currentStep];
      if (!step || step.type !== "email") return { error: "No hay un paso de email pendiente de revisión", status: 409 };
      const now = new Date();
      const updated = await tx.campaignRecipient.updateMany({
        where: { id: recipient.id, status: "sending", updatedAt: recipient.updatedAt },
        data: parsed.data.outcome === "sent"
          ? { status: "pending", currentStep: { increment: 1 }, sentCount: { increment: 1 }, lastSentAt: now, error: null }
          : { status: "pending", error: null },
      });
      if (!updated.count) return { error: "El estado ha cambiado; actualiza la página", status: 409 };
      if (parsed.data.outcome === "sent") {
        const recorded = await tx.conversation.findFirst({ where: { workspaceId: workspace.id, leadId: recipient.leadId, campaignId: id, channel: "email", direction: "outbound", sentAt: { gte: recipient.updatedAt } } });
        if (!recorded) await tx.conversation.create({ data: { workspaceId: workspace.id, leadId: recipient.leadId, campaignId: id, channel: "email", direction: "outbound", subject: "Envío confirmado manualmente", body: "El usuario confirmó que este envío interrumpido se realizó. El contenido original no está disponible.", status: "closed", sentAt: now } });
        await tx.lead.updateMany({ where: { id: recipient.leadId, status: { notIn: ["unsubscribed", "do_not_contact", "bounced", "replied"] } }, data: { status: "contacted", lastContactedAt: now } });
      }
      await tx.activity.create({ data: { workspaceId: workspace.id, type: "campaign.recovery", subject: recipient.lead.fullName ?? recipient.lead.email ?? recipient.leadId, payload: JSON.stringify({ campaignId: id, recipientId, outcome: parsed.data.outcome }) } });
      return { error: null, status: 200 };
    });
    return result.error ? fail(result.error, result.status) : ok({ recovered: true });
  } catch (err) { return serverError(err); }
}
