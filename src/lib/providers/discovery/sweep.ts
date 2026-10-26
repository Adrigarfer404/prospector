/**
 * Barrido diario de Google Maps.
 *
 * Construye el censo: recorre una matriz de (categoría × provincia) con un
 * cursor persistido en `SweepState`, de forma que cada pasada cubre celdas
 * nuevas y ninguna se repite.
 *
 * El orden de las provincias NO es alfabético: empieza por las de mayor
 * densidad de mercado, que es donde hay más negocios quemjora vender.
 */

import { prisma } from "../../db";
import { scoreAndSaveLead, upsertCompany, upsertLead } from "../../pipeline";
import { enrichBusiness, findEmails, personFromBusinessName, verifyEmails } from "../enrichment";
import { mapsPlaceToBusiness } from "./maps";
import { outscraperConfigured, outscraperMapsSearch } from "./outscraper";

export type SweepCategory = {
  /** Identificador estable (tipo primario de Google Maps). */
  id: string;
  /** Etiqueta legible. */
  label: string;
  /** Texto de búsqueda en Maps. */
  query: string;
};

/**
 * Categorías por sector. El `id` es el `primaryType` de Google Maps, así que
 * se puede usar para filtrar por tipo cuando la API lo devuelve.
 */
export const SWEEP_CATEGORIES: SweepCategory[] = [
  { id: "physiotherapist", label: "Fisioterapia", query: "fisioterapia" },
  { id: "dentist", label: "Odontología", query: "clínica dental" },
  { id: "psychologist", label: "Psicología", query: "psicólogo" },
  { id: "nutritionist", label: "Nutrición", query: "nutricionista" },
  { id: "clinic", label: "Consulta médica", query: "consulta médica" },
  { id: "beauty", label: "Medicina estética", query: "medicina estética" },
  { id: "osteopath", label: "Osteopatía", query: "osteópata" },
  { id: "podiatrist", label: "Podología", query: "podólogo" },
  { id: "logopedist", label: "Logopedia", query: "logopeda" },
  { id: "fitness_centre", label: "Entrenamiento personal", query: "entrenamiento personal" },
];

export type SweepProvince = {
  /** Identificador estable (código de provincia). */
  id: string;
  /** Nombre con el que se busca en Maps. */
  name: string;
};

/**
 * Provincias ordenadas por tamaño de mercado: las primeras son las que más
 * negocios tienen y las que más rápido se pueden vender.
 */
export const SWEEP_PROVINCES: SweepProvince[] = [
  { id: "madrid", name: "Madrid" },
  { id: "barcelona", name: "Barcelona" },
  { id: "valencia", name: "Valencia" },
  { id: "sevilla", name: "Sevilla" },
  { id: "bizkaia", name: "Bilbao" },
  { id: "zaragoza", name: "Zaragoza" },
  { id: "malaga", name: "Málaga" },
  { id: "alicante", name: "Alicante" },
  { id: "baleares", name: "Palma de Mallorca" },
  { id: "murcia", name: "Murcia" },
  { id: "a-coruna", name: "A Coruña" },
  { id: "granada", name: "Granada" },
  { id: "cordoba", name: "Córdoba" },
  { id: "valladolid", name: "Valladolid" },
  { id: "pontevedra", name: "Vigo" },
  { id: "navarra", name: "Pamplona" },
  { id: "cantabria", name: "Santander" },
  { id: "alava", name: "Vitoria-Gasteiz" },
  { id: "gipuzkoa", name: "Donostia-San Sebastián" },
  { id: "las-palmas", name: "Las Palmas de Gran Canaria" },
  { id: "tenerife", name: "Santa Cruz de Tenerife" },
  { id: "castellon", name: "Castellón de la Plana" },
  { id: "asturias", name: "Gijón" },
  { id: "toledo", name: "Toledo" },
  { id: "albacete", name: "Albacete" },
  { id: "santa-cruz", name: "Cáceres" },
  { id: "badajoz", name: "Badajoz" },
  { id: "burgos", name: "Burgos" },
  { id: "salamanca", name: "Salamanca" },
  { id: "leon", name: "León" },
  { id: "jaen", name: "Jaén" },
  { id: "ourense", name: "Ourense" },
  { id: "girona", name: "Girona" },
  { id: "tarragona", name: "Tarragona" },
  { id: "lerida", name: "Lleida" },
  { id: "huelva", name: "Huelva" },
  { id: "cadiz", name: "Cádiz" },
  { id: "almeria", name: "Almería" },
  { id: "ciudad-real", name: "Ciudad Real" },
  { id: "merida", name: "Mérida" },
  { id: "guadalajara", name: "Guadalajara" },
  { id: "huesca", name: "Huesca" },
  { id: "teruel", name: "Teruel" },
  { id: "cuenca", name: "Cuenca" },
  { id: "segovia", name: "Segovia" },
  { id: "avila", name: "Ávila" },
  { id: "soria", name: "Soria" },
  { id: "palencia", name: "Palencia" },
  { id: "lugo", name: "Lugo" },
  { id: "melilla", name: "Melilla" },
  { id: "ceuta", name: "Ceuta" },
];

export type SweepCell = {
  index: number;
  category: SweepCategory;
  province: SweepProvince;
};

/** Matriz completa: provincia (por mercado) × categoría. */
export function sweepMatrix(): SweepCell[] {
  const cells: SweepCell[] = [];
  let index = 0;
  for (const province of SWEEP_PROVINCES) {
    for (const category of SWEEP_CATEGORIES) {
      cells.push({ index, category, province });
      index += 1;
    }
  }
  return cells;
}

export type SweepOptions = {
  workspaceId: string;
  /** Cuántas celdas procesar en esta pasada. */
  cells?: number;
  /** Fuerza una categoría concreta (id). */
  categoryId?: string | null;
  /** Fuerza una provincia concreta (id). */
  provinceId?: string | null;
  /** Negocios por celda. */
  limit?: number;
  /** Mínimo de reseñas. */
  minReviews?: number;
  /** Además de guardar el negocio, hacer crawl y buscar emails. */
  enrich?: boolean;
  /** No escribir nada: sólo simular. */
  dryRun?: boolean;
};

export type SweepOutcome = {
  cells: { label: string; found: number; saved: number; leads: number; skipped?: string }[];
  cursorBefore: number;
  cursorAfter: number;
  totalCells: number;
  companies: number;
  leads: number;
  warnings: string[];
};

/** Nombre legible de una celda: "Fisioterapia en Madrid". */
function cellLabel(cell: SweepCell): string {
  return `${cell.category.label} en ${cell.province.name}`;
}

/**
 * Ejecuta una pasada del barrido.
 *
 * La celda de partida se lee del cursor guardado, así que las pasadas son
 * continuas: la primera del día sigue donde se quedó la última.
 */
export async function runMapsSweep(options: SweepOptions): Promise<SweepOutcome> {
  const warnings: string[] = [];
  const matrix = sweepMatrix();

  if (!outscraperConfigured()) {
    return {
      cells: [],
      cursorBefore: 0,
      cursorAfter: 0,
      totalCells: matrix.length,
      companies: 0,
      leads: 0,
      warnings: [
        "Google Maps no está configurado: define OUTSCRAPER_API_KEY en el .env para lanzar el barrido.",
      ],
    };
  }

  const budget = Math.max(1, options.cells ?? 3);
  const limit = options.limit ?? 25;
  const minReviews = options.minReviews ?? 0;

  const state = await prisma.sweepState.findUnique({
    where: { workspaceId_source: { workspaceId: options.workspaceId, source: "maps" } },
  });
  const cursorBefore = state?.cursor ?? 0;

  // Celdas a procesar: las N siguientes del cursor, o las forzadas por CLI.
  let selected: SweepCell[];
  if (options.categoryId || options.provinceId) {
    selected = matrix.filter(
      (cell) =>
        (!options.categoryId || cell.category.id === options.categoryId) &&
        (!options.provinceId || cell.province.id === options.provinceId),
    );
    selected = selected.slice(0, budget);
  } else {
    selected = matrix.slice(cursorBefore % matrix.length).slice(0, budget);
    if (selected.length < budget) {
      // Al final de la matriz se vuelve a empezar por el principio.
      selected = selected.concat(matrix.slice(0, budget - selected.length));
    }
  }

  const results: SweepOutcome["cells"] = [];
  let companies = 0;
  let leads = 0;

  for (const cell of selected) {
    const label = cellLabel(cell);
    try {
      const places = await outscraperMapsSearch({
        query: cell.category.query,
        location: `${cell.province.name}, Spain`,
        limit,
      });

      const businesses = places
        .map(mapsPlaceToBusiness)
        .filter((business) => business !== null)
        .filter((business) => Number(business.raw.reviewCount ?? 0) >= minReviews);

      let saved = 0;
      let cellLeads = 0;

      for (const business of businesses) {
        if (options.dryRun) {
          saved += 1;
          continue;
        }

        // Crawl + emails (opt-in): sólo los negocios con web tienen email
        // recuperable; los demás se guardan como fendibles (teléfono).
        let enrichment: Record<string, unknown> = {};
        let signals: string[] = [];
        let emails: string[] = [];
        if (options.enrich && business.website) {
          try {
            const crawled = await enrichBusiness(business);
            signals = crawled.signals;
            emails = crawled.emails.map((candidate) => candidate.email).filter(Boolean);
            enrichment = {
              teamMembers: crawled.contacts.map((contact) => ({
                name: contact.name,
                role: contact.role,
              })),
              contactPageUrl: crawled.website?.contactPageUrl ?? null,
            };
          } catch (err) {
            warnings.push(
              `No se pudo enriquecer ${business.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else if (!business.website) {
          signals = ["Sin web: necesita presencia digital y agenda online"];
        }

        const company = await upsertCompany(options.workspaceId, business, {
          tags: [cell.category.label, business.category].filter(Boolean) as string[],
          signals,
          enrichment: { ...enrichment, maps: business.raw },
        });
        companies += 1;
        saved += 1;

        if (!options.enrich) continue;

        // Lead: el propietario si el negocio lleva su nombre; si no, el
        // propio negocio. El email genérico sólo para el contacto principal.
        const contactName = personFromBusinessName(business.name) ?? business.name;
        let email: string | null = emails[0] ?? null;
        if (!email && business.domain) {
          try {
            const candidates = await findEmails({
              domain: business.domain,
              fullName: contactName,
              website: business.website,
              knownEmails: emails,
            });
            const verified = await verifyEmails(candidates, { max: 4 });
            email = verified.find((v) => v.status === "verified")?.email ?? email;
          } catch {
            // sin email: se queda con el teléfono
          }
        }

        if (!email && !business.phoneNumber) continue;

        const lead = await upsertLead(options.workspaceId, {
          companyId: company.id,
          fullName: contactName,
          jobTitle: null,
          email,
          phoneNumber: business.phoneNumber,
          website: business.website,
          city: business.city,
          region: business.region,
          country: business.country,
          source: business.source,
          sourceRef: `${business.sourceRef}#${contactName}`,
          enrichment: {
            ...enrichment,
            maps: business.raw,
            domain: business.domain,
          },
        });
        leads += 1;
        cellLeads += 1;

        if (email) {
          await prisma.leadEmail.deleteMany({ where: { leadId: lead.id, email } });
          await prisma.leadEmail.create({
            data: {
              leadId: lead.id,
              email,
              source: "crawl",
              status: "verified",
              confidence: 80,
              verifiedAt: new Date(),
            },
          });
        }

        const { loadCriteria } = await import("../../pipeline");
        await scoreAndSaveLead(options.workspaceId, lead.id, await loadCriteria(options.workspaceId));
      }

      results.push({ label, found: businesses.length, saved, leads: cellLeads });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Fallo en ${label}: ${message}`);
      results.push({ label, found: 0, saved: 0, leads: 0, skipped: message });
    }
  }

  const cursorAfter = options.dryRun
    ? cursorBefore
    : (cursorBefore + selected.length) % matrix.length;

  if (!options.dryRun) {
    await prisma.sweepState.upsert({
      where: { workspaceId_source: { workspaceId: options.workspaceId, source: "maps" } },
      create: {
        workspaceId: options.workspaceId,
        source: "maps",
        cursor: cursorAfter,
        total: matrix.length,
        lastRunAt: new Date(),
        stats: stringifyStats({ cells: selected.length, companies, leads }),
      },
      update: {
        cursor: cursorAfter,
        total: matrix.length,
        lastRunAt: new Date(),
        stats: stringifyStats({ cells: selected.length, companies, leads }),
      },
    });
  }

  return {
    cells: results,
    cursorBefore,
    cursorAfter,
    totalCells: matrix.length,
    companies,
    leads,
    warnings,
  };
}

function stringifyStats(value: unknown): string {
  return JSON.stringify(value);
}
