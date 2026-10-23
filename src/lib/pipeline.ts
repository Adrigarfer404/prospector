import { prisma } from "./db";
import { logActivity } from "./workspace";
import { buildScoreContext, defaultAgendaosCriteria, detectProfile, scoreLead } from "./scoring";
import { parseJson, stringifyJson, type IcpCriterion } from "./types";
import { criteriaFromPlaybook } from "./messages";
import { searchBusinesses } from "./providers/discovery";
import { enrichBusiness, findEmails, normalizePhone, personFromBusinessName, stripAccents, verifyEmails } from "./providers/enrichment";
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
  radiusKm?: number;
  limit?: number;
  /** Cuántos negocios enriquecer (crawl de web + emails). El resto solo se guarda. */
  enrichLimit?: number;
  listId?: string | null;
  criteria?: IcpCriterion[] | null;
  /** Cuántos negocios sin web se buscan por nombre para hallar su contacto. */
  resolveLimit?: number;
  /** Permite desactivar ese paso (resolveWithoutWebsite: false). */
  resolveWithoutWebsite?: boolean;
};

export type DiscoverOutcome = {
  interpretation: string;
  warnings: string[];
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
function normalizeNameKey(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(sl|slu|sa|sau|sc|cb|s l|s a|sociedad limitada|sociedad anonima)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

export async function upsertCompany(
  workspaceId: string,
  business: DiscoveredBusiness,
  extra?: Record<string, unknown>,
) {
  const domain = business.domain ?? normalizeDomain(business.website);
  const data = {
    name: business.name,
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
    enrichment: stringifyJson({ ...parseJson<Record<string, unknown>>((extra?.enrichment as string) ?? "{}", {}), ...(extra?.signals ? { signals: extra.signals } : {}) }),
  };

  const existing = await prisma.company.findFirst({
    where: {
      workspaceId,
      OR: [
        ...(domain ? [{ domain }] : []),
        ...(business.website ? [{ website: business.website }] : []),
        { name: business.name },
      ],
    },
  });

  if (existing) {
    // El enriquecimiento se MERGEA: si esta ejecución no ha enriquecido el
    // negocio (o no ha crawling), no se pierde el equipo ni las señales que
    // se detectaron en una ejecución anterior.
    const previous = parseJson<Record<string, unknown>>(existing.enrichment, {});
    const fresh = parseJson<Record<string, unknown>>(data.enrichment, {});
    const previousSignals = Array.isArray(previous.signals)
      ? (previous.signals as string[])
      : [];
    const freshSignals = Array.isArray(fresh.signals) ? (fresh.signals as string[]) : [];
    const merged: Record<string, unknown> = { ...previous, ...fresh };
    merged.signals = [...new Set([...previousSignals, ...freshSignals])];

    return prisma.company.update({
      where: { id: existing.id },
      data: {
        website: data.website ?? existing.website,
        phoneNumber: data.phoneNumber ?? existing.phoneNumber,
        city: data.city ?? existing.city,
        region: data.region ?? existing.region,
        description: data.description ?? existing.description,
        enrichment: stringifyJson(merged),
      },
    });
  }

  return prisma.company.create({ data: { workspaceId, ...data } });
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

  // Búsqueda determinista: primero la misma persona en la misma empresa,
  // después el mismo email y por último la referencia de origen.
  const existing =
    (input.companyId && input.fullName
      ? await prisma.lead.findFirst({
          where: { workspaceId, companyId: input.companyId, fullName: input.fullName },
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
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        jobTitle: payload.jobTitle ?? existing.jobTitle,
        phoneNumber: payload.phoneNumber ?? existing.phoneNumber,
        linkedinUrl: payload.linkedinUrl ?? existing.linkedinUrl,
        email: emailOwner ? existing.email : (payload.email ?? existing.email),
        enrichment: payload.enrichment,
        status: existing.status === "new" ? "researched" : existing.status,
      },
    });
  }

  return prisma.lead.create({ data: { workspaceId, ...payload } });
}

export async function scoreAndSaveLead(
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
  await prisma.lead.update({
    where: { id: leadId },
    data: { score: result.score, scoreReason: result.reason, profile },
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

  // Fuente 2: OpenStreetMap + Nominatim + BORME (complementaria).
  try {
    const osm = await searchBusinesses({
      query: opts.query,
      location: opts.location,
      radiusKm: opts.radiusKm ?? 15,
      limit: Math.min(opts.limit ?? 40, 30),
      country: "ES",
    });
    warnings.push(...osm.warnings);
    if (osm.businesses.length) sources.push("OpenStreetMap/BORME");
    const known = new Set(businesses.map((b) => `${b.name}|${b.domain ?? ""}`));
    const extra: DiscoveredBusiness[] = [];
    for (const business of osm.businesses) {
      const key = `${business.name}|${business.domain ?? ""}`;
      if (known.has(key)) continue;
      known.add(key);
      extra.push(business);
    }
    // Reparto equilibrado: si no, el corte final por `limit` se lo lleva todo
    // la búsqueda web y las constituciones del BORME nunca entran en la lista.
    businesses = interleaveBySource([
      { businesses, source: "web" },
      { businesses: extra.filter((b) => b.source === "osm"), source: "osm" },
      { businesses: extra.filter((b) => b.source === "nominatim"), source: "nominatim" },
      { businesses: extra.filter((b) => b.source === "borme"), source: "borme" },
    ]);
    if (!interpretation) interpretation = osm.interpretation;
  } catch (err) {
    warnings.push(
      `OpenStreetMap/BORME falló: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  businesses = businesses.slice(0, opts.limit ?? 40);

  // Los negocios sin web (típico del BORME: sociedad recién constituida de la
  // que sólo sabemos el nombre) se buscan por nombre para encontrar su web y
  // su email. Sin este paso salían como nombres sin ningún canal de contacto.
  if (opts.resolveWithoutWebsite !== false) {
    const withoutWebsite = businesses.filter((b) => !b.website);
    const budget = opts.resolveLimit ?? 6;
    const queue = withoutWebsite.slice(0, budget);

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
    found: result.businesses.length,
    companies,
    leads: leadIds.length,
    enriched,
    resolved,
    leadIds,
  };
}
