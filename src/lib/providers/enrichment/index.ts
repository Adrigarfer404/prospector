/**
 * Agregadores de enriquecimiento: decisión de enriquecimiento, búsqueda de
 * emails y verificación en paralelo.
 */

import type {
  DiscoveredBusiness,
  EmailCandidate,
  EmailVerifyResult,
  WebsiteContactResult,
} from "../contract";
import { emailProvider, normalizeDomain } from "./email";
import { hasHunterKey, hunterDomainSearch } from "./hunter";
import { crawlWebsite, isPlausibleContactEmail } from "./website";

export { discoverEmailsByPattern, emailProvider, normalizeDomain, verifyEmail } from "./email";
export { hunterEmailProvider, hasHunterKey } from "./hunter";
export {
  crawlWebsite,
  isPlausibleContactEmail,
  normalizePhone,
  personFromBusinessName,
  stripAccents,
  websiteCrawler,
} from "./website";

export type EnrichedContact = {
  name: string | null;
  role: string | null;
  email: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
};

export type EnrichedCompany = {
  name: string;
  website: string | null;
  domain: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  employees: number | null;
  tags: string[];
};

export type EnrichedBusiness = {
  business: DiscoveredBusiness;
  company: EnrichedCompany | null;
  contacts: EnrichedContact[];
  emails: EmailCandidate[];
  signals: string[];
  website: WebsiteContactResult | null;
  /** true si no se pudo/convino hacer crawl. */
  skipped: boolean;
  skipReason: string | null;
};

export type EnrichBusinessOptions = {
  /** Fuerza el crawl aunque no haya website. */
  force?: boolean;
  /** Dominio alternativo si el negocio no trae website. */
  domain?: string | null;
};

/**
 * Enriquece un negocio: decide si merece la pena hacer crawler y devuelve
 * datos de empresa, contactos y señales.
 */
export async function enrichBusiness(
  business: DiscoveredBusiness,
  options: EnrichBusinessOptions = {},
): Promise<EnrichedBusiness> {
  const signals: string[] = [];
  const website = business.website ?? null;
  const domain = business.domain ?? normalizeDomain(options.domain ?? "") ?? null;

  let crawl: WebsiteContactResult | null = null;

  if (!website) {
    signals.push("Sin web: necesita presencia digital y agenda online");
  } else if (options.force !== false) {
    crawl = await crawlWebsite(website);
    signals.push(...crawl.signals);
  }

  const contacts: EnrichedContact[] = [];

  if (crawl) {
    const usedEmails = new Set<string>();
    for (const member of crawl.teamMembers) {
      // Asocia el email cuyo local part coincide con el nombre del profesional.
      const nameTokens = member.name
        .toLowerCase()
        .split(/\s+/)
        .map((part) => part.replace(/[^a-z]/g, ""))
        .filter((part) => part.length > 2);

      const matching = crawl.emails.find((email) => {
        const local = (email.split("@")[0] ?? "").replace(/[^a-z]/g, "").toLowerCase();
        return nameTokens.some((token) => local.includes(token));
      });

      // Si sólo hay un email en la web, es el contacto del negocio: se asigna
      // al primer contacto sin coincidencia. Con varios emails no se inventa
      // una asociación (el email queda en el listado de la empresa).
      const fallback =
        crawl.emails.length === 1 && !usedEmails.has(crawl.emails[0] ?? "")
          ? crawl.emails[0]
          : undefined;
      const email = matching ?? fallback ?? null;
      if (email) usedEmails.add(email);

      contacts.push({
        name: member.name,
        role: member.role,
        email,
        phoneNumber: crawl.phoneNumbers[0] ?? business.phoneNumber,
        linkedinUrl: null,
      });
    }
    if (crawl.emails.length === 0 && crawl.phoneNumbers.length === 0) {
      signals.push("La web no expone email ni teléfono de contacto");
    }
  }

  const company: EnrichedCompany | null = crawl
    ? {
        name: business.name,
        website: crawl.website ?? website,
        domain: crawl.domain ?? domain,
        description: crawl.description,
        address: crawl.address ?? business.address,
        city: crawl.city ?? business.city,
        region: crawl.region ?? business.region,
        industry: business.category,
        employees: null,
        tags: [...(business.category ? [business.category] : []), ...crawl.signals.slice(0, 2)],
      }
    : {
        name: business.name,
        website,
        domain,
        description: null,
        address: business.address,
        city: business.city,
        region: business.region,
        industry: business.category,
        employees: null,
        tags: business.category ? [business.category] : [],
      };

  const emails = domain
    ? await findEmails({
        domain,
        website,
        knownEmails: crawl?.emails ?? [],
      })
    : [];

  return {
    business,
    company,
    contacts,
    emails,
    signals,
    website: crawl,
    skipped: !crawl,
    skipReason: crawl ? null : website ? "crawl no ejecutado" : "sin web",
  };
}

export type FindEmailsInput = {
  domain: string;
  fullName?: string | null;
  website?: string | null;
  knownEmails?: string[];
  teamMembers?: { name: string; role: string | null }[];
};

/**
 * Combina Hunter (si hay key) + emails encontrados en la web + patrón.
 * Ordena por confidence descendente.
 */
export async function findEmails(input: FindEmailsInput): Promise<EmailCandidate[]> {
  const domain = normalizeDomain(input.domain);
  if (!domain) return [];

  const byEmail = new Map<string, EmailCandidate>();
  const add = (candidate: EmailCandidate): void => {
    const existing = byEmail.get(candidate.email);
    if (!existing || candidate.confidence > existing.confidence) {
      byEmail.set(candidate.email, candidate);
    }
  };

  // 1) Emails reales encontrados en la web (confianza máxima).
  const knownEmails = new Set(
    (input.knownEmails ?? [])
      .map((email) => email.toLowerCase())
      .filter((email) => isPlausibleContactEmail(email)),
  );
  for (const email of knownEmails) {
    add({ email, source: "web", confidence: 95 });
  }

  // 2) Hunter (opcional).
  if (hasHunterKey()) {
    const hunter = await hunterDomainSearch(domain);
    for (const candidate of hunter.candidates) add(candidate);
  }

  // 3) Patrón sobre el dominio.
  const pattern = await emailProvider.discover({
    domain,
    fullName: input.fullName ?? null,
    website: input.website ?? null,
    knownEmails: [...knownEmails],
  });
  for (const candidate of pattern) add(candidate);

  return [...byEmail.values()].sort((a, b) => b.confidence - a.confidence);
}

export type VerifiedEmail = EmailVerifyResult & { candidate: EmailCandidate };

/**
 * Verifica varios emails en paralelo (concurrencia máxima 4) y devuelve los
 * candidatos válidos ordenados por confianza.
 */
export async function verifyEmails(
  emails: EmailCandidate[],
  options: { concurrency?: number; max?: number } = {},
): Promise<VerifiedEmail[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const max = options.max ?? emails.length;
  const queue = emails.slice(0, max);
  const results: VerifiedEmail[] = [];

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const candidate = queue[index];
      if (!candidate) continue;
      const result = await emailProvider.verify(candidate.email);
      results.push({ ...result, candidate });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  const order = { verified: 0, catch_all: 1, unverified: 2, risky: 3, invalid: 4 } as const;
  return results.sort((a, b) => {
    const byStatus = order[a.status] - order[b.status];
    if (byStatus !== 0) return byStatus;
    return b.confidence - a.confidence;
  });
}
