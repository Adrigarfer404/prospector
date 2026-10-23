import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const StepSchema = z.object({
  type: z.string().min(1),
  name: z.string().optional().nullable(),
  delayDays: z.number().int().min(0).max(90).optional(),
  delayHours: z.number().int().min(0).max(23).optional(),
  subject: z.string().optional().nullable(),
  body: z.string().optional().nullable(),
  aiEnabled: z.boolean().optional(),
  stopOnReply: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = StepSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Paso inválido");

    const last = await prisma.campaignStep.findFirst({
      where: { campaignId: id },
      orderBy: { order: "desc" },
    });

    const step = await prisma.campaignStep.create({
      data: {
        campaignId: id,
        order: (last?.order ?? -1) + 1,
        type: parsed.data.type,
        name: parsed.data.name ?? null,
        delayDays: parsed.data.delayDays ?? 0,
        delayHours: parsed.data.delayHours ?? 0,
        subject: parsed.data.subject ?? null,
        body: parsed.data.body ?? null,
        aiEnabled: parsed.data.aiEnabled ?? false,
        stopOnReply: parsed.data.stopOnReply ?? true,
        settings: JSON.stringify(parsed.data.settings ?? {}),
      },
    });

    return ok({ step });
  } catch (err) {
    return serverError(err);
  }
}
