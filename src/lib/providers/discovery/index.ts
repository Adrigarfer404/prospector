/**
 * Orquestador de descubrimiento.
 *
 * Combina tres fuentes abiertas (ninguna necesita API key):
 *  1. OSM/Overpass  — por tags (si la red llega a algún mirror).
 *  2. OSM/Nominatim — por texto libre (fuente principal en la práctica).
 *  3. BORME/BOE     — constituciones recientes de empresas sanitarias.
 */

import type {
  DiscoveredBusiness,
  DiscoveryQuery,
  DiscoveryResult,
} from "../contract";
import { searchBorme } from "./borme";
import { geocode, placeToBusiness, searchPlaces } from "./nominatim";
import { deriveCategories, deriveSearchTerm, searchOsm } from "./osm";

export { deriveCategories, deriveSearchTerm } from "./osm";
export { geocode, reverseGeocode } from "./nominatim";
export { searchBorme } from "./borme";
export { searchOsm } from "./osm";

export const DEFAULT_RADIUS_KM = 15;
export const DEFAULT_LIMIT = 50;

/** Separadores que unen "categoría" y "lugar" en texto libre. */
const PLACE_SEPARATOR = /\s+(?:en|en la|en el|del|de la|de|cerca de|cerca del|alrededor de|in|near|at)\s+/i;

/** Sufijos geográficos que no aportan información. */
const PLACE_NOISE = /\b(españa|spain)\b/gi;

export type ParsedQuery = {
  /** Categoría detectada ("fisioterapia"). */
  term: string | null;
  /** Lugar detectado ("Madrid"). */
  place: string | null;
};

/**
 * Separa el término de búsqueda del lugar en una query en lenguaje natural.
 * "fisioterapeutas en Madrid" → { term: "fisioterapia", place: "Madrid" }
 */
export function parseQuery(queryText: string): ParsedQuery {
  const trimmed = queryText.trim();

  // Se parte por el ÚLTIMO separador: "clínicas de fisioterapia en Sevilla"
  // → término "clínicas de fisioterapia", lugar "Sevilla".
  let termPart = trimmed;
  let placePart: string | null = null;

  let lastMatch: RegExpExecArray | null = null;
  for (const match of trimmed.matchAll(new RegExp(PLACE_SEPARATOR.source, "gi"))) {
    lastMatch = match;
  }

  if (lastMatch?.index !== undefined) {
    termPart = trimmed.slice(0, lastMatch.index);
    placePart = trimmed.slice(lastMatch.index + lastMatch[0].length);
  }

  const term = deriveSearchTerm(termPart) ?? deriveSearchTerm(trimmed);

  const place = placePart
    ?.split(",")[0]
    ?.replace(PLACE_NOISE, "")
    ?.replace(/\s+/g, " ")
    ?.trim();

  return {
    term,
    place: place && place.length > 1 ? place : null,
  };
}

/** Normaliza un nombre para deduplicar ("Clínica Fisio S.L." → "clinica fisio s l"). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(sl|s\.l\.|sau|s\.a\.u\.|sa|s\.a\.|cb|scp|sll|s\.l\.)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Intercala grupos round-robin para que ninguna fuente monopolice el top-N. */
export function interleave(groups: DiscoveredBusiness[][]): DiscoveredBusiness[] {
  const out: DiscoveredBusiness[] = [];
  const maxLength = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (item) out.push(item);
    }
  }
  return out;
}

/** Distancia en km entre dos coordenadas (Haversine). */
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Deduplica por sourceRef y por nombre normalizado.
 *
 * Dos negocios con el mismo nombre genérico ("Fisioterapia") sólo se consideran
 * duplicados si comparten web/teléfono o están muy cerca (< 500 m): si no, son
 * clínicas distintas en direcciones distintas.
 */
export function dedupeBusinesses(businesses: DiscoveredBusiness[]): DiscoveredBusiness[] {
  const seenRefs = new Set<string>();
  const byName = new Map<string, DiscoveredBusiness>();
  const out: DiscoveredBusiness[] = [];

  for (const business of businesses) {
    if (seenRefs.has(business.sourceRef)) continue;

    const nameKey = normalizeName(business.name);
    const existing = nameKey.length > 2 ? byName.get(nameKey) : undefined;

    if (existing) {
      const sameContact =
        (Boolean(existing.website) && existing.website === business.website) ||
        (Boolean(existing.phoneNumber) && existing.phoneNumber === business.phoneNumber);
      const existingLat = existing.latitude;
      const existingLon = existing.longitude;
      const businessLat = business.latitude;
      const businessLon = business.longitude;
      const close =
        existingLat !== null &&
        existingLon !== null &&
        businessLat !== null &&
        businessLon !== null &&
        distanceKm(existingLat, existingLon, businessLat, businessLon) < 0.5;

      if (sameContact || close) continue;
    }

    seenRefs.add(business.sourceRef);
    if (nameKey.length > 2 && !byName.has(nameKey)) byName.set(nameKey, business);
    out.push(business);
  }
  return out;
}

export type SearchSources = {
  osm: DiscoveredBusiness[];
  nominatim: DiscoveredBusiness[];
  borme: DiscoveredBusiness[];
  warnings: string[];
};

/**
 * Busca negocios combinando todas las fuentes abiertas.
 * Ninguna fuente es bloqueante: si Overpass no responde, se sigue con el resto.
 */
export async function searchBusinesses(query: DiscoveryQuery): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const limit = query.limit ?? DEFAULT_LIMIT;
  const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;

  const parsed = parseQuery(query.query);
  const place = query.location ?? parsed.place;

  // 1) Centro de búsqueda.
  let latitude = query.latitude ?? null;
  let longitude = query.longitude ?? null;
  let placeLabel = place;

  if (latitude === null || longitude === null) {
    if (place) {
      const geo = await geocode(place);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
        placeLabel = geo.displayName;
      } else {
        warnings.push(`No se pudo geocodificar la ubicación "${place}".`);
      }
    } else {
      warnings.push("La consulta no incluye ubicación: se buscaría en todo el mundo.");
    }
  }

  // 2) Categoría.
  const category = query.category ?? derivedCategory(query.query, parsed.term);

  // 3) Fuentes en paralelo (ninguna bloquea a las demás).
  const [osmResult, nominatimResult, bormeResult] = await Promise.all([
    latitude !== null && longitude !== null
      ? searchOsm({ ...query, category, latitude, longitude, radiusKm, limit }).catch(() => null)
      : Promise.resolve(null),
    runNominatimSearch(
      query,
      parsed,
      place,
      limit,
      warnings,
      { latitude, longitude },
    ),
    searchBorme({ ...query, limit }).catch(() => null),
  ]);

  const osmBusinesses = osmResult?.businesses ?? [];
  if (!osmResult) {
    warnings.push(
      "Overpass no disponible desde esta red; se ha usado OpenStreetMap/Nominatim.",
    );
  }
  warnings.push(...(osmResult?.warnings ?? []));

  const nominatimBusinesses = nominatimResult?.businesses ?? [];
  const bormeBusinesses = bormeResult?.businesses ?? [];
  warnings.push(...(bormeResult?.warnings ?? []));

  // 4) Fusión y deduplicación. Prioridad: OSM (más datos de contacto) → Nominatim → BORME.
  const merged = dedupeBusinesses([...osmBusinesses, ...nominatimBusinesses, ...bormeBusinesses]);

  // Se entrelazan las fuentes para que el top-N no se llene de una sola.
  const bySource = new Map<string, DiscoveredBusiness[]>();
  for (const business of merged) {
    const bucket = bySource.get(business.source) ?? [];
    bucket.push(business);
    bySource.set(business.source, bucket);
  }
  const interleaved = interleave(
    [bySource.get("osm") ?? [], bySource.get("nominatim") ?? [], bySource.get("borme") ?? []],
  );

  const filtered = query.requireWebsite
    ? interleaved.filter((business) => Boolean(business.website))
    : interleaved;

  const businesses = filtered.slice(0, limit);

  const where = placeLabel ? ` en ${placeLabel}` : "";
  const interpretation = [
    `${businesses.length} negocios encontrados${where}.`,
    `${osmBusinesses.length} en OpenStreetMap/Overpass,`,
    `${nominatimBusinesses.length} en OpenStreetMap/Nominatim,`,
    `${bormeBusinesses.length} constituciones sanitarias recientes en el BORME.`,
    `Categoría interpretada: "${category}". Radio de búsqueda: ${radiusKm} km.`,
  ].join(" ");

  return {
    businesses,
    interpretation,
    warnings,
    provider: "osm+nominatim+borme",
  };
}

/** Búsqueda por texto libre en Nominatim. */
async function runNominatimSearch(
  query: DiscoveryQuery,
  parsed: ParsedQuery,
  place: string | null,
  limit: number,
  warnings: string[],
  centerRef: { latitude: number | null; longitude: number | null },
): Promise<DiscoveryResult | null> {
  const term = parsed.term;
  if (!term) {
    warnings.push(
      "No se reconoció la categoría en la consulta; se ha omitido la búsqueda por texto libre.",
    );
    return null;
  }

  const places = await searchPlaces({
    term,
    place,
    limit: Math.min(Math.max(limit, 20), 50),
    countryCode: (query.country ?? "ES").toLowerCase(),
  });

  const center = centerRef;
  const businesses: DiscoveredBusiness[] = [];
  for (const placeResult of places) {
    const business = placeToBusiness(placeResult);
    if (!business) continue;
    if (query.requireWebsite && !business.website) continue;
    // Filtro geográfico: descartamos pueblos lejanos cuando tenemos centro.
    if (
      center.latitude !== null &&
      center.longitude !== null &&
      business.latitude !== null &&
      business.longitude !== null
    ) {
      const distance = distanceKm(
        center.latitude,
        center.longitude,
        business.latitude,
        business.longitude,
      );
      if (distance > (query.radiusKm ?? DEFAULT_RADIUS_KM) + 25) continue;
    }
    businesses.push(business);
  }

  return {
    businesses,
    interpretation: `Nominatim devolvió ${places.length} places para "${term}".`,
    warnings: [],
    provider: "nominatim",
  };
}

/** Categoría OSM a partir del texto de la query. */
function derivedCategory(queryText: string, term: string | null): string {
  if (term) {
    const categories = deriveCategories(term);
    return categories[0] ?? "healthcare";
  }
  const categories = deriveCategories(queryText);
  return categories[0] ?? "healthcare";
}
