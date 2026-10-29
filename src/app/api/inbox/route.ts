import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { registerReply } from "@/lib/campaigns";

export const runtime = "nodejs";

const ReplySchema = z.object({
  leadId: z.string().min(1),
  body: z.string().min(1),
  subject: z.string().optional().nullable(),
  channel: z.enum(["email", "linkedin", "call", "note"]).optional(),
  campaignId: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const workspace = await getWorkspace();
    const params = new URL(request.url).searchParams;
    const channel = params.get("channel") ?? undefined;
    const unreadOnly = params.get("unread") === "true";

    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId: workspace.id,
        ...(channel ? { channel } : {}),
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        lead: {
          select: {
            id: true,
            fullName: true,
            email: true,
            jobTitle: true,
            score: true,
            status: true,
            company: { select: { name: true } },
          },
        },
      },
    });

    const unreadCount = await prisma.conversation.count({
      where: { workspaceId: workspace.id, read: false, direction: "inbound" },
    });

    return ok({
      conversations: conversations.map((c) => ({
        id: c.id,
        leadId: c.leadId,
        campaignId: c.campaignId,
        externalId: c.externalId,
        leadName: c.lead?.fullName ?? null,
        leadCompany: c.lead?.company?.name ?? null,
        channel: c.channel,
        direction: c.direction,
        subject: c.subject,
        body: c.body,
        status: c.status,
        read: c.read,
        createdAt: c.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = ReplySchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });

    const conversation = await registerReply({
      workspaceId: workspace.id,
      leadId: parsed.data.leadId,
      body: parsed.data.body,
      subject: parsed.data.subject ?? null,
      channel: parsed.data.channel ?? "email",
      campaignId: parsed.data.campaignId ?? null,
    });

    return ok({ conversation });
  } catch (err) {
    return serverError(err);
  }
}
