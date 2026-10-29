import { z } from "zod";
import { fail, ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { buildMessageContext } from "@/lib/campaigns";
import { generateEmailMessage } from "@/lib/messages";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  leadIds: z.array(z.string()).min(1),
  stepId: z.string().optional(),
});

/** Genera los mensajes (con LLM) sin enviarlos: vista previa antes de lanzar. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const workspace = await getWorkspace();
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: workspace.id },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!campaign) return ok({ error: "Campaña no encontrada" }, { status: 404 });

    const step = parsed.data.stepId
      ? campaign.steps.find((s) => s.id === parsed.data.stepId)
      : campaign.steps.find((s) => s.type === "email");

    if (!step || step.type !== "email") return fail("Selecciona un paso de email válido");

    const leads = await prisma.lead.findMany({
      where: { id: { in: parsed.data.leadIds }, workspaceId: workspace.id },
    });

    const messages = [];
    for (const lead of leads) {
      const ctx = await buildMessageContext(lead.id);
      if (!ctx) continue;
      const generated = await generateEmailMessage(ctx, {
        subjectTemplate: step?.subject,
        bodyTemplate: step?.body,
        stepName: step.name ?? undefined,
        aiEnabled: campaign.aiPersonalize && step.aiEnabled,
      });
      messages.push({
        leadId: lead.id,
        leadName: lead.fullName,
        companyName: ctx.company?.name ?? null,
        subject: generated.subject,
        body: generated.body,
        source: generated.source,
      });
    }

    return ok({ messages, step: step ? { id: step.id, type: step.type, name: step.name } : null });
  } catch (err) {
    return serverError(err);
  }
}
