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
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        _count: { select: { leads: true } },
        leads: { select: { score: true } },
      },
    });

    const scored = companies
      .map((company) => {
        const leadScores = company.leads.map((lead) => lead.score);
        const score = leadScores.length
          ? Math.round(leadScores.reduce((sum, value) => sum + value, 0) / leadScores.length)
          : 0;
        return { ...toCompanyDTO(company), score };
      })
      .sort((a, b) => b.score - a.score);

    return ok({ companies: scored });
  } catch (err) {
    return serverError(err);
  }
}
