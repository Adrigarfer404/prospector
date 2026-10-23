import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

/**
 * Bandeja de tareas manuales: lo que la app NO puede hacer sola (conectar en
 * LinkedIn, llamar) queda aquí como una acción pendiente para el usuario.
 */
export async function GET(request: Request) {
  try {
    const workspace = await getWorkspace();
    const params = new URL(request.url).searchParams;
    const channel = params.get("channel") ?? undefined;
    const status = params.get("status") ?? "open";

    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId: workspace.id,
        direction: "outbound",
        channel: channel ? { in: channel.split(",") } : { in: ["linkedin", "call"] },
        ...(status !== "all" ? { status } : {}),
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
            phoneNumber: true,
            linkedinUrl: true,
            company: { select: { name: true, website: true } },
          },
        },
      },
    });

    return ok({
      tasks: conversations.map((c) => ({
        id: c.id,
        channel: c.channel,
        subject: c.subject,
        body: c.body,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        lead: c.lead,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}
