import { prisma } from "@/lib/db";
import { fail, leadInclude, ok, serverError, toLeadDTO } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { parseJson } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const list = await prisma.list.findUnique({
      where: { id },
      include: {
        items: {
          include: { lead: { include: leadInclude } },
          orderBy: { score: "desc" },
        },
      },
    });
    if (!list) return fail("Lista no encontrada", 404);

    const items = list.items.map((item) => ({
      ...toLeadDTO(item.lead),
      listStatus: item.status,
    }));

    return ok({
      list: {
        id: list.id,
        name: list.name,
        description: list.description,
        icp: list.icp,
        createdAt: list.createdAt.toISOString(),
      },
      leads: items,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: string; description?: string | null; icp?: string | null };
    const list = await prisma.list.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.icp !== undefined ? { icp: body.icp } : {}),
      },
    });
    return ok({ list });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await prisma.list.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
}
