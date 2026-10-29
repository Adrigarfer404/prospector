/**
 * Barrido diario de Google Maps.
 *
 * Recorre una matriz de categoría × ubicación con un cursor persistido en
 * `SweepState`. Al terminar la matriz vuelve a empezar.
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
  /** Identificador estable usado en la línea de comandos. */
  id: string;
  /** Etiqueta legible. */
  label: string;
  /** Texto de búsqueda en Maps. */
  query: string;
};

/**
 * Categorías por sector. El texto de búsqueda se envía a Google Maps; el id
 * se usa solo para seleccionar la categoría desde la línea de comandos.
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
  { id: "bizkaia", name: "Bizkaia" },
  { id: "zaragoza", name: "Zaragoza" },
  { id: "malaga", name: "Málaga" },
  { id: "alicante", name: "Alicante" },
  { id: "baleares", name: "Illes Balears" },
  { id: "murcia", name: "Murcia" },
  { id: "a-coruna", name: "A Coruña" },
  { id: "granada", name: "Granada" },
  { id: "cordoba", name: "Córdoba" },
  { id: "valladolid", name: "Valladolid" },
  { id: "pontevedra", name: "Pontevedra" },
  { id: "navarra", name: "Navarra" },
  { id: "cantabria", name: "Cantabria" },
  { id: "alava", name: "Álava" },
  { id: "gipuzkoa", name: "Gipuzkoa" },
  { id: "las-palmas", name: "Las Palmas" },
  { id: "tenerife", name: "Santa Cruz de Tenerife" },
  { id: "castellon", name: "Castellón" },
  { id: "asturias", name: "Asturias" },
  { id: "toledo", name: "Toledo" },
  { id: "albacete", name: "Albacete" },
  { id: "caceres", name: "Cáceres" },
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
  { id: "la-rioja", name: "La Rioja" },
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
  { id: "zamora", name: "Zamora" },
];

export type SweepCell = {
  index: number;
  category: SweepCategory;
  province: SweepProvince;
};

/** Matriz completa: ubicación (por mercado) × categoría. */
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
export async function runMapsSweep(options: SweepOptions, deps = { outscraperConfigured, outscraperMapsSearch, enrichBusiness, findEmails, verifyEmails }): Promise<SweepOutcome> {
  const warnings: string[] = [];
  const matrix = sweepMatrix();

  const budget = options.cells ?? 3;
  const limit = options.limit ?? 25;
  const minReviews = options.minReviews ?? 0;
  if (!Number.isInteger(budget) || budget < 1 || budget > matrix.length) throw new Error(`cells debe ser un entero entre 1 y ${matrix.length}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit debe ser un entero entre 1 y 100");
  if (!Number.isInteger(minReviews) || minReviews < 0) throw new Error("min-reviews debe ser un entero no negativo");
  const state = await prisma.sweepState.findUnique({ where: { workspaceId_source: { workspaceId: options.workspaceId, source: "maps" } } });
  const cursorBefore = state?.cursor ?? 0;
  const targeted = Boolean(options.categoryId || options.provinceId);
  // Conserva los alias usados en versiones anteriores.
  const provinceId = options.provinceId === "santa-cruz" ? "caceres" : options.provinceId === "merida" ? "badajoz" : options.provinceId;
  if (options.categoryId && !SWEEP_CATEGORIES.some(c => c.id === options.categoryId)) throw new Error("Categoría desconocida");
  if (provinceId && !SWEEP_PROVINCES.some(p => p.id === provinceId)) throw new Error("Ubicación desconocida");

  // Celdas a procesar: las N siguientes del cursor, o las forzadas por CLI.
  let selected: SweepCell[];
  if (options.categoryId || options.provinceId) {
    selected = matrix.filter(
      (cell) =>
        (!options.categoryId || cell.category.id === options.categoryId) &&
        (!options.provinceId || cell.province.id === provinceId),
    );
    selected = selected.slice(0, budget);
  } else {
    selected = matrix.slice(cursorBefore % matrix.length).slice(0, budget);
    if (selected.length < budget) {
      // Al final de la matriz se vuelve a empezar por el principio.
      selected = selected.concat(matrix.slice(0, budget - selected.length));
    }
  }

  if (options.dryRun) return { cells: selected.map(cell => ({ label: cellLabel(cell), found: 0, saved: 0, leads: 0 })), cursorBefore, cursorAfter: cursorBefore, totalCells: matrix.length, companies: 0, leads: 0, warnings: ["Simulación: no se ha consultado Outscraper ni guardado datos."] };
  if (!deps.outscraperConfigured()) return { cells: [], cursorBefore, cursorAfter: cursorBefore, totalCells: matrix.length, companies: 0, leads: 0, warnings: ["Google Maps no está configurado: define OUTSCRAPER_API_KEY en el .env para lanzar el barrido."] };

  let cursorAfter = cursorBefore;
  const results: SweepOutcome["cells"] = [];
  let companies = 0;
  let leads = 0;

  for (const cell of selected) {
    const label = cellLabel(cell);
    let found = 0;
    let saved = 0;
    let cellLeads = 0;
    try {
      const places = await deps.outscraperMapsSearch({
        query: cell.category.query,
        location: `${cell.province.name}, Spain`,
        limit,
      });

      const businesses = places
        .map(mapsPlaceToBusiness)
        .filter((business) => business !== null)
        .filter((business) => Number(business.raw.reviewCount ?? 0) >= minReviews);

      found = businesses.length;
      for (const business of businesses) {
        // Crawl + emails (opt-in): sólo los negocios con web tienen email
        // recuperable; los demás se guardan como fendibles (teléfono).
        let enrichment: Record<string, unknown> = {};
        let signals: string[] = [];
        let emails: string[] = [];
        let selectedSource = "crawl";
        let selectedStatus = "unverified";
        let selectedConfidence = 80;
        if (options.enrich && business.website) {
          try {
            const crawled = await deps.enrichBusiness(business);
            signals = crawled.signals;
            emails = crawled.emails.map((candidate) => candidate.email).filter(Boolean);
            const firstEmail = crawled.emails.find(candidate => candidate.email === emails[0]);
            if (firstEmail) { selectedSource = firstEmail.source === "web" ? "crawl" : firstEmail.source; selectedConfidence = firstEmail.confidence; }
            enrichment = {
              teamMembers: crawled.contacts.map((contact) => ({
                name: contact.name,
                role: contact.role,
              })),
              contactPageUrl: crawled.website?.contactPageUrl ?? null,
            };
          } catch (err) {
            throw new Error(`No se pudo enriquecer ${business.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (!business.website) {
          signals = ["Sin web propia identificada en Google Maps"];
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
        let email: string | null = emails[0]?.trim().toLowerCase() ?? null;
        if (!email && business.domain) {
          try {
            const candidates = await deps.findEmails({
              domain: business.domain,
              fullName: contactName,
              website: business.website,
              knownEmails: emails,
            });
            const verified = await deps.verifyEmails(candidates, { max: 4 });
            const valid = verified.find((v) => v.status === "verified");
            if (valid) { email = valid.email.trim().toLowerCase(); selectedStatus = "verified"; selectedSource = valid.candidate.source === "web" ? "crawl" : valid.candidate.source; selectedConfidence = valid.confidence; }
          } catch (err) {
            throw new Error(`No se pudieron comprobar emails de ${business.name}: ${err instanceof Error ? err.message : String(err)}`);
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

        if (email && lead.email?.toLowerCase() === email.toLowerCase()) {
          const existingEmail = await prisma.leadEmail.findUnique({ where: { leadId_email: { leadId: lead.id, email } } });
          if (!existingEmail) {
            await prisma.leadEmail.create({ data: { leadId: lead.id, email, source: selectedSource, status: selectedStatus, confidence: selectedConfidence, verifiedAt: selectedStatus === "verified" ? new Date() : null } });
          } else if (selectedStatus === "verified" && existingEmail.status !== "verified") {
            await prisma.leadEmail.update({ where: { id: existingEmail.id }, data: { source: selectedSource, status: "verified", confidence: selectedConfidence, verifiedAt: new Date() } });
          }
        }

        const { loadCriteria } = await import("../../pipeline");
        await scoreAndSaveLead(options.workspaceId, lead.id, await loadCriteria(options.workspaceId));
      }

      if (!targeted) {
        const nextCursor = (cell.index + 1) % matrix.length;
        await prisma.sweepState.upsert({
          where: { workspaceId_source: { workspaceId: options.workspaceId, source: "maps" } },
          create: { workspaceId: options.workspaceId, source: "maps", cursor: nextCursor, total: matrix.length, lastRunAt: new Date(), stats: stringifyStats({ cells: results.length + 1, companies, leads }) },
          update: { cursor: nextCursor, total: matrix.length, lastRunAt: new Date(), stats: stringifyStats({ cells: results.length + 1, companies, leads }) },
        });
        cursorAfter = nextCursor;
      }
      results.push({ label, found: businesses.length, saved, leads: cellLeads });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Fallo en ${label}: ${message}`);
      results.push({ label, found, saved, leads: cellLeads, skipped: message });
      break;
    }
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
