import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getPlaybook, getWorkspace } from "@/lib/workspace";
import { parseJson, type IcpCriterion } from "@/lib/types";

export const runtime = "nodejs";

const PutSchema = z.object({
  ourCompany: z.string().optional(),
  ourOffer: z.string().nullable().optional(),
  ourValue: z.string().nullable().optional(),
  icpSummary: z.string().nullable().optional(),
  icpCriteria: z.array(z.record(z.string(), z.unknown())).optional(),
  disqualified: z.array(z.string()).optional(),
  proofPoints: z.array(z.string()).optional(),
  tone: z.string().optional(),
  language: z.string().optional(),
  cta: z.string().nullable().optional(),
  signature: z.string().nullable().optional(),
});

export async function GET() {
  try {
    const workspace = await getWorkspace();
    const playbook = await getPlaybook(workspace.id);
    return ok({
      playbook: {
        ...playbook,
        icpCriteria: parseJson<IcpCriterion[]>(playbook.icpCriteria, []),
        disqualified: parseJson<string[]>(playbook.disqualified, []),
        proofPoints: parseJson<string[]>(playbook.proofPoints, []),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = PutSchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });
    const data = parsed.data;

    const payload = {
      ourCompany: data.ourCompany,
      ourOffer: data.ourOffer,
      ourValue: data.ourValue,
      icpSummary: data.icpSummary,
      tone: data.tone,
      language: data.language,
      cta: data.cta,
      signature: data.signature,
      ...(data.icpCriteria ? { icpCriteria: JSON.stringify(data.icpCriteria) } : {}),
      ...(data.disqualified ? { disqualified: JSON.stringify(data.disqualified) } : {}),
      ...(data.proofPoints ? { proofPoints: JSON.stringify(data.proofPoints) } : {}),
    };

    const playbook = await prisma.playbook.upsert({
      where: { workspaceId: workspace.id },
      update: payload,
      create: { workspaceId: workspace.id, ...payload },
    });

    return ok({ playbook });
  } catch (err) {
    return serverError(err);
  }
}
