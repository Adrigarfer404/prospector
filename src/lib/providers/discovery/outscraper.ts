/**
 * Cliente de Outscraper (API de Google Maps).
 *
 * Es una integración **opt-in**: sólo se usa si hay `OUTSCRAPER_API_KEY` en el
 * entorno. Sin clave, el provider devuelve un aviso y el resto del pipeline
 * sigue funcionando exactamente igual.
 *
 * Nota sobre los datos: Outscraper NO devuelve emails. Devuelve nombre,
 * dirección, teléfono, web, categoría, rating, número de reseñas y place_id.
 * El email sale de la web de la propia clínica (ver `providers/enrichment`).
 *
 * Referencia: https://outscraper.com/google-maps-api
 */

const OUTSCRAPER_BASE = "https://api.outscraper.com";
const DEFAULT_TIMEOUT_MS = 180_000;
/** Tope de registros por petición de Outscraper. */
const MAX_LIMIT_PER_REQUEST = 100;

/** Campos necesarios para guardar y puntuar los negocios. */
const REQUESTED_FIELDS = [
  "name",
  "place_id",
  "full_address",
  "city",
  "state",
  "phone",
  "site",
  "rating",
  "reviews",
  "category",
  "subtypes",
  "latitude",
  "longitude",
  "business_status",
  "description",
];

export type OutscraperPlace = {
  title?: string | null;
  name?: string | null;
  place_id?: string | null;
  address?: string | null;
  full_address?: string | null;
  city?: string | null;
  state?: string | null;
  subtypes?: string | null;
  phone?: string | null;
  site?: string | null;
  rating?: number | null;
  reviews?: number | null;
  category?: string | null;
  types?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  business_status?: string | null;
  description?: string | null;
  [key: string]: unknown;
};

/**
 * Clave de API activa, o `null` si no hay ninguna configurada.
 *
 * Los placeholders del `.env.example` se consideran "no configurado" para que
 * no se intente llamar a la API con una clave falsa.
 */
export function outscraperApiKey(): string | null {
  const raw = process.env.OUTSCRAPER_API_KEY?.trim();
  if (!raw) return null;
  if (/^(tu[-_]|TU[-_]|CHANGE_ME|CHANGE-ME|xxx|XXX|placeholder)/i.test(raw)) return null;
  return raw;
}

/** ¿Está la integración lista para usarse? */
export function outscraperConfigured(): boolean {
  return outscraperApiKey() !== null;
}

export type OutscraperSearch = {
  /** Término de búsqueda ("fisioterapia"). */
  query: string;
  /** Ubicación ("Madrid, Spain"). */
  location?: string | null;
  /** Número de resultados (1..100). */
  limit?: number;
  /** Idioma de los resultados. */
  language?: string;
  timeoutMs?: number;
};

/**
 * Busca negocios en Google Maps a través de Outscraper.
 *
 * Lanza un error con un mensaje legible si la API falla, para que el
 * pipeline pueda avisar sin romperse.
 */
export async function outscraperMapsSearch(
  params: OutscraperSearch,
): Promise<OutscraperPlace[]> {
  const apiKey = outscraperApiKey();
  if (!apiKey) {
    throw new Error(
      "OUTSCRAPER_API_KEY no está configurada (añádela al .env para activar Google Maps).",
    );
  }

  const limit = Math.min(Math.max(params.limit ?? 20, 1), MAX_LIMIT_PER_REQUEST);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${OUTSCRAPER_BASE}/google-maps-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        query: [[params.query, params.location].filter(Boolean).join(", ")],
        limit,
        language: params.language ?? "es",
        region: "ES",
        async: false,
        fields: REQUESTED_FIELDS.join(","),
      }),
      signal: controller.signal,
    });

    if (!response.ok || response.status !== 200) {
      const body = await response.text().catch(() => "");
      throw new Error(`Outscraper respondió ${response.status}: ${body.slice(0, 200) || "(sin cuerpo)"}`);
    }
    const json = await response.json() as { status?: unknown; data?: unknown };
    if (String(json.status).toLowerCase() !== "success" || !Array.isArray(json.data)) {
      throw new Error("Outscraper no devolvió un resultado completo válido");
    }
    // Un resultado por consulta: data es normalmente [[negocio, ...]].
    const groups: unknown[] = json.data.flat();
    if (groups.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
      throw new Error("Formato de negocios de Outscraper inválido");
    }
    return groups as OutscraperPlace[];
  } finally {
    clearTimeout(timer);
  }
}
