/**
 * Provider de Google Maps (vía Outscraper).
 *
 * Es la capa que **enumera** negocios: la búsqueda web sólo devuelve el top de
 * resultados ya posicionados (que suelen ser los que ya tienen web y agenda),
 * mientras que Maps recorre la cola larga y además aporta dos señales que el
 * resto de fuentes no dan:
 *
 *   - `rating` y `reviewCount`: demanda real del negocio.
 *   - la ausencia de `website`: un negocio con muchas reseñas y sin web es
 *     exactamente el perfil de cliente de AgendaOS.
 *
 * Opt-in: sin `OUTSCRAPER_API_KEY` no hace ninguna llamada y devuelve un
 * aviso, dejando el resto del pipeline intacto.
 */

import type {
  DiscoveredBusiness,
  DiscoveryQuery,
  DiscoveryResult,
} from "../contract";
import { parseQuery } from "../finder";
import { outscraperConfigured, outscraperMapsSearch, type OutscraperPlace } from "./outscraper";

export const MAPS_SOURCE = "maps";

export type MapsOptions = {
  /** Tope de negocios devueltos. */
  limit?: number;
  /**
   * Mínimo de reseñas para considerar el negocio. Filtra el ruido y sube el
   * hit rate: por defecto no filtra.
   */
  minReviews?: number;
  /** Ubicación explícita ("Madrid, Spain"). Si no, se deduce de la query. */
  location?: string | null;
};

/** Mínimo de reseñas configurable por entorno (0 = no filtrar). */
function envMinReviews(): number {
  const raw = Number(process.env.OUTSCRAPER_MIN_REVIEWS ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Dominio a partir de la web que devuelve Maps. */
function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    const host = new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/**
 * Deduce la ciudad de una dirección de Google ("C/ Mayor 1, Madrid, 28013,
 * Spain"). No es un geocodificador: sólo reparte los trozos de la dirección.
 */
function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  // El último trozo suele ser el país y el anterior el código postal.
  const withoutCountry = /^(spain|españa)$/i.test(parts[parts.length - 1])
    ? parts.slice(0, -1)
    : parts;
  const candidates = withoutCountry.filter(
    (part) => !/^\d{4,5}$/.test(part) && part.length > 2,
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/** Convierte un resultado de Maps en un negocio del contrato. */
export function mapsPlaceToBusiness(place: OutscraperPlace): DiscoveredBusiness | null {
  const name = (place.title ?? place.name ?? "").trim();
  if (!name) return null;

  const placeId = place.place_id ?? null;
  const address = place.full_address ?? place.address ?? null;
  const reviewCount = Number(place.reviews ?? 0) || 0;
  const rating = Number(place.rating ?? 0) || 0;

  return {
    name,
    sourceRef: placeId
      ? `${MAPS_SOURCE}:${placeId}`
      : `${MAPS_SOURCE}:${name.toLowerCase()}:${address ?? ""}`,
    source: MAPS_SOURCE,
    website: place.site ?? null,
    domain: domainFromUrl(place.site),
    phoneNumber: place.phone ?? null,
    city: place.city ?? cityFromAddress(address),
    region: place.state ?? null,
    country: "ES",
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    category: place.category ?? (Array.isArray(place.types) ? (place.types[0] ?? null) : null),
    address,
    raw: {
      placeId,
      rating,
      reviewCount,
      mapsUrl: place.google_maps_url ?? (placeId ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}` : null),
      businessStatus: place.business_status ?? null,
      types: Array.isArray(place.types) ? place.types : null,
    },
  };
}

/**
 * Busca negocios en Google Maps.
 *
 * Devuelve un `DiscoveryResult` con `provider: "maps"`. Si la clave de API no
 * está puesta, no se lanza ninguna petición: se devuelve un aviso.
 */
export async function searchMaps(
  query: DiscoveryQuery,
  options: MapsOptions = {},
): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const limit = options.limit ?? query.limit ?? 20;

  if (!outscraperConfigured()) {
    return {
      businesses: [],
      interpretation: "Google Maps no se ha consultado (falta OUTSCRAPER_API_KEY).",
      warnings: [
        "Google Maps está desactivado: define OUTSCRAPER_API_KEY en el .env para activarlo.",
      ],
      provider: MAPS_SOURCE,
    };
  }

  const parsed = parseQuery(query.query);
  const location = options.location ?? query.location ?? parsed.location;
  const term = parsed.sector;
  const minReviews = options.minReviews ?? envMinReviews();

  let places: OutscraperPlace[] = [];
  try {
    places = await outscraperMapsSearch({
      query: term,
      location: location && location !== "España" ? `${location}, Spain` : "Spain",
      limit,
    });
  } catch (err) {
    warnings.push(
      `Google Maps falló: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      businesses: [],
      interpretation: "Google Maps no devolvió resultados.",
      warnings,
      provider: MAPS_SOURCE,
    };
  }

  const businesses = places
    .map(mapsPlaceToBusiness)
    .filter((business): business is DiscoveredBusiness => business !== null)
    .filter((business) => {
      const reviews = Number(business.raw.reviewCount ?? 0);
      return reviews >= minReviews;
    });

  const withWebsite = businesses.filter((business) => Boolean(business.website)).length;
  const interpretation =
    `${businesses.length} negocios en Google Maps (${term}${location && location !== "España" ? ` en ${location}` : ""}); ` +
    `${withWebsite} con web propia, ${businesses.length - withWebsite} sin web` +
    (minReviews > 0 ? ` (mínimo ${minReviews} reseñas)` : "") +
    ".";

  return {
    businesses,
    interpretation,
    warnings,
    provider: MAPS_SOURCE,
  };
}
