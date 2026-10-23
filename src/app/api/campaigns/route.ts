import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { parseJson } from "@/lib/types";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  channel: z.enum(["email", "linkedin", "mixed"]).optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  autoSend: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        type: z.string(),
        name: z.string().optional().nullable(),
        delayDays: z.number().int().min(0).max(90).optional(),
        delayHours: z.number().int().min(0).max(23).optional(),
        subject: z.string().optional().nullable(),
        body: z.string().optional().nullable(),
        aiEnabled: z.boolean().optional(),
        stopOnReply: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export async function GET() {
  try {
    const workspace = await getWorkspace();
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: {
        steps: { orderBy: { order: "asc" } },
        _count: { select: { recipients: true } },
        recipients: { select: { status: true } },
      },
    });

    return ok({
      campaigns: campaigns.map((c) => {
        const counts = c.recipients.reduce<Record<string, number>>((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {});
        return {
          id: c.id,
          name: c.name,
          description: c.description,
          objective: c.objective,
          status: c.status,
          channel: c.channel,
          dailyLimit: c.dailyLimit,
          autoSend: c.autoSend,
          createdAt: c.createdAt.toISOString(),
          steps: c.steps.map((s) => ({
            id: s.id,
            order: s.order,
            type: s.type,
            name: s.name,
            delayDays: s.delayDays,
            delayHours: s.delayHours,
            subject: s.subject,
            body: s.body,
            aiEnabled: s.aiEnabled,
            stopOnReply: s.stopOnReply,
            settings: parseJson<Record<string, unknown>>(s.settings, {}),
          })),
          recipients: c._count.recipients,
          stats: counts,
        };
      }),
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = CreateSchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });
    const data = parsed.data;

    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: workspace.id,
        name: data.name,
        description: data.description ?? null,
        objective: data.objective ?? null,
        channel: data.channel ?? "email",
        dailyLimit: data.dailyLimit ?? 50,
        autoSend: data.autoSend ?? false,
        steps: {
          create: (data.steps ?? []).map((step, index) => ({
            order: index,
            type: step.type,
            name: step.name ?? null,
            delayDays: step.delayDays ?? 0,
            delayHours: step.delayHours ?? 0,
            subject: step.subject ?? null,
            body: step.body ?? null,
            aiEnabled: step.aiEnabled ?? false,
            stopOnReply: step.stopOnReply ?? true,
            settings: JSON.stringify(step.settings ?? {}),
          })),
        },
      },
    });

    return ok({ campaign });
  } catch (err) {
    return serverError(err);
  }
}
