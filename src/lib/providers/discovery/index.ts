/**
 * Orquestador de descubrimiento.
 *
 * Fuente abierta con volumen real en España: el BORME/BOE (Boletín Oficial del
 * Registro Mercantil), con empresas de nueva constitución — clínicas, consultas
 * y despachos profesionales sanitarios que todavía no tienen agenda online.
 *
 * Se retiró OpenStreetMap (Overpass + Nominatim): para este ICP no aportaba
 * cobertura útil en España y sólo consumía tiempo de ejecución y peticiones.
 */

import type {
  DiscoveredBusiness,
  DiscoveryQuery,
  DiscoveryResult,
} from "../contract";
import { searchBorme } from "./borme";

export { searchBorme } from "./borme";

export const DEFAULT_LIMIT = 50;

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

/**
 * Busca negocios en las fuentes abiertas disponibles.
 *
 * Ninguna fuente es bloqueante: si el BORME no responde, la búsqueda web del
 * pipeline sigue siendo la principal.
 */
export async function searchBusinesses(query: DiscoveryQuery): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const limit = query.limit ?? DEFAULT_LIMIT;

  let bormeResult: DiscoveryResult | null = null;
  try {
    bormeResult = await searchBorme({ ...query, limit });
  } catch (err) {
    warnings.push(`El BORME falló: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!bormeResult) {
    warnings.push(
      "El BORME no devolvió constituciones para esa ubicación: la búsqueda se ha hecho sólo con la búsqueda web.",
    );
  }
  warnings.push(...(bormeResult?.warnings ?? []));

  const bormeBusinesses = bormeResult?.businesses ?? [];
  const merged = dedupeBusinesses(bormeBusinesses);

  const businesses = (
    query.requireWebsite ? merged.filter((business) => Boolean(business.website)) : merged
  ).slice(0, limit);

  const interpretation = `${businesses.length} constituciones sanitarias recientes en el BORME.`;

  return {
    businesses,
    interpretation,
    warnings,
    provider: "borme",
  };
}
