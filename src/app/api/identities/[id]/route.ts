import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  // Si no viene, se conserva la contraseña que ya había.
  smtpPass: z.string().nullable().optional(),
  smtpSecure: z.boolean().optional(),
  linkedinUrl: z.string().nullable().optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const workspace = await getWorkspace();
    const { id } = await params;
    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });
    const data = parsed.data;

    const existing = await prisma.identity.findFirst({
      where: { id, workspaceId: workspace.id },
    });
    if (!existing) return ok({ error: "Identidad no encontrada" }, { status: 404 });

    if (data.isDefault) {
      await prisma.identity.updateMany({
        where: { workspaceId: workspace.id },
        data: { isDefault: false },
      });
    }

    const identity = await prisma.identity.update({
      where: { id: existing.id },
      data: {
        name: data.name ?? existing.name,
        email: data.email ?? existing.email,
        smtpHost: data.smtpHost === undefined ? existing.smtpHost : data.smtpHost,
        smtpPort: data.smtpPort === undefined ? existing.smtpPort : data.smtpPort,
        smtpUser: data.smtpUser === undefined ? existing.smtpUser : data.smtpUser,
        // Sin contraseña en el payload se mantiene la que ya había.
        smtpPass: data.smtpPass === undefined ? existing.smtpPass : data.smtpPass,
        smtpSecure:
          data.smtpSecure === undefined
            ? existing.smtpSecure
            : data.smtpSecure,
        linkedinUrl: data.linkedinUrl === undefined ? existing.linkedinUrl : data.linkedinUrl,
        dailyLimit: data.dailyLimit ?? existing.dailyLimit,
        isDefault: data.isDefault ?? existing.isDefault,
      },
    });

    return ok({ identity: { id: identity.id, name: identity.name, email: identity.email } });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const workspace = await getWorkspace();
    const { id } = await params;
    const existing = await prisma.identity.findFirst({
      where: { id, workspaceId: workspace.id },
    });
    if (!existing) return ok({ error: "Identidad no encontrada" }, { status: 404 });
    await prisma.identity.delete({ where: { id: existing.id } });
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
}
