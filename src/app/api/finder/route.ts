import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, serverError } from "@/lib/api";
import { discoverProspects } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  query: z.string().min(3, "Describe a quién buscas (mínimo 3 caracteres)"),
  location: z.string().optional(),
  limit: z.number().min(1).max(200).optional(),
  enrichLimit: z.number().min(0).max(50).optional(),
  /** Cuántos negocios sin web se buscan por nombre para hallar su contacto. */
  resolveLimit: z.number().min(0).max(20).optional(),
  /** false = no buscar el contacto de los negocios que aún no tienen web. */
  resolve: z.boolean().optional(),
  listId: z.string().optional().nullable(),
  listName: z.string().optional().nullable(),
});

/**
 * AI Finder: descubre prospectos reales a partir de una descripción en
 * lenguaje natural, los enriquece, los puntúa contra el ICP y los deja en una lista.
 */
export async function POST(request: Request) {
  try {
    const body = BodySchema.safeParse(await request.json());
    if (!body.success) {
      return fail(body.error.issues[0]?.message ?? "Parámetros inválidos");
    }
    const input = body.data;

    const workspace = await (await import("@/lib/workspace")).getWorkspace();

    let listId = input.listId ?? null;
    if (!listId && input.listName) {
      // Reutiliza la lista si ya existe con ese nombre: si no, cada búsqueda
      // deja una lista duplicada en la base.
      const existing = await prisma.list.findFirst({
        where: { workspaceId: workspace.id, name: input.listName },
      });
      const list =
        existing ??
        (await prisma.list.create({
          data: {
            workspaceId: workspace.id,
            name: input.listName,
            description: `Generado automáticamente desde: ${input.query}`,
            icp: input.query,
          },
        }));
      listId = list.id;
    }

    const outcome = await discoverProspects({
      workspaceId: workspace.id,
      query: input.query,
      location: input.location,
      limit: input.limit ?? 20,
      // Por defecto se analizan todas las webs encontradas (hasta 18): cada
      // web analizada es un prospecto más con email y teléfono.
      enrichLimit: input.enrichLimit ?? Math.min(input.limit ?? 20, 18),
      resolveLimit: input.resolveLimit ?? 6,
      resolveWithoutWebsite: input.resolve ?? true,
      listId,
    });

    return ok({ ...outcome, listId });
  } catch (err) {
    return serverError(err);
  }
}
