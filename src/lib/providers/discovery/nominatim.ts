/**
 * Nominatim (OpenStreetMap) — geocodificación y búsqueda de places.
 *
 * Fuente abierta, sin API key. Límite de uso: 1 request/segundo (Nominatim policy).
 */

import type { DiscoveredBusiness } from "../contract";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

export const NOMINATIM_USER_AGENT =
  "prospector/0.1 (local prospect research; https://github.com/alvgaragu/agendaos.es)";

/** Timeout por request contra Nominatim. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Separación mínima entre llamadas (política de uso de Nominatim). */
const MIN_INTERVAL_MS = 1_000;

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  displayName: string;
};

export type NominatimAddress = {
  road?: string;
  house_number?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  province?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
};

export type NominatimPlace = {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
  extratags?: Record<string, string>;
  namedetails?: Record<string, string>;
  boundingbox?: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cola serial con separación mínima entre llamadas. */
let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const elapsed = Date.now() - lastCallAt;
    if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
    lastCallAt = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "es,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(path: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return `${NOMINATIM_BASE}${path}?${search.toString()}`;
}

/** Geocodifica texto libre ("Madrid", "Carrer de Mallorca 1, Barcelona"). */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const data = await throttle(() =>
    fetchJson<NominatimPlace[]>(
      buildUrl("/search", {
        q: trimmed,
        format: "jsonv2",
        limit: 1,
        addressdetails: 1,
        extratags: 1,
        namedetails: 1,
      }),
    ),
  );

  const first = data?.[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    latitude: lat,
    longitude: lon,
    displayName: first.display_name ?? trimmed,
  };
}

/** Geocodificación inversa: coordenadas → dirección legible. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<GeocodeResult | null> {
  const data = await throttle(() =>
    fetchJson<NominatimPlace>(
      buildUrl("/reverse", {
        lat: latitude,
        lon: longitude,
        format: "jsonv2",
        addressdetails: 1,
        extratags: 1,
      }),
    ),
  );

  if (!data) return null;
  const lat = Number(data.lat ?? latitude);
  const lon = Number(data.lon ?? longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    latitude: lat,
    longitude: lon,
    displayName: data.display_name ?? `${lat}, ${lon}`,
  };
}

export type NominatimSearchOptions = {
  /** Término de búsqueda ("fisioterapia"). */
  term: string;
  /** Lugar ("Madrid"). Opcional. */
  place?: string | null;
  /** Tope de resultados. */
  limit?: number;
  /** Código de país ISO. */
  countryCode?: string;
};

/**
 * Búsqueda de negocios/places por texto libre.
 *
 * IMPORTANTE: la búsqueda estructurada de Nominatim (p.ej. `?healthcare=physiotherapist`)
 * devuelve sólo fronteras administrativas. Hay que usar texto libre.
 *
 * El separador importa mucho: `q=fisioterapia Madrid` (espacio) devuelve los
 * POIs reales del término, mientras que `q=fisioterapia, Madrid, España`
 * (comas) devuelve un puñado de resultados genéricos sin datos de contacto.
 */
export async function searchPlaces(
  options: NominatimSearchOptions,
): Promise<NominatimPlace[]> {
  const term = options.term.trim();
  if (!term) return [];

  // Texto libre con espacio: "fisioterapia Madrid".
  const q = options.place?.trim()
    ? `${term} ${options.place.trim()}`
    : `${term} España`;

  const data = await throttle(() =>
    fetchJson<NominatimPlace[]>(
      buildUrl("/search", {
        q,
        format: "jsonv2",
        limit: options.limit ?? 30,
        addressdetails: 1,
        extratags: 1,
        namedetails: 1,
        countrycodes: options.countryCode ?? "es",
      }),
    ),
  );

  return data ?? [];
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Extrae el dominio de una URL. */
export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Convierte un place de Nominatim en un DiscoveredBusiness. */
export function placeToBusiness(place: NominatimPlace): DiscoveredBusiness | null {
  const name = firstNonEmpty(place.name, place.namedetails?.name, place.display_name);
  if (!name) return null;

  const tags = place.extratags ?? {};
  const address = place.address ?? {};
  const website = firstNonEmpty(tags.website, tags["contact:website"], tags.url);
  const phone = firstNonEmpty(tags.phone, tags["contact:phone"], tags["contact:mobile"]);

  const lat = Number(place.lat);
  const lon = Number(place.lon);

  const street = firstNonEmpty(address.road, tags["addr:street"]);
  const houseNumber = firstNonEmpty(address.house_number, tags["addr:housenumber"]);
  const city = firstNonEmpty(
    address.city,
    address.town,
    address.village,
    address.municipality,
    tags["addr:city"],
    tags["addr:town"],
  );
  const region = firstNonEmpty(address.state, address.province, tags["addr:state"], tags["addr:province"]);

  const composed = [
    houseNumber ? `${houseNumber} ${street ?? ""}`.trim() : street,
    tags.postcode,
    city,
    region,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  const osmType = place.osm_type ?? "node";
  const osmId = place.osm_id ?? place.place_id ?? 0;
  const category = firstNonEmpty(place.category, place.type);

  return {
    sourceRef: `osm/${osmType}/${osmId}`,
    source: "nominatim",
    name,
    website,
    domain: domainFromUrl(website),
    phoneNumber: phone,
    city,
    region,
    country: firstNonEmpty(address.country_code, tags["addr:country"], "ES"),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    category,
    address: composed.length > 0 ? composed : null,
    raw: {
      sourceApi: "nominatim",
      osmType,
      osmId,
      placeId: place.place_id,
      type: place.type,
      class: place.category,
      extratags: tags,
      displayName: place.display_name,
    },
  };
}
