import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const BodySchema = z.object({
  leadIds: z.array(z.string()).min(1),
  listId: z.string(),
  /** false los quita de la lista, true los añade (idempotente). */
  add: z.boolean().optional(),
});

/** Alta o baja masiva de leads en una lista (evita un PATCH por lead). */
export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });

    const { leadIds, listId, add = true } = parsed.data;

    const list = await prisma.list.findFirst({
      where: { id: listId, workspaceId: workspace.id },
    });
    if (!list) return ok({ error: "Lista no encontrada" }, { status: 404 });

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, workspaceId: workspace.id },
      select: { id: true },
    });

    if (!add) {
      await prisma.listItem.deleteMany({
        where: { listId, leadId: { in: leads.map((l) => l.id) } },
      });
      return ok({ removed: leads.length, listId });
    }

    let added = 0;
    for (const lead of leads) {
      const existing = await prisma.listItem.findUnique({
        where: { listId_leadId: { listId, leadId: lead.id } },
      });
      if (existing) continue;
      await prisma.listItem.create({ data: { listId, leadId: lead.id } });
      added += 1;
    }

    return ok({ added, total: leads.length, listId });
  } catch (err) {
    return serverError(err);
  }
}
