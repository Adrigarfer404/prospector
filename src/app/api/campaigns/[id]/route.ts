import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { runCampaign } from "@/lib/campaigns";
import { parseJson } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const PatchSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  channel: z.enum(["email", "linkedin", "mixed"]).optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  autoSend: z.boolean().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { order: "asc" } },
        recipients: {
          include: {
            lead: { select: { id: true, fullName: true, email: true, score: true, status: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!campaign) return fail("Campaña no encontrada", 404);
    const attempts = await prisma.conversation.findMany({
      where: { campaignId: id, channel: "email", direction: "outbound", status: "sending" },
      orderBy: { createdAt: "desc" },
      select: { leadId: true, subject: true, body: true, externalId: true, createdAt: true },
    });

    return ok({
      campaign: {
        ...campaign,
        steps: campaign.steps.map((s) => ({
          ...s,
          settings: parseJson<Record<string, unknown>>(s.settings, {}),
        })),
        recipients: campaign.recipients.map((r) => ({
          id: r.id,
          leadId: r.leadId,
          status: r.status,
          currentStep: r.currentStep,
          sentCount: r.sentCount,
          lastSentAt: r.lastSentAt,
          repliedAt: r.repliedAt,
          error: r.error,
          updatedAt: r.updatedAt,
          deliveryAttempt: attempts.find((a) => a.leadId === r.leadId) ?? null,
          lead: r.lead,
        })),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Datos inválidos");
    const campaign = await prisma.campaign.update({ where: { id }, data: parsed.data });
    return ok({ campaign });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await prisma.campaign.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
}

/** Ejecuta los pasos vencidos de la campaña. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const workspace = await getWorkspace();
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      limit?: number;
      force?: boolean;
    };

    if (body.action === "launch") {
      const campaign = await prisma.campaign.update({
        where: { id },
        data: { status: "active" },
      });
      return ok({ campaign, launched: true });
    }

    const summary = await runCampaign(workspace.id, id, {
      limit: body.limit ?? 25,
      force: body.force,
    });
    return ok(summary);
  } catch (err) {
    return serverError(err);
  }
}
