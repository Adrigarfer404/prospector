import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const AddSchema = z.object({
  leadIds: z.array(z.string()).optional(),
  listId: z.string().optional(),
  minScore: z.number().min(0).max(100).optional(),
  status: z.string().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      include: {
        lead: {
          select: {
            id: true,
            fullName: true,
            email: true,
            jobTitle: true,
            score: true,
            status: true,
            company: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      recipients: recipients.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        status: r.status,
        currentStep: r.currentStep,
        sentCount: r.sentCount,
        lastSentAt: r.lastSentAt,
        repliedAt: r.repliedAt,
        error: r.error,
        lead: r.lead,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const workspace = await getWorkspace();
    const parsed = AddSchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });
    const data = parsed.data;

    let leadIds = data.leadIds ?? [];
    if (!leadIds.length && data.listId) {
      const items = await prisma.listItem.findMany({
        where: {
          listId: data.listId,
          ...(typeof data.minScore === "number" ? { score: { gte: data.minScore } } : {}),
        },
        select: { leadId: true },
      });
      leadIds = items.map((i) => i.leadId);
    }
    if (!leadIds.length && data.status) {
      const leads = await prisma.lead.findMany({
        where: { workspaceId: workspace.id, status: data.status },
        select: { id: true },
      });
      leadIds = leads.map((l) => l.id);
    }
    if (!leadIds.length) {
      return ok({ added: 0, message: "No hay leads que añadir" });
    }

    let added = 0;
    for (const leadId of leadIds) {
      const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: workspace.id } });
      if (!lead) continue;
      const res = await prisma.campaignRecipient.upsert({
        where: { campaignId_leadId: { campaignId: id, leadId } },
        update: {},
        create: { campaignId: id, leadId },
      });
      if (res) added += 1;
    }

    return ok({ added, total: leadIds.length });
  } catch (err) {
    return serverError(err);
  }
}
