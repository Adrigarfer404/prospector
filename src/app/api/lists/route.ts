import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  icp: z.string().optional().nullable(),
});

export async function GET() {
  try {
    const workspace = await getWorkspace();
    const lists = await prisma.list.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
        items: {
          select: { lead: { select: { score: true } } },
        },
      },
    });
    return ok({
      lists: lists.map((list) => {
        const scores = list.items.map((item) => item.lead.score);
        return {
          id: list.id,
          name: list.name,
          description: list.description,
          icp: list.icp,
          count: list._count.items,
          avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
          createdAt: list.createdAt.toISOString(),
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
    if (!parsed.success) return ok({ error: "Nombre obligatorio" }, { status: 400 });
    const list = await prisma.list.create({
      data: {
        workspaceId: workspace.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        icp: parsed.data.icp ?? null,
      },
    });
    return ok({ list });
  } catch (err) {
    return serverError(err);
  }
}
