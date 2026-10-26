/**
 * Normalización de texto compartido.
 *
 * Vive fuera de `providers/enrichment` para que tanto el pipeline como los
 * providers puedan usarla sin dependencias circulares.
 */

/** Quita acentos y pasa a minúsculas: "Clínica" -> "clinica". */
export function stripAccents(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Clave de nombre para deduplicar empresas y personas.
 *
 * "CLINICA FISIO MADRID, S.L." y "Clínica Fisio Madrid SL" colapsan en la
 * misma clave, que es lo que evita que un barrido diario cree duplicados
 * cada vez que la grafía cambia un poco.
 */
export function normalizeNameKey(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(sl|slu|sa|sau|sc|cb|s l|s a|sociedad limitada|sociedad anonima)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
