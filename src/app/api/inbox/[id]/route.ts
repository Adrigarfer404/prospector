import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const PatchSchema = z.object({
  read: z.boolean().optional(),
  status: z.enum(["open", "replied", "closed", "booked"]).optional(),
  aiSummary: z.string().nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Datos inválidos");
    const workspace = await getWorkspace();
    const conversation = await prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({ where: { id, workspaceId: workspace.id } });
      if (!existing) return null;
      if (existing.status === "sending" && parsed.data.status !== undefined) return "sending" as const;
      const updated = await tx.conversation.update({ where: { id }, data: {
        ...parsed.data,
        ...(parsed.data.status === "closed" && existing.status !== "closed" && existing.direction === "outbound" ? { sentAt: new Date() } : {}),
      } });
      if (parsed.data.status === "closed" && existing.status !== "closed" && existing.direction === "outbound" && existing.campaignId && existing.leadId) {
        const now = new Date();
        await tx.campaignRecipient.updateMany({ where: { campaignId: existing.campaignId, leadId: existing.leadId, status: "manual" }, data: { status: "pending", currentStep: { increment: 1 }, sentCount: { increment: 1 }, lastSentAt: now, error: null } });
        await tx.lead.updateMany({ where: { id: existing.leadId, status: { notIn: ["unsubscribed", "do_not_contact", "bounced", "replied"] } }, data: { status: "contacted", lastContactedAt: now } });
      }
      return updated;
    });
    if (!conversation) return fail("Conversación no encontrada", 404);
    if (conversation === "sending") return fail("Revisa el envío interrumpido antes de cambiar su estado", 409);
    return ok({ conversation });
  } catch (err) {
    return serverError(err);
  }
}
