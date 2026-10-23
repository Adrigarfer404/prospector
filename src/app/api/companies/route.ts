import { prisma } from "@/lib/db";
import { ok, serverError, toCompanyDTO } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const workspace = await getWorkspace();
    const params = new URL(request.url).searchParams;
    const q = params.get("q") ?? undefined;

    const companies = await prisma.company.findMany({
      where: {
        workspaceId: workspace.id,
        ...(q ? { OR: [{ name: { contains: q } }, { domain: { contains: q } }] } : {}),
      },
      orderBy: { score: "desc" },
      take: 200,
      include: { _count: { select: { leads: true } } },
    });

    return ok({ companies: companies.map(toCompanyDTO) });
  } catch (err) {
    return serverError(err);
  }
}
