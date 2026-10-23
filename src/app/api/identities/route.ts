import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import { verifySmtp } from "@/lib/emailer";

export const runtime = "nodejs";

const IdentitySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpPass: z.string().nullable().optional(),
  smtpSecure: z.boolean().optional(),
  linkedinUrl: z.string().nullable().optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
  test: z.boolean().optional(),
});

export async function GET() {
  try {
    const workspace = await getWorkspace();
    const identities = await prisma.identity.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      identities: identities.map((i) => ({
        id: i.id,
        name: i.name,
        email: i.email,
        smtpHost: i.smtpHost,
        smtpPort: i.smtpPort,
        smtpUser: i.smtpUser,
        hasPassword: Boolean(i.smtpPass),
        smtpSecure: i.smtpSecure,
        linkedinUrl: i.linkedinUrl,
        dailyLimit: i.dailyLimit,
        isDefault: i.isDefault,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = IdentitySchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });
    const data = parsed.data;

    if (data.test) {
      if (!data.smtpHost) return ok({ error: "Falta smtpHost" }, { status: 400 });
      const result = await verifySmtp({
        host: data.smtpHost,
        port: data.smtpPort ?? 587,
        user: data.smtpUser,
        pass: data.smtpPass,
        secure: data.smtpSecure ?? false,
      });
      return ok(result);
    }

    if (data.isDefault) {
      await prisma.identity.updateMany({
        where: { workspaceId: workspace.id },
        data: { isDefault: false },
      });
    }

    const identity = await prisma.identity.create({
      data: {
        workspaceId: workspace.id,
        name: data.name,
        email: data.email,
        smtpHost: data.smtpHost ?? null,
        smtpPort: data.smtpPort ?? null,
        smtpUser: data.smtpUser ?? null,
        smtpPass: data.smtpPass ?? null,
        smtpSecure: data.smtpSecure ?? true,
        linkedinUrl: data.linkedinUrl ?? null,
        dailyLimit: data.dailyLimit ?? 50,
        isDefault: data.isDefault ?? false,
      },
    });

    return ok({ identity: { id: identity.id, name: identity.name, email: identity.email } });
  } catch (err) {
    return serverError(err);
  }
}
