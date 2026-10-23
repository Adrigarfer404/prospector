import { z } from "zod";
import { prisma } from "@/lib/db";
import { leadInclude, ok, serverError, toLeadDTO } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const QuerySchema = z.object({
  listId: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  hasEmail: z.enum(["true", "false"]).optional(),
  companyId: z.string().optional(),
  profile: z.string().optional(),
  sort: z.enum(["score", "created", "name"]).optional(),
  take: z.coerce.number().min(1).max(500).optional(),
  skip: z.coerce.number().min(0).optional(),
});

export async function GET(request: Request) {
  try {
    const workspace = await getWorkspace();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) return ok({ leads: [], total: 0 });
    const q = parsed.data;

    const where: Record<string, unknown> = { workspaceId: workspace.id };
    if (q.status) where.status = q.status;
    if (q.companyId) where.companyId = q.companyId;
    if (q.profile) where.profile = q.profile;
    if (typeof q.minScore === "number") where.score = { gte: q.minScore };
    if (q.hasEmail === "true") where.email = { not: null };
    if (q.hasEmail === "false") where.email = null;
    if (q.listId) where.listItems = { some: { listId: q.listId } };
    if (q.q) {
      where.OR = [
        { fullName: { contains: q.q } },
        { email: { contains: q.q } },
        { jobTitle: { contains: q.q } },
        { company: { name: { contains: q.q } } },
      ];
    }

    const orderBy =
      q.sort === "name"
        ? { fullName: "asc" as const }
        : q.sort === "created"
          ? { createdAt: "desc" as const }
          : { score: "desc" as const };

    const take = q.take ?? 100;
    const skip = q.skip ?? 0;

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: leadInclude,
        orderBy,
        take,
        skip,
      }),
      prisma.lead.count({ where }),
    ]);

    return ok({
      leads: leads.map((l) => toLeadDTO(l)),
      total,
      take,
      skip,
    });
  } catch (err) {
    return serverError(err);
  }
}
