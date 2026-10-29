import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await getWorkspace();
    const { id } = await params;
    const parsed = z.object({ outcome: z.enum(["sent", "not_sent"]) }).safeParse(await request.json());
    if (!parsed.success) return fail("Selecciona el resultado comprobado");
    const recovered = await prisma.$transaction(async tx => {
      const existing = await tx.conversation.findFirst({ where: { id, workspaceId: workspace.id, campaignId: null, channel: "email", direction: "outbound", status: "sending", createdAt: { lte: new Date(Date.now() - 15 * 60_000) } } });
      if (!existing) return false;
      const now = new Date();
      const updated = await tx.conversation.updateMany({ where: { id, status: "sending", campaignId: null }, data: { status: parsed.data.outcome === "sent" ? "closed" : "cancelled", sentAt: parsed.data.outcome === "sent" ? now : null } });
      if (!updated.count) return false;
      if (parsed.data.outcome === "sent" && existing.leadId) await tx.lead.updateMany({ where: { id: existing.leadId, status: { notIn: ["unsubscribed", "do_not_contact", "bounced", "replied"] } }, data: { status: "contacted", lastContactedAt: now } });
      await tx.activity.create({ data: { workspaceId: workspace.id, type: "inbox.recovery", subject: existing.subject, payload: JSON.stringify({ conversationId: id, outcome: parsed.data.outcome }) } });
      return true;
    });
    return recovered ? ok({ recovered: true }) : fail("El envío sigue activo o ya fue revisado", 409);
  } catch (err) { return serverError(err); }
}
