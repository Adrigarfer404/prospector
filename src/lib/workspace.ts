import { prisma } from "./db";

/**
 * La app es local y de un solo usuario: hay un workspace por defecto que se
 * crea bajo demanda. Todo el código siempre resuelve el workspace primero.
 */
export const DEFAULT_WORKSPACE_NAME = "AgendaOS Outbound";

export async function getWorkspace() {
  const existing = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const created = await prisma.workspace.create({
    data: { name: DEFAULT_WORKSPACE_NAME },
  });
  await prisma.playbook.create({
    data: { workspaceId: created.id },
  });
  await prisma.identity.create({
    data: {
      workspaceId: created.id,
      name: "Remitente por defecto",
      email: "remitente@example.com",
      isDefault: true,
    },
  });
  return created;
}

export async function getPlaybook(workspaceId: string) {
  const playbook = await prisma.playbook.findUnique({ where: { workspaceId } });
  if (playbook) return playbook;
  return prisma.playbook.create({ data: { workspaceId } });
}

export async function logActivity(
  workspaceId: string,
  type: string,
  subject?: string,
  payload: Record<string, unknown> = {},
) {
  try {
    await prisma.activity.create({
      data: {
        workspaceId,
        type,
        subject: subject ?? null,
        payload: JSON.stringify(payload),
      },
    });
  } catch (err) {
    console.error("[activity] no se pudo registrar", err);
  }
}
