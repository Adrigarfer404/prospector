import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  try {
    const workspace = await getWorkspace();

    const [
      totalLeads,
      byStatus,
      totalCompanies,
      listCount,
      campaigns,
      conversations,
      replies,
      sent,
      tasks,
      recentActivity,
    ] = await Promise.all([
      prisma.lead.count({ where: { workspaceId: workspace.id } }),
      prisma.lead.groupBy({
        by: ["status"],
        where: { workspaceId: workspace.id },
        _count: { _all: true },
      }),
      prisma.company.count({ where: { workspaceId: workspace.id } }),
      prisma.list.count({ where: { workspaceId: workspace.id } }),
      prisma.campaign.findMany({
        where: { workspaceId: workspace.id },
        select: { id: true, name: true, status: true, _count: { select: { recipients: true } } },
      }),
      prisma.conversation.count({ where: { workspaceId: workspace.id } }),
      prisma.conversation.count({
        where: { workspaceId: workspace.id, direction: "inbound" },
      }),
      prisma.conversation.count({
        where: { workspaceId: workspace.id, direction: "outbound", channel: "email" },
      }),
      prisma.conversation.count({
        where: {
          workspaceId: workspace.id,
          direction: "outbound",
          channel: { in: ["linkedin", "call"] },
          status: "open",
        },
      }),
      prisma.activity.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    const scored = await prisma.lead.aggregate({
      where: { workspaceId: workspace.id },
      _avg: { score: true },
    });

    return ok({
      totals: {
        leads: totalLeads,
        companies: totalCompanies,
        lists: listCount,
        campaigns: campaigns.length,
        conversations,
        replies,
        sent,
        pendingTasks: tasks,
        avgScore: Math.round(scored._avg.score ?? 0),
      },
      leadsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        recipients: c._count.recipients,
      })),
      activity: recentActivity.map((a) => ({
        id: a.id,
        type: a.type,
        subject: a.subject,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}
