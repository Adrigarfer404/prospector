import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, leadInclude, ok, serverError, toLeadDTO } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const PatchSchema = z.object({
  status: z.string().optional(),
  jobTitle: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  fitNotes: z.string().nullable().optional(),
  listIds: z.array(z.string()).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        ...leadInclude,
        listItems: { include: { list: { select: { id: true, name: true } } } },
        conversations: { orderBy: { createdAt: "desc" }, take: 20 },
        recipients: { include: { campaign: { select: { id: true, name: true } } } },
      },
    });
    if (!lead) return fail("Lead no encontrado", 404);
    const dto = toLeadDTO(lead);
    return ok({
      lead: {
        ...dto,
        lists: lead.listItems.map((li) => ({ id: li.list.id, name: li.list.name })),
        conversations: lead.conversations,
        campaigns: lead.recipients.map((r) => ({ id: r.campaign.id, name: r.campaign.name, status: r.status })),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Datos inválidos");

    const { listIds, ...rest } = parsed.data;
    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.status === "contacted" ? { lastContactedAt: new Date() } : {}),
      },
    });

    if (listIds) {
      await prisma.listItem.deleteMany({ where: { leadId: id, listId: { notIn: listIds } } });
      for (const listId of listIds) {
        await prisma.listItem.upsert({
          where: { listId_leadId: { listId, leadId: id } },
          update: {},
          create: { listId, leadId: id },
        });
      }
    }

    const full = await prisma.lead.findUnique({ where: { id }, include: leadInclude });
    return ok({ lead: full ? toLeadDTO(full) : toLeadDTO(lead) });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await prisma.lead.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
}
