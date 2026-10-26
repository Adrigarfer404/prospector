import { prisma } from "./db";
import { logActivity } from "./workspace";
import { buildScoreContext, defaultAgendaosCriteria, detectProfile, scoreLead } from "./scoring";
import { parseJson, stringifyJson, type IcpCriterion } from "./types";
import { companyDedupeKey, mergeEnrichment } from "./dedupe";
import { normalizeNameKey, stripAccents } from "./text";
import { criteriaFromPlaybook } from "./messages";
import { dedupeBusinesses, searchBusinesses } from "./providers/discovery";
import { enrichBusiness, findEmails, normalizePhone, personFromBusinessName, verifyEmails } from "./providers/enrichment";
import { findProspectsViaWeb, resolveBusinessContact } from "./providers/finder";
import type { DiscoveredBusiness } from "./providers/contract";

/**
 * Pipeline completo: descubrir -> persistir -> enriquecer -> puntuar.
 * Es el mismo camino que usa el AI Finder en la UI y el seed de ejemplo.
 */

export type DiscoverOptions = {
  workspaceId: string;
  query: string;
  location?: string;
  limit?: number;
  /** Cuántos negocios enriquecer (crawl de web + emails). El resto solo se guarda. */
  enrichLimit?: number;
  listId?: string | null;
  criteria?: IcpCriterion[] | null;
  /** Cuántos negocios sin web se buscan por nombre para hallar su contacto. */
  resolveLimit?: number;
  /** Permite desactivar ese paso (resolveWithoutWebsite: false). */
  resolveWithoutWebsite?: boolean;
  /** Incluir Google Maps en el descubrimiento (opt-in, requiere API key). */
  includeMaps?: boolean;
  /** Mínimo de reseñas para aceptar un negocio de Maps (0 = sin filtro). */
  minMapsReviews?: number;
};

export type DiscoverOutcome = {
  interpretation: string;
  warnings: string[];
  /** Fuentes que han aportado resultados: "búsqueda web", "BORME", "Google Maps". */
  sources: string[];
  found: number;
  companies: number;
  leads: number;
  enriched: number;
  resolved: number;
  leadIds: string[];
};

function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const withProtocol = input.startsWith("http") ? input : `https://${input}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes(".")) return null;
    if (host.endsWith(".es") || host.endsWith(".com") || host.endsWith(".net") || host.endsWith(".eu")) {
      return host;
    }
    return null;
  } catch {
    return null;
  }
}


/**
 * Reparte el presupuesto de resultados entre fuentes en round-robin, para que
 * una fuente generosa no se coma el límite entero.
 */
function interleaveBySource(
  groups: { businesses: DiscoveredBusiness[]; source: string }[],
): DiscoveredBusiness[] {
  const out: DiscoveredBusiness[] = [];
  const queues = groups.filter((g) => g.businesses.length > 0);
  let index = 0;
  while (out.length < queues.reduce((sum, g) => sum + g.businesses.length, 0)) {
    let progressed = false;
    for (const group of queues) {
      const business = group.businesses[index];
      if (!business) continue;
      out.push(business);
      progressed = true;
      if (out.length >= queues.reduce((sum, g) => sum + g.businesses.length, 0)) break;
    }
    if (!progressed) break;
    index += 1;
  }
  return out;
}

function domainFromUrl(url: string): string | null {
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

function splitName(fullName: string | null | undefined): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Máximo de contactos que se crean por negocio (ordenados por relevancia). */
const MAX_LEADS_PER_BUSINESS = 5;

/** Local parts genéricos: son de la empresa, no de una persona concreta. */
const GENERIC_LOCAL_PARTS = new Set([
  "info","hola","contacto","contact","admin","administracion","adminis","administrativo",
  "office","recepcion","secretaria","secretario","clinic","clinica","consulta","consultorio",
  "prensa","ventas","billing","facturacion","accounts","noreply","donotreply","postmaster",
  "webmaster","mail","email","centro","equipo","infoes","hola1","info1",
]);

/** ¿El email es de la empresa (info@, hola@) y no de una persona? */
export function isGenericEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!local) return true;
  if (GENERIC_LOCAL_PARTS.has(local)) return true;
  return /^(info|hola|contacto|contact|admin|administracion|recepcion|secretaria|ventas|office|clinic|clinica|consulta|prensa|email|correo)[0-9]{0,2}$/.test(local);
}

/** Normaliza un nombre propio para comparar (sin acentos ni sufijos societarios). */
/** Cuánto encaja un contacto con el ICP (el que más puntúa es el primero). */
function contactRelevance(contact: { name: string; role: string | null }): number {
  let score = 0;
  if (contact.role) score += 5;
  if (contact.role && /propietari|direc|gerent|fundador|responsable|coordinador|titular/i.test(contact.role)) {
    score += 5;
  }
  if (
    contact.role &&
    /fisioterapeut|nutricionist|psicolog|odontolog|podolog|osteopat|logoped|dentist|medic|clinic/i.test(
      contact.role,
    )
  ) {
    score += 3;
  }
  return score;
}

/**
 * Elige los contactos que se convertirán en leads:
 * - descarta el nombre comercial del negocio y los duplicados,
 * - prioriza al responsable (propietario / director / profesional),
 * - y limita el número para no llenar la lista de contactos de una cadena.
 */
export function pickContacts(
  business: DiscoveredBusiness,
  contacts: { name: string; role: string | null }[],
): { name: string; role: string | null }[] {
  const businessKey = normalizeNameKey(business.name);
  const unique = new Map<string, { name: string; role: string | null }>();

  for (const contact of contacts) {
    const key = normalizeNameKey(contact.name);
    if (!key || key.length < 5) continue;
    // El nombre de la empresa no es una persona.
    if (key === businessKey) continue;
    if (!unique.has(key)) unique.set(key, contact);
  }

  return [...unique.values()]
    .sort((a, b) => contactRelevance(b) - contactRelevance(a))
    .slice(0, MAX_LEADS_PER_BUSINESS);
}

/**
 * Acepta el enriquecimiento como objeto o como JSON serializado.
 *
 * `parseJson` sólo entiende strings: si le pasás un objeto devolvía `{}` y el
 * enriquecimiento de la empresa (equipo, contacto, descripción) se perdía
 * entero al guardar.
 */
function asEnrichmentRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") return parseJson<Record<string, unknown>>(value, {});
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Normaliza un topónimo para comparar: "A Coruña" == "a coruña". */
function normalizePlace(value: string | null | undefined): string {
  return stripAccents(value ?? "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

type CompanyProbe = {
  dedupeKey: string | null;
  domain: string | null;
  website: string | null;
  name: string;
  nameKey: string;
  city: string | null;
  region: string | null;
  phoneNumber: string | null;
};

/**
 * Localiza el negocio ya guardado al que pertenece este hallazgo.
 *
 * Se prueban, en orden de fiabilidad: clave idempotente, dominio, web, nombre
 * exacto y por último nombre normalizado. El último solo vale si comparten
 * ubicación o teléfono, porque "Clínica Fisio" es un nombre genérico que se
 * repite en cada ciudad.
 */
async function findCompanyCandidate(workspaceId: string, probe: CompanyProbe) {
  const candidates = await prisma.company.findMany({
    where: {
      workspaceId,
      OR: [
        ...(probe.dedupeKey ? [{ dedupeKey: probe.dedupeKey }] : []),
        ...(probe.domain ? [{ domain: probe.domain }] : []),
        ...(probe.website ? [{ website: probe.website }] : []),
        { name: probe.name },
        ...(probe.nameKey ? [{ nameKey: probe.nameKey }] : []),
      ],
    },
  });
  if (candidates.length === 0) return null;

  const byDedupe = candidates.find((c) => c.dedupeKey && c.dedupeKey === probe.dedupeKey);
  if (byDedupe) return byDedupe;

  const byDomain = candidates.find((c) => probe.domain && c.domain === probe.domain);
  if (byDomain) return byDomain;

  const byWebsite = candidates.find((c) => probe.website && c.website === probe.website);
  if (byWebsite) return byWebsite;

  const byExactName = candidates.find((c) => c.name === probe.name);
  if (byExactName) return byExactName;

  const city = normalizePlace(probe.city);
  const region = normalizePlace(probe.region);
  const compatible = candidates.filter((c) => {
    if (c.nameKey !== probe.nameKey) return false;
    if (city && normalizePlace(c.city) === city) return true;
    if (region && normalizePlace(c.region) === region) return true;
    if (probe.phoneNumber && c.phoneNumber === probe.phoneNumber) return true;
    // El candidato no tiene ubicación: no hay evidencia en contra.
    return !c.city && !c.region;
  });
  return compatible[0] ?? null;
}

/** ¿Es este error una violación de la restricción unique? */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Prioridad para gastar el presupuesto de resolución de contactos.
 *
 * Las reseñas de Google Maps son la mejor señal de demanda que tenemos; un
 * negocio con 80 reseñas y sin web es un lead mucho más caliente que uno que
 * sólo aparece en el BORME.
 */
function resolvePriority(business: DiscoveredBusiness): number {
  const reviews = Number(business.raw?.reviewCount ?? 0) || 0;
  let score = Math.min(reviews, 100) / 10;
  if (business.phoneNumber) score += 3;
  return score;
}

export async function upsertCompany(
  workspaceId: string,
  business: DiscoveredBusiness,
  extra?: Record<string, unknown>,
) {
  const domain = business.domain ?? normalizeDomain(business.website);
  const nameKey = normalizeNameKey(business.name);
  const dedupeKey = companyDedupeKey({
    source: business.source,
    sourceRef: business.sourceRef,
    domain,
    website: business.website,
    name: business.name,
  });
  const data = {
    name: business.name,
    nameKey,
    dedupeKey,
    domain,
    website: business.website,
    industry: (extra?.industry as string | undefined) ?? business.category ?? null,
    description: (extra?.description as string | undefined) ?? null,
    city: business.city,
    region: business.region,
    country: business.country ?? "ES",
    phoneNumber: normalizePhone(business.phoneNumber ?? "") ?? business.phoneNumber,
    size: (extra?.size as string | undefined) ?? null,
    employees: (extra?.employees as number | undefined) ?? null,
    source: business.source,
    sourceRef: business.sourceRef,
    tags: stringifyJson((extra?.tags as string[] | undefined) ?? [business.category].filter(Boolean) as string[]),
    enrichment: stringifyJson({
      ...asEnrichmentRecord(extra?.enrichment),
      ...(extra?.signals ? { signals: extra.signals } : {}),
    }),
  };

  const existing = await findCompanyCandidate(workspaceId, {
    dedupeKey,
    domain,
    website: business.website,
    name: business.name,
    nameKey,
    city: business.city,
    region: business.region,
    phoneNumber: data.phoneNumber,
  });

  if (existing) {
    // El enriquecimiento se MERGEA en dos niveles: si esta ejecución no ha
    // enriquecido el negocio (o no ha hecho crawling), no se pierde el equipo
    // ni las señales de una ejecución anterior.
    const previous = parseJson<Record<string, unknown>>(existing.enrichment, {});
    const fresh = parseJson<Record<string, unknown>>(data.enrichment, {});
    const merged = mergeEnrichment(previous, fresh);

    return prisma.company.update({
      where: { id: existing.id },
      data: {
        website: data.website ?? existing.website,
        phoneNumber: data.phoneNumber ?? existing.phoneNumber,
        city: data.city ?? existing.city,
        region: data.region ?? existing.region,
        description: data.description ?? existing.description,
        enrichment: stringifyJson(merged),
        lastSeenAt: new Date(),
        // Las claves se rellenan si la fila venida de antes no las tenía.
        ...(existing.dedupeKey ? {} : { dedupeKey: data.dedupeKey }),
        ...(existing.nameKey ? {} : { nameKey: data.nameKey }),
      },
    });
  }

  try {
    return await prisma.company.create({
      data: { workspaceId, ...data, lastSeenAt: new Date() },
    });
  } catch (error) {
    // Carrera entre dos pasadas: otra insertó la misma clave entre el find y
    // el create. Se recupera actualizando la fila existente.
    if (isUniqueViolation(error) && dedupeKey) {
      const raced = await prisma.company.findFirst({
        where: { workspaceId, dedupeKey },
      });
      if (raced) {
        return prisma.company.update({
          where: { id: raced.id },
          data: { lastSeenAt: new Date() },
        });
      }
    }
    throw error;
  }
}

export async function upsertLead(
  workspaceId: string,
  input: {
    companyId?: string | null;
    fullName?: string | null;
    jobTitle?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    linkedinUrl?: string | null;
    website?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    source: string;
    sourceRef?: string | null;
    enrichment?: Record<string, unknown>;
  },
) {
  const { firstName, lastName } = splitName(input.fullName);
  const email = input.email?.trim().toLowerCase() || null;
  const nameKey = normalizeNameKey(input.fullName);

  // Búsqueda determinista: primero la misma persona en la misma empresa,
  // después el mismo email y por último la referencia de origen.
  const existing =
    (input.companyId && input.fullName
      ? await prisma.lead.findFirst({
          where: {
            workspaceId,
            companyId: input.companyId,
            OR: [{ fullName: input.fullName }, ...(nameKey ? [{ nameKey }] : [])],
          },
        })
      : null) ??
    (email
      ? await prisma.lead.findFirst({ where: { workspaceId, email } })
      : null) ??
    (input.sourceRef
      ? await prisma.lead.findFirst({ where: { workspaceId, sourceRef: input.sourceRef } })
      : null);

  const payload = {
    companyId: input.companyId ?? null,
    fullName: input.fullName ?? null,
    nameKey,
    firstName,
    lastName,
    jobTitle: input.jobTitle ?? null,
    email,
    phoneNumber: input.phoneNumber ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    website: input.website ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    country: input.country ?? "ES",
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    enrichment: stringifyJson(input.enrichment ?? {}),
  };

  if (existing) {
    // Un email pertenece a un solo lead: si ya lo usa otro, no se pisa.
    const emailOwner = email
      ? await prisma.lead.findFirst({
          where: { workspaceId, email, NOT: { id: existing.id } },
        })
      : null;
    // El enriquecimiento también se mergea: una pasada nueva no borra lo que
    // ya se sabía del lead (emails hallados, señales, etc.).
    const previous = parseJson<Record<string, unknown>>(existing.enrichment, {});
    const fresh = parseJson<Record<string, unknown>>(payload.enrichment, {});
    const merged = mergeEnrichment(previous, fresh);
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        jobTitle: payload.jobTitle ?? existing.jobTitle,
        phoneNumber: payload.phoneNumber ?? existing.phoneNumber,
        linkedinUrl: payload.linkedinUrl ?? existing.linkedinUrl,
        email: emailOwner ? existing.email : (payload.email ?? existing.email),
        enrichment: stringifyJson(merged),
        status: existing.status === "new" ? "researched" : existing.status,
        lastSeenAt: new Date(),
        ...(existing.nameKey ? {} : { nameKey: payload.nameKey }),
      },
    });
  }

  return prisma.lead.create({
    data: { workspaceId, ...payload, lastSeenAt: new Date() },
  });
}

/**
 * Calcula el fit de un lead contra el ICP sin tocar la base de datos.
 * Sirve para previsualizar cambios de scoring antes de guardarlos.
 */
export async function computeLeadScore(
  workspaceId: string,
  leadId: string,
  criteria: IcpCriterion[],
) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { company: true },
  });
  if (!lead) return null;

  const enrichment = parseJson<Record<string, unknown>>(lead.enrichment, {});
  const companyEnrichment = lead.company
    ? parseJson<Record<string, unknown>>(lead.company.enrichment, {})
    : {};
  const signals = [
    ...(Array.isArray(enrichment.signals) ? (enrichment.signals as string[]) : []),
    ...(Array.isArray(companyEnrichment.signals) ? (companyEnrichment.signals as string[]) : []),
  ];

  const ctx = buildScoreContext({
    title: lead.jobTitle,
    email: lead.email,
    phoneNumber: lead.phoneNumber,
    linkedinUrl: lead.linkedinUrl,
    company: lead.company
      ? {
          name: lead.company.name,
          industry: lead.company.industry,
          city: lead.company.city,
          region: lead.company.region,
          employees: lead.company.employees,
          website: lead.company.website,
        }
      : null,
    enrichment: { ...enrichment, ...companyEnrichment, signals },
  });

  const result = scoreLead(ctx, criteria);
  const profile = detectProfile(ctx);
  return { ...result, profile };
}

export async function scoreAndSaveLead(
  workspaceId: string,
  leadId: string,
  criteria: IcpCriterion[],
) {
  const result = await computeLeadScore(workspaceId, leadId, criteria);
  if (!result) return null;

  await prisma.lead.update({
    where: { id: leadId },
    data: { score: result.score, scoreReason: result.reason, profile: result.profile },
  });
  return result;
}

export async function loadCriteria(workspaceId: string): Promise<IcpCriterion[]> {
  const playbook = await prisma.playbook.findUnique({ where: { workspaceId } });
  const custom = playbook ? criteriaFromPlaybook(playbook.icpCriteria) : [];
  return custom.length ? custom : defaultAgendaosCriteria();
}

export async function discoverProspects(opts: DiscoverOptions): Promise<DiscoverOutcome> {
  const warnings: string[] = [];
  const sources: string[] = [];
  let resolved = 0;

  // Fuente 1: búsqueda web real (MiniMax web_search). Aporta negocios con web,
  // email y teléfono, que es justo lo que se necesita para vender.
  let businesses: DiscoveredBusiness[] = [];
  let interpretation = "";
  try {
    const web = await findProspectsViaWeb({
      query: opts.query,
      limit: opts.limit ?? 40,
    });
    businesses = web.businesses;
    interpretation = web.interpretation;
    warnings.push(...web.warnings);
    if (web.businesses.length) sources.push("búsqueda web");
  } catch (err) {
    warnings.push(
      `La búsqueda web falló: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Fuente 2: BORME (complementaria). Aporta constituciones recientes de
  // empresas sanitarias que todavía no tienen web.
  // Fuente 3: Google Maps (opt-in). Aporta el censo de la cola larga.
  try {
    const discovery = await searchBusinesses({
      query: opts.query,
      location: opts.location,
      limit: Math.min(opts.limit ?? 40, 30),
      country: "ES",
      includeMaps: opts.includeMaps,
      minMapsReviews: opts.minMapsReviews,
    });
    warnings.push(...discovery.warnings);
    if (discovery.businesses.length) sources.push(discovery.provider);

    // Un negocio puede venir de varias fuentes: se agrupan para repartirlas.
    const bySource = new Map<string, DiscoveredBusiness[]>();
    for (const business of discovery.businesses) {
      const list = bySource.get(business.source) ?? [];
      list.push(business);
      bySource.set(business.source, list);
    }

    // Reparto equilibrado: si no, el corte final por `limit` se lo lleva todo
    // la búsqueda web y las constituciones del BORME nunca entran en la lista.
    businesses = interleaveBySource([
      { businesses, source: "web" },
      ...[...bySource.entries()].map(([source, list]) => ({
        businesses: list,
        source,
      })),
    ]);
    // Dedupe final entre fuentes: el mismo negocio puede haber salido de la
    // búsqueda web y de Maps con grafías distintas.
    businesses = dedupeBusinesses(businesses);
    if (!interpretation) interpretation = discovery.interpretation;
  } catch (err) {
    warnings.push(
      `El descubrimiento por registro falló: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  businesses = businesses.slice(0, opts.limit ?? 40);

  // Los negocios sin web (típico del BORME: sociedad recién constituida de la
  // que sólo sabemos el nombre) se buscan por nombre para encontrar su web y
  // su email. Sin este paso salían como nombres sin ningún canal de contacto.
  if (opts.resolveWithoutWebsite !== false) {
    const withoutWebsite = businesses.filter((b) => !b.website);
    const budget = opts.resolveLimit ?? 6;
    // Prioridad: primero los negocios con más demanda (reseñas de Maps) y con
    // teléfono; al final, los que sólo tienen nombre. Así el presupuesto de
    // resolución se gasta donde hay más probabilidad de cerrar.
    const queue = [...withoutWebsite]
      .sort((a, b) => resolvePriority(b) - resolvePriority(a))
      .slice(0, budget);

    // En paralelo (concurrencia 3): cada resolución son 1-2 búsquedas web.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length) {
        const business = queue[cursor];
        cursor += 1;
        if (!business) continue;
        try {
          const contact = await resolveBusinessContact({
            name: business.name,
            city: business.city,
            region: business.region,
            category: business.category,
            address: (business.address ?? (business.raw?.domicilio as string | undefined)) ?? null,
            activity: (business.raw?.objetoSocial as string | undefined) ?? null,
            professionals: Array.isArray(business.raw?.profesionales)
              ? (business.raw?.profesionales as string[])
              : [],
          });
          if (!contact.website && !contact.email && !contact.phone) continue;
          business.website = contact.website;
          business.domain = business.domain ?? (contact.website ? domainFromUrl(contact.website) : null);
          business.phoneNumber = business.phoneNumber ?? contact.phone;
          business.raw = {
            ...business.raw,
            resolvedContact: true,
            resolvedEmail: contact.email,
            contactName: contact.contactName,
            jobTitle: contact.jobTitle,
            address: contact.address,
            signals: [
              ...new Set([
                ...((business.raw?.signals as string[] | undefined) ?? []),
                ...contact.signals,
              ]),
            ],
          };
          resolved += 1;
        } catch (err) {
          warnings.push(
            `No se pudo buscar el contacto de ${business.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    await Promise.all([worker(), worker(), worker()]);
  }
  const result = {
    businesses,
    interpretation: `${businesses.length} negocios encontrados. ${interpretation}${
      sources.length ? ` Fuentes: ${sources.join(" + ")}.` : ""
    }`,
    warnings,
    sources,
    provider: sources.join("+") || "ninguna",
  };

  const criteria = opts.criteria ?? (await loadCriteria(opts.workspaceId));
  const enrichLimit = opts.enrichLimit ?? Math.min(result.businesses.length, 20);
  const leadIds: string[] = [];
  let enriched = 0;
  let companies = 0;
  let websitesEnriched = 0;
  let businessesWithLead = 0;

  for (const business of result.businesses) {
    // Los negocios resueltos por web (sin web previa) siempre se enriquecen:
    // su web es la única vía para sacar el email. El presupuesto de
    // enriquecimiento se gasta sólo en negocios CON web: si no, se consumía
    // en sociedades sin web y se quedaban sin ningún contacto.
    const resolvedFlag = business.raw?.resolvedContact === true;
    const hasWebsite = Boolean(business.website);
    const shouldEnrich = resolvedFlag || (hasWebsite && websitesEnriched < enrichLimit);
    if (shouldEnrich && hasWebsite && !resolvedFlag) websitesEnriched += 1;
    let enrichment: Record<string, unknown> = {};
    let contacts: { name: string; role: string | null }[] = [];
    let foundEmails: string[] = [];
    let foundPhones: string[] = [];
    let description: string | null = null;
    let emailSource: string | null = null;
    let emailConfidence = 0;

    if (shouldEnrich && business.website) {
      try {
        const crawled = await enrichBusiness(business);
        enrichment = {
          signals: crawled.signals,
          contactPageUrl: crawled.website?.contactPageUrl ?? null,
          teamMembers: crawled.contacts.map((c) => ({ name: c.name, role: c.role })),
          description: crawled.company?.description ?? crawled.website?.description ?? null,
          address: crawled.company?.address ?? null,
          city: crawled.company?.city ?? null,
        };
        contacts = crawled.contacts.map((c) => ({
          name: c.name ?? business.name,
          role: c.role,
        }));
        foundEmails = (crawled.emails ?? []).map((e) => e.email);
        foundPhones = crawled.website?.phoneNumbers ?? [];
        description = crawled.company?.description ?? crawled.website?.description ?? null;
        enriched += 1;
      } catch (err) {
        warnings.push(
          `No se pudo enriquecer ${business.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Candidatos a lead. Prioridad: el dueño (si el negocio lleva su nombre),
    // el contacto que devolvió la búsqueda web y, después, el equipo de la web.
    const webRole =
      typeof business.raw?.jobTitle === "string" && business.raw.jobTitle.trim()
        ? business.raw.jobTitle.trim()
        : null;
    const webContact =
      typeof business.raw?.contactName === "string" && business.raw.contactName.trim().length > 2
        ? business.raw.contactName.trim()
        : null;
    const owner = personFromBusinessName(business.name);
    const picked = pickContacts(
      business,
      contacts.map((c) => ({ name: c.name, role: c.role })),
    );

    const candidates = [
      ...(owner ? [{ name: owner, role: webRole }] : []),
      ...(webContact ? [{ name: webContact, role: webRole }] : []),
      ...picked,
    ].filter((c) => c.name && normalizeNameKey(c.name) !== normalizeNameKey(business.name));

    const seenPeople = new Set<string>();
    const people: { name: string; role: string | null }[] = [];
    for (const candidate of candidates) {
      const key = normalizeNameKey(candidate.name);
      if (!key || seenPeople.has(key)) continue;
      seenPeople.add(key);
      people.push(candidate);
      if (people.length >= MAX_LEADS_PER_BUSINESS) break;
    }
    // Sin ninguna persona identificada, el lead es el propio negocio.
    if (!people.length) people.push({ name: business.name, role: "Contacto" });

    // Si el negocio lleva el nombre de su profesional ("Fisioterapia Barón",
    // "Clínica de Fisioterapia Alba Vidal"), es una consulta privada: un
    // autónomo con su nombre y apellido en la puerta.
    const businessKey = normalizeNameKey(business.name);
    const ownerSurname = normalizeNameKey(
      (people[0]?.name ?? "").split(/\s+/).slice(-1)[0] ?? "",
    );
    const namedAfterProfessional =
      ownerSurname.length >= 4 && businessKey.includes(ownerSurname);
    const extraSignals = namedAfterProfessional
      ? ["Consulta privada: el negocio lleva el nombre de su profesional"]
      : [];

    const company = await upsertCompany(opts.workspaceId, business, {
      description,
      signals: [...((enrichment.signals as string[] | undefined) ?? []), ...extraSignals],
      enrichment: {
        ...enrichment,
        signals: [...((enrichment.signals as string[] | undefined) ?? []), ...extraSignals],
        contactName: business.raw?.contactName ?? null,
        jobTitle: business.raw?.jobTitle ?? null,
        address: business.address ?? null,
        // Los datos de la fuente se guardan bajo su propio namespace para que
        // no se mezclen con los del crawl (y para poder refrescarlos solos).
        ...(business.source === "maps" ? { maps: business.raw } : {}),
      },
    });
    companies += 1;

    const webEmail =
      typeof business.raw?.email === "string" && business.raw.email.includes("@")
        ? (business.raw.email as string).toLowerCase()
        : null;

    // Un email no se puede asignar a dos personas del mismo negocio.
    const usedEmails = new Set<string>();
    let businessHasLead = false;

    for (const [personIndex, person] of people.entries()) {
      const isPrimary = personIndex === 0;
      const domain = business.domain ?? normalizeDomain(business.website);
      let email: string | null = null;

      if (domain && shouldEnrich) {
        try {
          const candidates = await findEmails({
            domain,
            fullName: person.name,
            website: business.website,
            knownEmails: foundEmails,
          });
          const verified = await verifyEmails(candidates, { max: 6 });
          // El email genérico (info@, hola@) sólo se asigna al contacto
          // principal: el resto necesita un email personal.
          const usable = verified.filter(
            (v) => v.status !== "invalid" && v.status !== "risky",
          );
          const best = usable.find((v) => !isGenericEmail(v.email)) ??
            (isPrimary ? usable[0] : undefined);
          email = best?.email ?? null;
          emailSource = best?.candidate?.source ?? null;
          emailConfidence = best?.candidate?.confidence ?? 0;
          // Si el SMTP no confirma nada, se usa el email que apareció en la web.
          if (!email && isPrimary && webEmail) {
            email = webEmail;
            emailSource = "web";
            emailConfidence = 70;
          }
        } catch (err) {
          warnings.push(
            `Falló la búsqueda de email para ${person.name}@${domain}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (email && usedEmails.has(email)) continue;
      if (email) usedEmails.add(email);

      // El contacto principal se queda con el email genérico de la empresa.
      // Los demás sólo si tienen email propio: si comparten el teléfono y el
      // info@ de la empresa, no aportan nada (suelen ser testimonios).
      const ownEmail = email && !isGenericEmail(email) ? email : null;
      if (!isPrimary && !ownEmail) continue;

      const leadPhone =
        normalizePhone(foundPhones[0] ?? business.phoneNumber ?? "") ?? null;
      // Sin email ni teléfono el lead no se puede contactar: no aporta.
      if (!email && !leadPhone) continue;

      const lead = await upsertLead(opts.workspaceId, {
        companyId: company.id,
        fullName: person.name,
        jobTitle: person.role,
        email,
        phoneNumber: leadPhone,
        website: business.website,
        city: business.city,
        region: business.region,
        country: business.country,
        source: business.source,
        sourceRef: `${business.sourceRef}#${person.name}`,
        enrichment: {
          ...enrichment,
          domain,
          webEmail,
          usesExternalBooking:
            (enrichment.signals as string[] | undefined)?.some((s) =>
              /calendly|agenda|booking|reserv/i.test(s),
            ) ?? false,
        },
      });

      if (email) {
        await prisma.leadEmail.deleteMany({ where: { leadId: lead.id, email } });
        await prisma.leadEmail.create({
          data: {
            leadId: lead.id,
            email,
            source: emailSource ?? "web",
            status: "verified",
            confidence: emailConfidence || 80,
            verifiedAt: new Date(),
          },
        });
      }

      await scoreAndSaveLead(opts.workspaceId, lead.id, criteria);
      leadIds.push(lead.id);
      if (!businessHasLead) {
        businessHasLead = true;
        businessesWithLead += 1;
      }

      if (opts.listId) {
        await prisma.listItem.upsert({
          where: { listId_leadId: { listId: opts.listId, leadId: lead.id } },
          update: {},
          create: { listId: opts.listId, leadId: lead.id, score: lead.score },
        });
      }
    }
  }

  await logActivity(opts.workspaceId, "finder.search", opts.query, {
    found: result.businesses.length,
    leads: leadIds.length,
    enriched,
  });

  const sinContacto = result.businesses.length - businessesWithLead;
  if (sinContacto > 0) {
    warnings.push(
      `${sinContacto} negocios se guardaron sin email ni teléfono: no se pueden contactar todavía. Sube el límite de enriquecimiento para analizar más webs.`,
    );
  }

  return {
    interpretation: result.interpretation,
    warnings,
    sources: result.sources,
    found: result.businesses.length,
    companies,
    leads: leadIds.length,
    enriched,
    resolved,
    leadIds,
  };
}
