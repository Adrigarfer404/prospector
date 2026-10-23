import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";

export const runtime = "nodejs";

const PatchSchema = z.object({
  order: z.number().int().min(0).optional(),
  type: z.string().optional(),
  name: z.string().nullable().optional(),
  delayDays: z.number().int().min(0).max(90).optional(),
  delayHours: z.number().int().min(0).max(23).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  aiEnabled: z.boolean().optional(),
  stopOnReply: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { stepId } = await context.params;
    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Datos inválidos");
    const { settings, ...rest } = parsed.data;
    const step = await prisma.campaignStep.update({
      where: { id: stepId },
      data: {
        ...rest,
        ...(settings !== undefined ? { settings: JSON.stringify(settings) } : {}),
      },
    });
    return ok({ step });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { stepId } = await context.params;
    await prisma.campaignStep.delete({ where: { id: stepId } });
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
}
