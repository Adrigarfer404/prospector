import { completeJson, webSearch, type WebSearchHit } from "../ai";
import type { DiscoveredBusiness } from "./contract";
import { SERVICE_STOPWORDS } from "./enrichment/website";

/**
 * AI Finder respaldado por búsqueda web real.
 *
 * Flujo: consulta en lenguaje natural -> MiniMax ejecuta búsquedas web con su
 * server-side tool `web_search` -> se fusionan los resultados -> el modelo
 * extrae prospectos estructurados (nombre, web, email, teléfono, dirección) ->
 * el pipeline verifica y enriquece esos datos contra la web del negocio.
 *
 * Esto es lo que hace que la app encuentre empresas de verdad y no mocks.
 */

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "wikipedia.org",
  "amazon.es",
  "google.com",
  "maps.google",
  "booking.com",
  "tripadvisor",
  "idealista",
  "einforma",
  "axesor",
  "infocif",
  "einforma.com",
];

/** Directorios que además aportan datos de contacto: valen la pena crawlear. */
const DIRECTORY_HOSTS = [
  "empresite.eleconomista.es",
  "doctoralia.es",
  "fresha.com",
  "doctory.es",
  "operarme.es",
  "milunet.com",
  "starbusinesses.com",
  "informacion-empresas.com",
  "einforma.com",
  "axesor.es",
];

export function isDirectoryUrl(url: string): boolean {
  return DIRECTORY_HOSTS.some((host) => url.includes(host));
}

export function isSocialUrl(url: string): boolean {
  return SOCIAL_HOSTS.some((host) => url.includes(host));
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

type ParsedQuery = {
  sector: string;
  location: string;
  categoryHint: string | null;
};

const SECTOR_HINTS: { match: RegExp; sector: string; category: string }[] = [
  { match: /fisioter|physio/i, sector: "fisioterapia", category: "physiotherapist" },
  { match: /nutricion|dietet|nutrition/i, sector: "nutrición", category: "nutritionist" },
  { match: /psicolog|psycholog/i, sector: "psicología", category: "psychologist" },
  { match: /odontolog|dentist|dental/i, sector: "odontología", category: "dentist" },
  { match: /osteopat/i, sector: "osteopatía", category: "osteopath" },
  { match: /logoped|speech/i, sector: "logopedia", category: "logopedist" },
  { match: /podolog|podiatr/i, sector: "podología", category: "podiatrist" },
  { match: /entrenador|fitness|gimnasio/i, sector: "entrenamiento personal", category: "fitness_centre" },
  { match: /yoga|pilates/i, sector: "yoga y pilates", category: "yoga_centre" },
  { match: /estetic|medicina estetica/i, sector: "medicina estética", category: "beauty" },
  { match: /medico|medicina|clinic|consulta/i, sector: "consulta médica", category: "clinic" },
];

const CITY_HINTS = [
  "Madrid",
  "Barcelona",
  "Valencia",
  "Sevilla",
  "Zaragoza",
  "Bilbao",
  "Vitoria",
  "A Coruña",
  "Pamplona",
  "Santander",
  "Córdoba",
  "Vigo",
  "Gijón",
  "Tarragona",
  "Lleida",
  "Toledo",
  "Cádiz",
  "Huelva",
  "Burgos",
  "Albacete",
  "Ourense",
  "Girona",
  "Málaga",
  "Palma",
  "Granada",
  "Valladolid",
  "Las Palmas",
  "Murcia",
  "Alicante",
  "Móstoles",
  "Alcorcón",
  "Getxo",
  "Castellón",
  "Cáceres",
  "Jaén",
  "Logroño",
  "Salamanca",
  "León",
  "Oviedo",
  "Santander",
  "Pamplona",
  "Badajoz",
  "Ávila",
  "Ciudad Real",
  "Huesca",
  "Teruel",
  "Melilla",
  "Ceuta",
];

export function parseQuery(query: string): ParsedQuery {
  const hint = SECTOR_HINTS.find((h) => h.match.test(query));
  const city =
    CITY_HINTS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(query)) ??
    query.match(/\ben ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ ]{2,25})/)?.[1] ??
    null;

  return {
    sector: hint?.sector ?? (query.split(/\ben\b|\bin\b|\bnear\b/i)[0].trim() || query),
    location: city ?? "España",
    categoryHint: hint?.category ?? null,
  };
}

function buildSearchPrompts(parsed: ParsedQuery, limit: number): string[] {
  const { sector, location } = parsed;
  return [
    `Busca en la web PROFESIONALES AUTÓNOMOS E INDEPENDIENTES reales de ${sector} en ${location}: gente que trabaja por su cuenta, con consulta propia o a domicilio. Necesito únicamente los que tengan sitio web propio. Para cada uno: nombre, URL de su web, email de contacto, teléfono, dirección y ciudad. EXCLUYE cadenas, franquicias, policlínicas, centros con varias sedes y las grandes empresas de sanidad. Cita las URLs reales.`,
    `Busca ${sector} en ${location} en directorios de profesionales independientes (doctoralia, frescura, milunet, empresite) y en webs de consulta privada. Extrae nombre del profesional o de su consulta, teléfono, dirección y web. Prioriza quien atiende por su cuenta.`,
    `Busca "${sector} ${location} a domicilio" y "${sector} consulta privada ${location}" email contacto teléfono web oficial. Necesito profesionales independientes con su propia web y email.`,
  ].slice(0, Math.max(2, Math.min(3, Math.ceil(limit / 8))));
}

export type FinderOptions = {
  query: string;
  limit?: number;
  model?: string;
  /** Timeout por búsqueda web. */
  timeoutMs?: number;
};

export type FinderResult = {
  businesses: DiscoveredBusiness[];
  interpretation: string;
  warnings: string[];
  searchQueries: string[];
  hits: WebSearchHit[];
};

const EXTRACTION_SYSTEM = `Eres un analista de prospección B2B. Recibles resultados de búsqueda web y debes extraer los NEGOCIOS REALES que aparecen.
Reglas:
- Sólo incluye negocios que aparezcan explícitamente en los resultados (nombre + web o teléfono o email). NUNCA inventes datos.
- Si no hay email en el snippet, deja email a null (se verificará luego).
- EXCLUYE cadenas, franquicias, policlínicas, multicentros, hospitales y centros públicos: sólo profesionales autónomos e independientes que trabajan por su cuenta (consulta propia, a domicilio, un solo profesional).
- Si un negocio tiene varios profesionales en el equipo o varias sedes, queda fuera.
- El campo website debe ser la URL de la web del negocio (no un directorio, no una red social, no un portal de citas).
- Añade signals con pistas útiles para vender software de agenda online: si usan Calendly/Doctoralia/Fresha/Bookeo/Simplybook, si tienen "pedir cita", "reserva", "agenda online" en la web.
Responde SOLO con JSON válido.`;

type ExtractedProspect = {
  name?: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  contactName?: string | null;
  jobTitle?: string | null;
  linkedinUrl?: string | null;
  usesExternalBooking?: boolean;
  signals?: string[];
  notes?: string | null;
};

export async function findProspectsViaWeb(opts: FinderOptions): Promise<FinderResult> {
  const limit = opts.limit ?? 25;
  const parsed = parseQuery(opts.query);
  const prompts = buildSearchPrompts(parsed, limit);
  const warnings: string[] = [];

  // Las búsquedas web se lanzan en serie: en paralelo la API da 500 por carga.
  const hits: WebSearchHit[] = [];
  const seenUrls = new Set<string>();
  for (const prompt of prompts) {
    try {
      const search = await webSearch(prompt, {
        model: opts.model,
        timeoutMs: opts.timeoutMs ?? 180_000,
        maxRounds: 2,
      });
      for (const hit of search.hits) {
        const url = hit.url ?? "";
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        hits.push(hit);
      }
    } catch (err) {
      warnings.push(
        `Búsqueda fallida ("${prompt.slice(0, 40)}…"): ${err instanceof Error ? err.message : String(err)}${err instanceof Error && err.stack ? "\n" + err.stack.split("\n").slice(0,4).join("\n") : ""}`,
      );
    }
  }

  if (hits.length === 0) {
    return {
      businesses: [],
      interpretation: `No se han podido obtener resultados web para "${opts.query}".`,
      warnings: [
        ...warnings,
        "El motor de búsqueda no devolvió resultados. Revisa la conexión o prueba con otra consulta.",
      ],
      searchQueries: prompts,
      hits: [],
    };
  }

  const context = hits
    .slice(0, 60)
    .map(
      (hit, index) =>
        `[${index + 1}] ${hit.title ?? "sin título"}\nURL: ${hit.url ?? ""}\n${(hit.content ?? "").slice(0, 700)}`,
    )
    .join("\n\n---\n\n");

  // La extracción es el punto frágil: si el modelo devuelve un JSON cortado o
  // una lista vacía, la búsqueda entera se pierde. Se reintenta hasta tres
  // veces, recortando el contexto y pidiendo menos campos.
  const extractionPrompt = (attempt: number) =>
    `Búsqueda: "${opts.query}" (sector: ${parsed.sector}, lugar: ${parsed.location}).
Extrae hasta ${Math.max(10, limit)} negocios reales de ${parsed.sector} en ${parsed.location}.

RESULTADOS DE BÚSQUEDA:
${context}

Responde con este JSON exacto:
{"prospects":[{"name":"","website":null,"email":null,"phone":null,"address":null,"city":null,"region":null,"contactName":null,"jobTitle":null,"linkedinUrl":null,"usesExternalBooking":false,"signals":[],"notes":null}]}

IMPORTANTE: omite los campos que no tengas dato (no los pongas a null) y no
añadas texto fuera del JSON.${attempt > 0 ? " Devuelve al menos 5 negocios con name y website." : ""}`;

  let prospects: ExtractedProspect[] = [];
  for (let attempt = 1; attempt <= 3 && prospects.length === 0; attempt += 1) {
    try {
      const extraction = await completeJson<{ prospects?: ExtractedProspect[] }>(
        extractionPrompt(attempt),
        { system: EXTRACTION_SYSTEM, maxTokens: 8000, temperature: 0.1 },
      );
      prospects = extraction?.prospects ?? [];
    } catch (err) {
      warnings.push(
        `La extracción falló (intento ${attempt}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (prospects.length === 0 && attempt < 3) {
      warnings.push(`La extracción no devolvió negocios (intento ${attempt}); se reintenta.`);
    }
  }

  const businesses: DiscoveredBusiness[] = [];

  for (const [index, prospect] of prospects.entries()) {
    const name = (prospect.name ?? "").trim();
    if (!name) continue;
    // Un nombre formado sólo por servicios ("Suelo Pélvico", "Punción Seca")
    // no es una empresa: se descarta. Pero "Fisioterapia Puerta del Sol" SÍ es
    // una empresa, así que sólo se descarta si TODAS sus palabras son
    // términos de servicio. Antes se perdían casi todos los negocios del
    // sector, porque su nombre lleva la palabra clave de la búsqueda.
    const nameWords = name
      .toLowerCase()
      .replace(/[.,]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    // Un nombre de una sola palabra ("Bartolomé") no identifica a un negocio.
    if (nameWords.length < 2) continue;
    if (nameWords.every((word) => SERVICE_STOPWORDS.includes(word))) continue;
    const website = prospect.website ? normalizeUrl(prospect.website) : null;
    const domain = website ? domainOf(website) : null;
    const signals = Array.isArray(prospect.signals) ? prospect.signals.slice(0, 6) : [];
    if (prospect.usesExternalBooking && !signals.some((s) => /agenda|cita|booking|reserv/i.test(s))) {
      signals.push("Usa un sistema de reservas o cita previa");
    }

    businesses.push({
      sourceRef: `web/${domain ?? slugify(name)}/${index}`,
      source: "web",
      name,
      website,
      domain,
      phoneNumber: prospect.phone ?? null,
      city: prospect.city ?? parsed.location,
      region: prospect.region ?? null,
      country: "ES",
      latitude: null,
      longitude: null,
      category: parsed.categoryHint,
      address: prospect.address ?? null,
      raw: {
        contactName: prospect.contactName ?? null,
        jobTitle: prospect.jobTitle ?? null,
        linkedinUrl: prospect.linkedinUrl ?? null,
        email: prospect.email ?? null,
        notes: prospect.notes ?? null,
        usesExternalBooking: Boolean(prospect.usesExternalBooking),
        signals,
        hitUrl: website,
      },
    });
  }

  return {
    businesses,
    interpretation: `${businesses.length} negocios de ${parsed.sector} en ${parsed.location} encontrados con ${hits.length} resultados web revisados (el BORME se añade como fuente complementaria).`,
    warnings,
    searchQueries: prompts,
    hits,
  };
}

function normalizeUrl(url: string): string | null {
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    const parsed = new URL(withProtocol);
    if (parsed.hostname.includes("facebook") || parsed.hostname.includes("instagram")) return null;
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`.replace(
      /\/$/,
      "",
    );
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Resuelve el contacto de un negocio que aún no tiene web (típico del BORME:
 * una sociedad recién constituida de la que sólo sabemos el nombre).
 *
 * Busca la web oficial por nombre yextrae email, teléfono y web. Sin esto, los
 * constituyentes del BORME salían como nombres sin ningún canal de contacto.
 */
export type ResolvedContact = {
  website: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  jobTitle: string | null;
  address: string | null;
  city: string | null;
  signals: string[];
  source: "web" | null;
};

export async function resolveBusinessContact(input: {
  name: string;
  city?: string | null;
  region?: string | null;
  category?: string | null;
  address?: string | null;
  activity?: string | null;
  professionals?: string[];
  model?: string;
  timeoutMs?: number;
}): Promise<ResolvedContact> {
  const where = [input.city, input.region].filter(Boolean).join(", ") || "España";
  // Con el contexto registral la búsqueda acierta mucho más: el domicilio y
  // la actividad son mucho más discriminantes que un nombre de sociedad.
  const context: string[] = [];
  if (input.address) context.push(`domicilio social: ${input.address}`);
  if (input.activity) context.push(`actividad: ${input.activity.slice(0, 220)}`);
  if (input.professionals?.length) {
    context.push(`administrador/es o socios: ${input.professionals.slice(0, 4).join(", ")}`);
  }
  const contextText = context.length ? ` Datos registrales: ${context.join("; ")}.` : "";

  const prompt = `Busca en la web la información de contacto de "${input.name}"${input.category ? ` (${input.category})` : ""} en ${where}, España.${contextText} Necesito: el nombre comercial o la web oficial, email de contacto, teléfono, dirección y el nombre del profesional o administrador responsable. Es una sociedad recién constituida, así que busca también su web, sus fichas en directorios de empresas (empresite, axesor, informacion-empresas, eInforma) y el perfil público del administrador. Cita las URLs reales.`;

  try {
    const search = await webSearch(prompt, {
      model: input.model,
      timeoutMs: input.timeoutMs ?? 180_000,
      maxRounds: 1,
      maxTokens: 1500,
    });

    if (search.hits.length === 0) {
      return {
        website: null,
        email: null,
        phone: null,
        contactName: null,
        jobTitle: null,
        address: null,
        city: null,
        signals: [],
        source: null,
      };
    }

    const context = search.hits
      .slice(0, 14)
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.title ?? "sin título"}\nURL: ${hit.url ?? ""}\n${(hit.content ?? "").slice(0, 600)}`,
      )
      .join("\n\n---\n\n");

    const extracted = await completeJson<{
      website?: string | null;
      email?: string | null;
      phone?: string | null;
      contactName?: string | null;
      jobTitle?: string | null;
      address?: string | null;
      city?: string | null;
      signals?: string[];
    }>(
      `Estos son los resultados de buscar "${input.name}" en ${where}:\n\n${context}\n\nExtrae los datos de contacto reales de ESTE negocio (no de otros que aparezcan en los resultados). Si no hay web, deja website a null. Responde con JSON: {"website":null,"email":null,"phone":null,"contactName":null,"jobTitle":null,"address":null,"city":null,"signals":[]}`,
      { system: EXTRACTION_SYSTEM, maxTokens: 1200, temperature: 0.1 },
    );

    // Si el modelo no devolvió nada utilizable se reintenta: un turno malo
    // no puede dejar un negocio sin contactar.
    let contact = extracted;
    if (!contact?.website && !contact?.email && !contact?.phone) {
      const retry = await completeJson<typeof contact>(
        `Estos son los resultados de buscar "${input.name}" en ${where}:\n\n${context}\n\nExtrae los datos de contacto reales de ESTE negocio. Si no hay web, deja website a null. Responde con JSON: {"website":null,"email":null,"phone":null,"contactName":null,"jobTitle":null,"address":null,"city":null,"signals":[]}`,
        { system: EXTRACTION_SYSTEM, maxTokens: 1200, temperature: 0.2 },
      ).catch(() => null);
      if (retry) contact = retry;
    }

    const website = contact?.website ? normalizeUrl(contact.website) : null;
    const domain = website ? domainOf(website) : null;
    let email = contact?.email && /@/.test(contact.email) ? contact.email.trim().toLowerCase() : null;
    let phone = contact?.phone ?? null;

    // Segunda pasada: si ya tenemos la web pero no el email, se busca el
    // email por dominio. Los snippets de los buscadores suelen traerlo
    // escrito ("Email: hola@clinica.es", "contacto | 914 331 264").
    if (domain && !email) {
      try {
        const mailSearch = await webSearch(
          `Busca el email de contacto y el teléfono de ${domain} (sitio web oficial). Necesito la dirección de email exacta y el teléfono. Cita las URLs donde aparecen.`,
          { model: input.model, timeoutMs: input.timeoutMs ?? 120_000, maxRounds: 1, maxTokens: 1024 },
        );
        const mailContext = mailSearch.hits
          .slice(0, 10)
          .map((hit) => `${hit.title ?? ""}\n${hit.url ?? ""}\n${(hit.content ?? "").slice(0, 500)}`)
          .join("\n---\n");
        const mail = await completeJson<{ email?: string | null; phone?: string | null }>(
          `Busca el email y teléfono de contacto del sitio ${domain}.\n\n${mailContext}\n\nResponde con JSON: {"email":null,"phone":null}. Usa sólo emails que aparezcan explícitamente en los resultados.`,
          { maxTokens: 600, temperature: 0.1 },
        );
        if (mail?.email && /@/.test(mail.email) && !/@(example|sentry|wixpress)/i.test(mail.email)) {
          email = mail.email.trim().toLowerCase();
        }
        if (!phone && mail?.phone) phone = mail.phone;
      } catch {
        /* sin segunda pasada */
      }
    }

    return {
      website,
      email,
      phone,
      contactName: contact?.contactName ?? null,
      jobTitle: contact?.jobTitle ?? null,
      address: contact?.address ?? null,
      city: contact?.city ?? null,
      signals: Array.isArray(contact?.signals) ? contact.signals.slice(0, 6) : [],
      source: "web",
    };
  } catch (err) {
    console.error("[finder] no se pudo resolver el contacto", err);
    return {
      website: null,
      email: null,
      phone: null,
      contactName: null,
      jobTitle: null,
      address: null,
      city: null,
      signals: [],
      source: null,
    };
  }
}
