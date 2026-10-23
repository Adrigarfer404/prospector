import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: Request) {
  try {
    const workspace = await getWorkspace();
    const params = new URL(request.url).searchParams;
    const listId = params.get("listId") ?? undefined;

    const leads = await prisma.lead.findMany({
      where: {
        workspaceId: workspace.id,
        ...(listId ? { listItems: { some: { listId } } } : {}),
      },
      include: {
        company: { select: { name: true, website: true, city: true, region: true, industry: true } },
        listItems: { include: { list: { select: { name: true } } } },
      },
      orderBy: { score: "desc" },
    });

    const header = [
      "nombre",
      "email",
      "telefono",
      "cargo",
      "empresa",
      "web_empresa",
      "ciudad",
      "provincia",
      "sector",
      "linkedin",
      "score",
      "estado",
      "fuente",
      "listas",
    ];

    const rows = leads.map((lead) =>
      [
        lead.fullName,
        lead.email,
        lead.phoneNumber,
        lead.jobTitle,
        lead.company?.name,
        lead.company?.website,
        lead.company?.city ?? lead.city,
        lead.company?.region ?? lead.region,
        lead.company?.industry,
        lead.linkedinUrl,
        lead.score,
        lead.status,
        lead.source,
        lead.listItems.map((li) => li.list.name).join(" | "),
      ]
        .map(csvCell)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="prospectos-agendaos.csv"`,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
