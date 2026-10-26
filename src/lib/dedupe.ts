import { normalizeNameKey } from "./text";

/**
 * Claves idempotentes y merge de enriquecimiento.
 *
 * El barrido diario vuelve a ver los mismos negocios cada jornada. Sin una
 * clave estable, cada pasada crea filas nuevas: el índice único
 * `[workspaceId, domain, name]` no protege cuando `domain` es NULL, y en
 * SQLite `NULL != NULL` dentro de un índice único.
 */

/** Campos mínimos de un negocio para derivar su clave idempotente. */
export type DedupeInput = {
  source?: string | null;
  sourceRef?: string | null;
  domain?: string | null;
  website?: string | null;
  name?: string | null;
};

/**
 * Clave idempotente por negocio, por orden de fiabilidad:
 * 1. `sourceRef` de la fuente (placeId de Maps, identificador del BORME).
 * 2. Dominio: una web es lo más estable que hay.
 * 3. Nombre normalizado: último recurso.
 */
export function companyDedupeKey(input: DedupeInput): string | null {
  const source = (input.source ?? "").trim().toLowerCase();
  const sourceRef = (input.sourceRef ?? "").trim();

  if (source && sourceRef) return `${source}:${sourceRef}`;

  const domain = (input.domain ?? "").trim().toLowerCase();
  if (domain) return `domain:${domain}`;

  const website = (input.website ?? "").trim().toLowerCase();
  if (website) return `website:${website}`;

  const nameKey = normalizeNameKey(input.name);
  if (nameKey) return `name:${nameKey}`;

  return null;
}

/** Clave idempotente para un lead: nombre normalizado o email. */
export function leadDedupeKey(input: {
  fullName?: string | null;
  email?: string | null;
  sourceRef?: string | null;
}): string | null {
  const email = (input.email ?? "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const sourceRef = (input.sourceRef ?? "").trim();
  if (sourceRef) return `lead:${sourceRef}`;
  const nameKey = normalizeNameKey(input.fullName);
  if (nameKey) return `name:${nameKey}`;
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge de enriquecimiento en dos niveles.
 *
 * Antes se hacía `{ ...previous, ...fresh }`, que es shallow: si una pasada
 * reenvía la clave `maps`, la anterior desaparece entera y se pierden campos
 * como `placeId` o el número de reseñas. Aquí los objetos anidados se fusionan
 * campo a campo y los `null` no borran datos previos.
 */
export function mergeEnrichment(
  previous: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...previous };

  for (const [key, value] of Object.entries(fresh)) {
    if (value === null || value === undefined) continue;

    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = mergeEnrichment(current, value);
      continue;
    }
    if (Array.isArray(current) && Array.isArray(value)) {
      // Solo unimos arrays de primitivos (p.ej. `signals`); los de objetos se
      // reemplazan para no duplicar entradas.
      const primitive = value.every((item) => typeof item !== "object");
      merged[key] = primitive ? [...new Set([...current, ...value])] : value;
      continue;
    }
    merged[key] = value;
  }

  return merged;
}
