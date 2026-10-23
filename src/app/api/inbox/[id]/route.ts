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
    const conversation = await prisma.conversation.update({
      where: { id },
      data: parsed.data,
    });
    return ok({ conversation });
  } catch (err) {
    return serverError(err);
  }
}
