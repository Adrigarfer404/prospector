/**
 * OSM / Overpass — fuente de descubrimiento por tags.
 *
 * Overpass se implementa completo (OverpassQL + mapeo de tags), pero la red de
 * ejecución puede no llegar a ningún mirror: por eso `searchOsm` hace un probe
 * de disponibilidad con timeout corto y devuelve `null` con un warning en vez
 * de bloquear el descubrimiento.
 */

import type { DiscoveredBusiness, DiscoveryQuery, DiscoveryResult } from "../contract";
import { domainFromUrl } from "./nominatim";

export type OsmTagKey =
  | "amenity"
  | "healthcare"
  | "shop"
  | "office"
  | "craft"
  | "leisure"
  | "sport";

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** Mirrors de Overpass, en orden de preferencia. */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
] as const;

export const OVERPASS_USER_AGENT =
  "prospector/0.1 (local prospect research; https://github.com/alvgaragu/agendaos.es)";

/** Timeout del probe de disponibilidad (no bloquea). */
const PROBE_TIMEOUT_MS = 8_000;
/** Timeout de la consulta real. */
const QUERY_TIMEOUT_MS = 45_000;

/** Radio por defecto en metros. */
export const DEFAULT_RADIUS_M = 15_000;
/** Tope de resultados por defecto. */
export const DEFAULT_LIMIT = 50;

/** Un filtro de tag para OverpassQL. `value` vacío = presencia del tag. */
export type OsmFilter = { tag: OsmTagKey; value: string };

/**
 * Sinónimos ES/EN → filtros de tags OSM.
 * La clave es la forma normalizada (sin acentos, minúscula, singular).
 */
const CATEGORY_SYNONYMS: Record<string, OsmFilter[]> = {
  // --- fisioterapia ---
  fisioterapeuta: [
    { tag: "healthcare", value: "physiotherapist" },
    { tag: "amenity", value: "physiotherapist" },
  ],
  fisioterapeutas: [
    { tag: "healthcare", value: "physiotherapist" },
    { tag: "amenity", value: "physiotherapist" },
  ],
  fisioterapia: [
    { tag: "healthcare", value: "physiotherapist" },
    { tag: "amenity", value: "physiotherapist" },
  ],
  physiotherapist: [
    { tag: "healthcare", value: "physiotherapist" },
    { tag: "amenity", value: "physiotherapist" },
  ],
  physiotherapy: [
    { tag: "healthcare", value: "physiotherapist" },
    { tag: "amenity", value: "physiotherapist" },
  ],
  physio: [
    { tag: "healthcare", value: "physiotherapist" },
    { tag: "amenity", value: "physiotherapist" },
  ],
  // --- nutrición ---
  nutricionista: [
    { tag: "healthcare", value: "nutritionist" },
    { tag: "amenity", value: "nutritionist" },
  ],
  nutricionistas: [
    { tag: "healthcare", value: "nutritionist" },
    { tag: "amenity", value: "nutritionist" },
  ],
  nutricion: [
    { tag: "healthcare", value: "nutritionist" },
    { tag: "amenity", value: "nutritionist" },
  ],
  nutritionist: [
    { tag: "healthcare", value: "nutritionist" },
    { tag: "amenity", value: "nutritionist" },
  ],
  nutrition: [
    { tag: "healthcare", value: "nutritionist" },
    { tag: "amenity", value: "nutritionist" },
  ],
  dietista: [
    { tag: "healthcare", value: "nutritionist" },
    { tag: "amenity", value: "nutritionist" },
  ],
  // --- psicología ---
  psicologo: [
    { tag: "healthcare", value: "psychologist" },
    { tag: "amenity", value: "psychologist" },
  ],
  psicologos: [
    { tag: "healthcare", value: "psychologist" },
    { tag: "amenity", value: "psychologist" },
  ],
  psicologia: [
    { tag: "healthcare", value: "psychologist" },
    { tag: "amenity", value: "psychologist" },
  ],
  psychologist: [
    { tag: "healthcare", value: "psychologist" },
    { tag: "amenity", value: "psychologist" },
  ],
  psychologia: [
    { tag: "healthcare", value: "psychologist" },
    { tag: "amenity", value: "psychologist" },
  ],
  // --- osteopatía / logopedia / odontología / podología ---
  osteopata: [{ tag: "healthcare", value: "osteopath" }],
  osteopatia: [{ tag: "healthcare", value: "osteopath" }],
  osteopath: [{ tag: "healthcare", value: "osteopath" }],
  logopeda: [
    { tag: "healthcare", value: "logopedist" },
    { tag: "amenity", value: "speech_therapist" },
  ],
  logopedia: [
    { tag: "healthcare", value: "logopedist" },
    { tag: "amenity", value: "speech_therapist" },
  ],
  dentista: [
    { tag: "healthcare", value: "dentist" },
    { tag: "amenity", value: "dentist" },
  ],
  dentistas: [
    { tag: "healthcare", value: "dentist" },
    { tag: "amenity", value: "dentist" },
  ],
  odontologo: [
    { tag: "healthcare", value: "dentist" },
    { tag: "amenity", value: "dentist" },
  ],
  odontologia: [
    { tag: "healthcare", value: "dentist" },
    { tag: "amenity", value: "dentist" },
  ],
  dentist: [
    { tag: "healthcare", value: "dentist" },
    { tag: "amenity", value: "dentist" },
  ],
  podologo: [
    { tag: "healthcare", value: "podiatrist" },
    { tag: "amenity", value: "footcare" },
  ],
  podologia: [
    { tag: "healthcare", value: "podiatrist" },
    { tag: "amenity", value: "footcare" },
  ],
  podiatrist: [{ tag: "healthcare", value: "podiatrist" }],
  // --- Fitness / deporte ---
  "entrenador personal": [
    { tag: "leisure", value: "fitness_centre" },
    { tag: "sport", value: "fitness" },
  ],
  "personal trainer": [
    { tag: "leisure", value: "fitness_centre" },
    { tag: "sport", value: "fitness" },
  ],
  entrenador: [{ tag: "sport", value: "fitness" }],
  gimnasio: [
    { tag: "leisure", value: "fitness_centre" },
    { tag: "sport", value: "fitness" },
  ],
  gym: [
    { tag: "leisure", value: "fitness_centre" },
    { tag: "sport", value: "fitness" },
  ],
  yoga: [{ tag: "leisure", value: "yoga_centre" }],
  pilates: [{ tag: "sport", value: "pilates" }],
  // --- medicina general / clínica ---
  clinica: [
    { tag: "amenity", value: "clinic" },
    { tag: "healthcare", value: "clinic" },
  ],
  "consulta medica": [{ tag: "amenity", value: "doctors" }, { tag: "healthcare", value: "" }],
  doctor: [{ tag: "amenity", value: "doctors" }, { tag: "healthcare", value: "doctor" }],
  medico: [{ tag: "amenity", value: "doctors" }, { tag: "healthcare", value: "doctor" }],
  hospital: [{ tag: "amenity", value: "hospital" }],
  "medicina estetica": [
    { tag: "healthcare", value: "" },
    { tag: "shop", value: "beauty" },
    { tag: "craft", value: "beauty" },
  ],
  estetica: [
    { tag: "shop", value: "beauty" },
    { tag: "craft", value: "beauty" },
    { tag: "healthcare", value: "" },
  ],
  peluqueria: [{ tag: "shop", value: "hairdresser" }],
};

/** Filtros genéricos usados cuando no se reconoce la categoría. */
export const GENERIC_FILTERS: OsmFilter[] = [
  { tag: "healthcare", value: "" },
  { tag: "amenity", value: "" },
];

/**
 * Término canónico de búsqueda para cada categoría (el que mejor funciona en
 * la búsqueda por texto libre de Nominatim).
 */
const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  fisioterapeuta: "fisioterapia",
  fisioterapia: "fisioterapia",
  physiotherapist: "fisioterapia",
  physiotherapy: "fisioterapia",
  physio: "fisioterapia",
  dentista: "dentista",
  dentistas: "dentista",
  odontologo: "dentista",
  odontologia: "dentista",
  dentist: "dentista",
  nutricionista: "nutricionista",
  nutricionistas: "nutricionista",
  nutricion: "nutricionista",
  nutritionist: "nutricionista",
  nutrition: "nutricionista",
  dietista: "nutricionista",
  psicologo: "psicólogo",
  psicologos: "psicólogo",
  psicologia: "psicólogo",
  psychologist: "psicólogo",
  psychologia: "psicólogo",
  osteopata: "osteópata",
  osteopatia: "osteópata",
  osteopath: "osteópata",
  logopeda: "logopeda",
  logopedia: "logopeda",
  podologo: "podólogo",
  podologia: "podólogo",
  podiatrist: "podólogo",
  estetica: "estética",
  "medicina estetica": "estética",
  clinica: "clínica",
  "consulta medica": "consulta médica",
  doctor: "clínica",
  medico: "clínica",
  hospital: "hospital",
  "entrenador personal": "entrenador personal",
  "personal trainer": "entrenador personal",
  entrenador: "entrenador personal",
  gimnasio: "gimnasio",
  gym: "gimnasio",
  yoga: "yoga",
  pilates: "pilates",
};

/**
 * Deriva el término de búsqueda canónico desde texto en lenguaje natural.
 * Devuelve `null` si no reconoce la categoría.
 */
export function deriveSearchTerm(queryText: string): string | null {
  const normalized = normalizeText(queryText);
  const singular = singularize(normalized);
  let best: { key: string; term: string } | null = null;

  for (const [key, term] of Object.entries(CATEGORY_SEARCH_TERMS)) {
    const keyNorm = normalizeText(key);
    if (!singular.includes(keyNorm) && !normalized.includes(keyNorm)) continue;
    if (!best || keyNorm.length > best.key.length) best = { key: keyNorm, term };
  }
  return best?.term ?? null;
}

/** Normaliza texto: sin acentos, minúsculas, espacios colapsados. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quita la "s" final para comparar singular/plural. */
function singularize(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Deriva las categorías OSM sugeridas a partir de texto en lenguaje natural. */
export function deriveCategories(queryText: string): string[] {
  const normalized = normalizeText(queryText);
  const singular = singularize(normalized);
  const words = singular.split(" ").filter(Boolean);

  const matched = new Set<string>();
  for (const [key, filters] of Object.entries(CATEGORY_SYNONYMS)) {
    const keyNorm = normalizeText(key);
    const keySingular = singularize(keyNorm);
    const hit =
      singular.includes(keySingular) ||
      normalized.includes(keyNorm) ||
      words.includes(keySingular) ||
      words.includes(keyNorm);
    if (hit) for (const filter of filters) matched.add(`${filter.tag}:${filter.value}`);
  }

  if (matched.size === 0) return ["healthcare", "amenity"];
  return [...matched];
}

/** Devuelve los filtros OverpassQL de una categoría ya resuelta. */
export function filtersForCategory(category: string): OsmFilter[] {
  const normalized = normalizeText(category);
  const filters: OsmFilter[] = [];
  for (const [key, value] of Object.entries(CATEGORY_SYNONYMS)) {
    const keyNorm = normalizeText(key);
    if (keyNorm === normalized || singularize(keyNorm) === singularize(normalized)) {
      filters.push(...value);
    }
  }
  if (filters.length === 0) {
    // Categoría ya en formato OSM ("physiotherapist", "dentist", ...).
    const known = new Set(
      Object.values(CATEGORY_SYNONYMS)
        .flat()
        .map((f) => f.value)
        .filter(Boolean),
    );
    if (known.has(normalized)) {
      filters.push({ tag: "healthcare", value: normalized });
    } else {
      filters.push(...GENERIC_FILTERS);
    }
  }
  return dedupeFilters(filters);
}

function dedupeFilters(filters: OsmFilter[]): OsmFilter[] {
  const seen = new Set<string>();
  const out: OsmFilter[] = [];
  for (const filter of filters) {
    const key = `${filter.tag}=${filter.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(filter);
  }
  return out;
}

/** Construye la consulta OverpassQL para una categoría y un centro. */
export function buildOverpassQuery(options: {
  category: string;
  latitude: number;
  longitude: number;
  radiusM?: number;
  limit?: number;
}): string {
  const radius = options.radiusM ?? DEFAULT_RADIUS_M;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const filters = filtersForCategory(options.category);

  const selectors: string[] = [];
  for (const filter of filters) {
    const tagFilter = filter.value
      ? `["${filter.tag}"="${filter.value}"]`
      : `["${filter.tag}"]`;
    for (const type of ["node", "way", "relation"]) {
      selectors.push(
        `${type}${tagFilter}(around:${radius},${options.latitude.toFixed(6)},${options.longitude.toFixed(6)});`,
      );
    }
  }

  return [
    `[out:json][timeout:60];`,
    `(`,
    ...selectors,
    `);`,
    `out center ${Math.max(limit * 4, 100)};`,
  ].join("\n");
}

/** Consulta OverpassQL "barata" para comprobar si el mirror tiene datos de la zona. */
function buildProbeQuery(latitude: number, longitude: number): string {
  return `[out:json][timeout:10];node(around:1500,${latitude.toFixed(6)},${longitude.toFixed(6)})["amenity"];out 3;`;
}

async function postOverpass(
  endpoint: string,
  ql: string,
  timeoutMs: number,
): Promise<OsmElement[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "User-Agent": OVERPASS_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: ql }).toString(),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const start = text.indexOf("{");
    if (start === -1) return null;
    const parsed = JSON.parse(text.slice(start)) as { elements?: OsmElement[] };
    return Array.isArray(parsed.elements) ? parsed.elements : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe de disponibilidad: prueba todos los mirrors en paralelo con timeout
 * corto y devuelve los que responden JSON válido con elementos.
 */
export async function probeOverpass(
  latitude: number,
  longitude: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string[]> {
  const probe = buildProbeQuery(latitude, longitude);
  const results: Array<string | null> = await Promise.all(
    OVERPASS_ENDPOINTS.map(async (endpoint) => {
      const elements = await postOverpass(endpoint, probe, timeoutMs);
      return elements && elements.length > 0 ? endpoint : null;
    }),
  );
  return results.filter((endpoint): endpoint is string => endpoint !== null);
}

/** Ejecuta una consulta OverpassQL contra los endpoints indicados. */
export async function runOverpass(
  ql: string,
  endpoints: string[],
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<{ elements: OsmElement[]; endpoint: string } | null> {
  for (const endpoint of endpoints) {
    const elements = await postOverpass(endpoint, ql, timeoutMs);
    if (elements && elements.length > 0) return { elements, endpoint };
  }
  // Última pasada: un endpoint que responde pero devuelve 0 elementos.
  for (const endpoint of endpoints) {
    const elements = await postOverpass(endpoint, ql, timeoutMs);
    if (elements) return { elements, endpoint };
  }
  return null;
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Mapea un elemento OSM a DiscoveredBusiness. */
export function elementToBusiness(element: OsmElement): DiscoveredBusiness | null {
  const tags = element.tags ?? {};
  const name = firstNonEmpty(tags.name, tags["name:es"], tags.brand, tags.operator);
  if (!name) return null;

  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;

  const website = firstNonEmpty(tags.website, tags["contact:website"], tags.url);
  const phone = firstNonEmpty(
    tags.phone,
    tags["contact:phone"],
    tags["contact:mobile"],
    tags["contact:telephone"],
  );

  const street = firstNonEmpty(tags["addr:street"]);
  const houseNumber = firstNonEmpty(tags["addr:housenumber"]);
  const city = firstNonEmpty(
    tags["addr:city"],
    tags["addr:town"],
    tags["addr:village"],
    tags["addr:municipality"],
    tags["addr:place"],
  );
  const region = firstNonEmpty(tags["addr:state"], tags["addr:province"]);
  const postcode = firstNonEmpty(tags["addr:postcode"]);

  const address = [
    houseNumber ? `${houseNumber} ${street ?? ""}`.trim() : street,
    postcode,
    city,
    region,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  const category = deriveElementCategory(tags);

  return {
    sourceRef: `osm/${element.type}/${element.id}`,
    source: "osm",
    name,
    website,
    domain: domainFromUrl(website),
    phoneNumber: phone,
    city,
    region,
    country: firstNonEmpty(tags["addr:country"], "ES"),
    latitude: lat,
    longitude: lon,
    category,
    address: address.length > 0 ? address : null,
    raw: {
      sourceApi: "overpass",
      osmType: element.type,
      osmId: element.id,
      tags,
    },
  };
}

const CATEGORY_PRIORITY: OsmTagKey[] = [
  "healthcare",
  "amenity",
  "shop",
  "office",
  "craft",
  "leisure",
  "sport",
];

/** Etiqueta principal del elemento ("healthcare:physiotherapist"). */
export function deriveElementCategory(tags: Record<string, string>): string | null {
  for (const tag of CATEGORY_PRIORITY) {
    const value = tags[tag];
    if (value) return `${tag}:${value}`;
  }
  return null;
}

/**
 * Descubre negocios por tags OSM.
 * Devuelve `null` si Overpass no es alcanzable (para que el orquestador añada
 * un warning y siga con el resto de fuentes).
 */
export async function searchOsm(query: DiscoveryQuery): Promise<DiscoveryResult | null> {
  const warnings: string[] = [];

  const latitude = query.latitude;
  const longitude = query.longitude;
  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  const category = query.category ?? deriveCategories(query.query)[0] ?? "healthcare";
  const radiusM = Math.round((query.radiusKm ?? 15) * 1000);
  const limit = query.limit ?? DEFAULT_LIMIT;

  const endpoints = await probeOverpass(latitude, longitude);
  if (endpoints.length === 0) {
    return null;
  }

  const ql = buildOverpassQuery({
    category,
    latitude,
    longitude,
    radiusM,
    limit,
  });

  const result = await runOverpass(ql, endpoints);
  if (!result) {
    warnings.push("Overpass respondió sin datos utilizables.");
    return null;
  }

  const businesses: DiscoveredBusiness[] = [];
  for (const element of result.elements) {
    const business = elementToBusiness(element);
    if (!business) continue;
    if (query.requireWebsite && !business.website) continue;
    businesses.push(business);
  }

  return {
    businesses: businesses.slice(0, limit),
    interpretation: `Overpass (${result.endpoint}) devolvió ${businesses.length} elementos OSM para "${category}" en ${radiusM / 1000} km.`,
    warnings,
    provider: "osm",
  };
}
