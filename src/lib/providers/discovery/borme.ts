/**
 * BORME — Boletín Oficial del Registro Mercantil (datos abiertos del BOE).
 *
 * Fuente de descubrimiento SIN API key y con volumen real: empresas de nueva
 * constitución (clínicas, consultas y despachos profesionales sanitarios).
 *
 * Es el mejor ICP para AgendaOS: profesionales que acaban de montar su clínica
 * y todavía no tienen agenda online.
 *
 * Docs: https://www.boe.es/datosabiertos/api/borme/sumario/YYYYMMDD
 */

import type { DiscoveredBusiness, DiscoveryQuery, DiscoveryResult } from "../contract";

const BOE_BASE = "https://www.boe.es";
const SUMARIO_URL = `${BOE_BASE}/datosabiertos/api/borme/sumario`;
const PROVINCE_XML_URL = `${BOE_BASE}/diario_borme/xml.php?id=`;

const USER_AGENT = "prospector/0.1 (local prospect research; https://github.com/alvgaragu/agendaos.es)";

const REQUEST_TIMEOUT_MS = 45_000;

/** Máximo de provincias descargadas por consulta. */
const MAX_PROVINCES = 6;
/** Máximo de días de sumario descargados por provincia. */
const MAX_DAYS_PER_PROVINCE = 3;
/** Días hábiles hacia atrás que se consultan (cada provincia publica en días propios). */
const MAX_LOOKBACK_DAYS = 10;

/**
 * Ciudad → alias del título de provincia en el BORME.
 * La clave se normaliza (mayúsculas, sin acentos) para comparar con el título.
 */
const PROVINCE_ALIASES: Record<string, string[]> = {
  MADRID: ["MADRID"],
  BARCELONA: ["BARCELONA"],
  VALENCIA: ["VALENCIA"],
  SEVILLA: ["SEVILLA"],
  BILBAO: ["BIZKAIA"],
  BILBO: ["BIZKAIA"],
  ZARAGOZA: ["ZARAGOZA"],
  MALAGA: ["MALAGA"],
  ALICANTE: ["ALICANTE"],
  "A CORUNA": ["A CORUNA", "CORUNA"],
  CORUNA: ["A CORUNA", "CORUNA"],
  VITORIA: ["ALAVA", "ARABA"],
  GASTEIZ: ["ALAVA", "ARABA"],
  MURCIA: ["MURCIA"],
  PALMA: ["BALEARES", "ILLES BALEARS"],
  MALLORCA: ["BALEARES", "ILLES BALEARS"],
  GRANADA: ["GRANADA"],
  VALLADOLID: ["VALLADOLID"],
  "LAS PALMAS": ["LAS PALMAS"],
  PAMPLONA: ["NAVARRA"],
  SANTANDER: ["CANTABRIA"],
  CORDOBA: ["CORDOBA"],
  VIGO: ["PONTEVEDRA"],
  GIJON: ["ASTURIAS"],
  TARRAGONA: ["TARRAGONA"],
  LLEIDA: ["LERIDA"],
  TOLEDO: ["TOLEDO"],
  CADIZ: ["CADIZ"],
  HUELVA: ["HUELVA"],
  BURGOS: ["BURGOS"],
  ALBACETE: ["ALBACETE"],
  OURENSE: ["OURENSE"],
  GIRONA: ["GIRONA"],
  GERONA: ["GIRONA"],
  TERUEL: ["TERUEL"],
  SORIA: ["SORIA"],
  SEGOVIA: ["SEGOVIA"],
  AVILA: ["AVILA"],
  CUENCA: ["CUENCA"],
  LLEIDA2: ["LERIDA"],
  CASTELLON: ["CASTELLON"],
  "SAN SEBASTIAN": ["GIPUZKOA"],
  DONOSTIA: ["GIPUZKOA"],
  JAEN: ["JAEN"],
  CÁDIZ: ["CADIZ"],
};

export type BormeProvince = {
  /** Título de provincia tal cual aparece en el sumario ("MADRID"). */
  title: string;
  /** Alias normalizados usados para el matching. */
  aliases: string[];
};

/**
 * Patrones de alta precisión: el objeto social debe describir una actividad
 * sanitaria real. Se evitan falsos positivos como "rehabilitación" (obra),
 * "fabricación" o "seguros".
 */
const HEALTH_PATTERNS: { pattern: RegExp; label: string; explicit: boolean }[] = [
  {
    pattern:
      /actividades?\s+de\s+(fisioterapia|fisioterap[eé]utic\w*|medicina|odontolog\w*|psicolog\w*|podolog\w*|osteopat\w*|logoped\w*|nutrici\w*|diet[eé]tic\w*)/i,
    label: "actividad sanitaria",
    explicit: true,
  },
  {
    pattern:
      /actividad\s+profesional\s+(propia\s+)?(de|del|de la|de las)\s+l[ao]s?\s*(psicolog\w*|medicin\w*|fisioter\w*|odontolog\w*|podolog\w*|logoped\w*|nutrici\w*|osteopat\w*)/i,
    label: "actividad profesional sanitaria",
    explicit: true,
  },
  {
    pattern: /consultorios?[,.]?\s*cl[ií]nicas?\s+y\s+d[eé]m[aá]s\s+centros\s+sanitarios/i,
    label: "consultorios y clínicas",
    explicit: true,
  },
  { pattern: /centros?[,.]?\s*unidades?\s+y\s+servicios\s+sanitarios/i, label: "centros sanitarios", explicit: true },
  { pattern: /servicios?\s+(sanitarios|asistenciales)/i, label: "servicios sanitarios", explicit: true },
  { pattern: /cl[ií]nicas?\s+(m[eé]dicas?|dentales?|de\s+est[eé]tica|de\s+fisioterapia)/i, label: "clínica", explicit: true },
  { pattern: /consultorios?\s+(m[eé]dicos?|dentales?)/i, label: "consultorio", explicit: true },
  { pattern: /medicina\s+(general|especializada|est[eé]tica)/i, label: "medicina", explicit: true },
  {
    pattern:
      /centros?\s+(m[eé]dicos?|sanitarios?|de\s+salud|de\s+fisioterapia|de\s+odontolog\w*|de\s+psicolog\w*|de\s+est[eé]tica)/i,
    label: "centro sanitario",
    explicit: true,
  },
  { pattern: /atenci[óo]n\s+(m[eé]dica|sanitaria|primaria)/i, label: "atención sanitaria", explicit: true },
  { pattern: /\bhospital\b/i, label: "hospital", explicit: true },
  { pattern: /\bfisioterapia\b/i, label: "fisioterapia", explicit: true },
  { pattern: /\bosteopat[ií]a\b/i, label: "osteopatía", explicit: true },
  { pattern: /\blogopedia\b/i, label: "logopedia", explicit: true },
  {
    pattern:
      /(profesionales?|sociedades?)\s+(m[eé]dicos?|sanitari\w*|odontol[óo]g\w*|fisioterapeut\w*|psicol[óo]g\w*)/i,
    label: "profesional sanitario",
    explicit: true,
  },
  { pattern: /parafarmac\w*/i, label: "parafarmacia", explicit: false },
  { pattern: /farmacia\b/i, label: "farmacia", explicit: false },
  { pattern: /ortopedi\w*/i, label: "ortopedia", explicit: false },
];

/** Palabras de salud en el nombre de la sociedad (filtro adicional). */
const HEALTH_NAME_WORDS = [
  "FISIO",
  "FISIOTERAP",
  "PSICOLOG",
  "CLINICA",
  "CLINIC",
  "DENTAL",
  "ODONTOLOG",
  "MEDIC",
  "MEDICINA",
  "NUTRI",
  "NUTRICION",
  "DIETET",
  "FARMAC",
  "SALUD",
  "HOSPITAL",
  "TERAPIA",
  "PODOLOG",
  "LOGOPED",
  "OSTEOPAT",
  "PARAFARMAC",
  "ORTOPED",
  "SANITAR",
];

/** Señales de "no es un negocio sanitario" (obra, inmobiliaria, seguros...). */
const NOISE_PATTERNS: RegExp[] = [
  /inmobiliari/i,
  /promoci[óo]n de (suelo|vivienda|terreno)/i,
  /construcci[óo]n completa/i,
  /construcci[óo]n de edificios/i,
  /rehabilitaci[óo]n de (fachadas|edificios|viviendas|espacios)/i,
  /asesoramiento y consultor[ií]a/i,
  /seguros? (de vida|generales|privados)/i,
  /agencia de valores/i,
];

/** Sectores no sanitarios que aparecen en el nombre de la sociedad. */
const NOISE_NAME_PATTERNS: RegExp[] = [
  /HOSPITALITY/i,
  /HOSTAL/i,
  /\bHOTEL/i,
  /TURIST/i,
  /TURISMO/i,
  /RESTAURANT/i,
  /INMOBILIAR/i,
  /CONSTRUCCION/i,
  /REFORMAS?/i,
  /PROMOCIONES?/i,
  /SEGUROS?/i,
  /ASEGUR/i,
  /FINANCIER/i,
  /CAPITAL\b/i,
  /INVEST/i,
  /PROPERTY/i,
  /REAL ?ESTATE/i,
  /INMUEBLE/i,
];

/** Normaliza para comparar títulos de provincia. */
function normalizeTitle(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, "")
    .trim();
}

/** Normaliza texto libre de consulta. */
function normalizeQuery(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Extrae la provincia a partir del texto de la query o de `location`. */
export function resolveProvince(
  queryText: string,
  location?: string | null,
): BormeProvince | null {
  const haystacks = [normalizeQuery(queryText)];
  if (location) haystacks.push(normalizeQuery(location));

  for (const haystack of haystacks) {
    for (const [city, aliases] of Object.entries(PROVINCE_ALIASES)) {
      const needle = normalizeQuery(city);
      if (needle && haystack.includes(needle)) {
        return { title: city, aliases };
      }
    }
  }
  return null;
}

function toDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Detecta una fecha explícita en la query ("2026-10-22", "22/10/2026"). */
function parseExplicitDate(queryText: string): string | null {
  const iso = queryText.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const es = queryText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (es) {
    return `${es[3]}${es[2].padStart(2, "0")}${es[1].padStart(2, "0")}`;
  }
  return null;
}

/** Días hábiles hacia atrás desde hoy (saltando fines de semana). */
export function resolveSearchDates(queryText: string, maxDays = MAX_LOOKBACK_DAYS): string[] {
  const explicit = parseExplicitDate(queryText);
  if (explicit) return [explicit];

  const dates: string[] = [];
  const cursor = new Date();
  let lookedBack = 0;

  while (dates.length < maxDays && lookedBack < MAX_LOOKBACK_DAYS) {
    const day = cursor.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend) dates.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    lookedBack += 1;
  }
  return dates;
}

type SumarioItem = { identificador: string; titulo: string; url_xml: string };

type Sumario = { sections: { code: string; items: SumarioItem[] }[] };

const sumarioCache = new Map<string, Promise<Sumario | null>>();
const xmlCache = new Map<string, Promise<string | null>>();

async function fetchWithTimeout(url: string, accept: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Descarga (y cachea) el sumario JSON de un día. */
export function fetchSumario(dateKey: string): Promise<Sumario | null> {
  const cached = sumarioCache.get(dateKey);
  if (cached) return cached;

  const promise = (async (): Promise<Sumario | null> => {
    const text = await fetchWithTimeout(`${SUMARIO_URL}/${dateKey}`, "application/json");
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as {
        data?: { sumario?: { diario?: { seccion?: { codigo?: string; item?: SumarioItem[] }[] }[] } };
      };
      const diarios = parsed.data?.sumario?.diario ?? [];
      const sections: Sumario["sections"] = [];
      for (const diario of diarios) {
        for (const seccion of diario.seccion ?? []) {
          sections.push({ code: seccion.codigo ?? "", items: seccion.item ?? [] });
        }
      }
      return { sections };
    } catch {
      return null;
    }
  })();

  sumarioCache.set(dateKey, promise);
  return promise;
}

/** Descarga (y cachea) el XML de una provincia. */
export function fetchProvinceXml(identificador: string): Promise<string | null> {
  const cached = xmlCache.get(identificador);
  if (cached) return cached;

  const promise = fetchWithTimeout(`${PROVINCE_XML_URL}${identificador}`, "application/xml");
  xmlCache.set(identificador, promise);
  return promise;
}

export type BormeArticle = {
  /** Número de artículo ("470700"). */
  numero: string;
  /** Nombre de la sociedad. */
  nombre: string;
  /** Texto del párrafo. */
  parrafo: string;
  /** Objeto social. */
  objetoSocial: string;
  /** Domicilio social declarado. */
  domicilio: string | null;
  /** Fecha de comienzo de operaciones ("2.10.26"). */
  comienzoOperaciones: string | null;
  /** CIF si aparece. */
  cif: string | null;
  /** Socios profesionales (para el pitch individual). */
  profesionales: string[];
  /** Etiquetas de actividad sanitaria detectadas. */
  etiquetas: string[];
};

const ARTICULO_RE = /<p class="articulo">([\s\S]*?)<\/p>([\s\S]*?)(?=<p class="articulo">|<\/texto>)/g;
const PARRAFO_RE = /<p class="parrafo">([\s\S]*?)<\/p>/;

function extractBetween(text: string, start: RegExp, end: RegExp): string | null {
  const startMatch = start.exec(text);
  if (!startMatch) return null;
  const rest = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(rest);
  const value = endMatch ? rest.slice(0, endMatch.index) : rest;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Etiquetas sanitarias detectadas en el objeto social. */
export function detectHealthLabels(objetoSocial: string, nombre: string): string[] {
  const labels = new Set<string>();
  const text = objetoSocial || "";

  let hasExplicit = false;
  for (const { pattern, label, explicit } of HEALTH_PATTERNS) {
    if (!pattern.test(text)) continue;
    labels.add(label);
    if (explicit) hasExplicit = true;
  }

  const upperName = nombre.toUpperCase();
  for (const word of HEALTH_NAME_WORDS) {
    if (upperName.includes(word)) {
      labels.add(`nombre:${word.toLowerCase()}`);
      break;
    }
  }

  if (labels.size === 0) return [];
  // Sectores no sanitarios (hostelería, obra, inmobiliaria, seguros...).
  if (NOISE_NAME_PATTERNS.some((pattern) => pattern.test(nombre))) {
    return [];
  }
  // Ruido del sector construcción/inmobiliario/seguros: sólo se acepta si el
  // objeto social nombra explícitamente una actividad sanitaria.
  if (NOISE_PATTERNS.some((pattern) => pattern.test(text)) && !hasExplicit) {
    return [];
  }
  return [...labels];
}

/** Parsea el XML de provincia y devuelve las constituciones. */
export function parseProvinceXml(xml: string): BormeArticle[] {
  const articles: BormeArticle[] = [];

  for (const match of xml.matchAll(ARTICULO_RE)) {
    const rawTitle = decodeXml(match[1] ?? "").trim();
    const body = match[2] ?? "";
    const parrafoMatch = PARRAFO_RE.exec(body);
    if (!parrafoMatch) continue;

    const parrafo = decodeXml(parrafoMatch[1] ?? "").replace(/\s+/g, " ").trim();
    if (!parrafo.startsWith("Constitución")) continue;

    const titleMatch = rawTitle.match(/^(\d+)\s*-\s*(.*)$/);
    const numero = titleMatch?.[1] ?? rawTitle;
    const nombre = (titleMatch?.[2] ?? rawTitle).replace(/\.$/, "").trim();
    if (!nombre) continue;

    const objetoSocial =
      extractBetween(parrafo, /Objeto social:\s*/i, /Domicilio:|Capital:|Nombramientos\./i) ?? "";
    const domicilio = extractBetween(parrafo, /Domicilio:\s*/i, /Capital:|Nombramientos\./i);
    const comienzoOperaciones = extractBetween(
      parrafo,
      /Comienzo de operaciones:\s*/i,
      /Objeto social:|Domicilio:|Capital:/i,
    );
    const cifMatch = parrafo.match(/CIF\s*:?\s*([A-Z]?\d{8}[A-Z]?)/i);

    const profesionales: string[] = [];
    const profMatch = parrafo.match(/Soc\.\s*Prof\.\s*:?\s*(.*?)(?:\.\s|;?\s*Adm\.|$)/i);
    if (profMatch?.[1]) {
      for (const chunk of profMatch[1].split(";")) {
        const name = chunk.trim().replace(/\.$/, "");
        if (name.length > 3 && name.length < 80) profesionales.push(name);
      }
    }

    const etiquetas = detectHealthLabels(objetoSocial, nombre);

    articles.push({
      numero,
      nombre,
      parrafo,
      objetoSocial,
      domicilio,
      comienzoOperaciones,
      cif: cifMatch?.[1]?.toUpperCase() ?? null,
      profesionales,
      etiquetas,
    });
  }

  return articles;
}

function articleToBusiness(
  article: BormeArticle,
  province: BormeProvince,
  dateKey: string,
  identificador: string,
): DiscoveredBusiness {
  const domicilio = article.domicilio;
  const ciudad = domicilio
    ? (domicilio.match(/\(([^()]{2,40})\)\s*$/)?.[1] ?? null)
    : null;

  return {
    sourceRef: `borme/${identificador}/${article.numero}`,
    source: "borme",
    name: article.nombre,
    website: null,
    domain: null,
    phoneNumber: null,
    city: ciudad,
    region: province.title,
    country: "ES",
    latitude: null,
    longitude: null,
    category: article.etiquetas[0] ?? "empresa_sanitaria",
    address: domicilio,
    raw: {
      provincia: province.title,
      fecha: dateKey,
      objetoSocial: article.objetoSocial,
      etiquetas: article.etiquetas,
      cif: article.cif,
      domicilio,
      comienzoOperaciones: article.comienzoOperaciones,
      profesionales: article.profesionales,
      bormeId: identificador,
      articulo: article.numero,
    },
  };
}

/** ¿Coincide el título de provincia del sumario con la provincia buscada? */
function provinceMatches(itemTitle: string, province: BormeProvince): boolean {
  const normalized = normalizeTitle(itemTitle);
  if (normalized.includes("INDICE")) return false;
  return province.aliases.some((alias) => normalized.includes(normalizeTitle(alias)));
}

/**
 * Descubre constituciones sanitarias recientes en el BORME.
 * Devuelve `null` si no hay provincia reconocible en la query.
 */
export async function searchBorme(query: DiscoveryQuery): Promise<DiscoveryResult | null> {
  const province = resolveProvince(query.query, query.location);
  if (!province) return null;

  const dates = resolveSearchDates(query.query);
  const limit = query.limit ?? 50;
  const businesses: DiscoveredBusiness[] = [];
  const warnings: string[] = [];
  let provincesDownloaded = 0;
  let daysWithData = 0;

  // Cada provincia publica en días propios: se recorren hasta 10 días hábiles
  // y se accumulates como máximo 3 de ellos por provincia.
  const pending: { identificador: string; dateKey: string; title: string }[] = [];
  const seenDays = new Set<string>();

  for (const dateKey of dates) {
    const sumario = await fetchSumario(dateKey);
    if (!sumario) {
      warnings.push(`BORME: no se pudo descargar el sumario del ${dateKey}.`);
      continue;
    }

    const sectionA = sumario.sections.find((section) => section.code === "A");
    if (!sectionA) continue;

    const matching = sectionA.items.filter((item) => provinceMatches(item.titulo, province));
    if (matching.length === 0) continue;

    daysWithData += 1;

    for (const item of matching) {
      const key = `${item.identificador}`;
      if (seenDays.has(key)) continue;
      if (pending.filter((entry) => entry.title === item.titulo).length >= MAX_DAYS_PER_PROVINCE) {
        continue;
      }
      seenDays.add(key);
      pending.push({ identificador: item.identificador, dateKey, title: item.titulo });
    }
  }

  if (pending.length === 0) {
    warnings.push(
      `BORME: la provincia ${province.title} no publicó actos inscritos en los últimos ${dates.length} días hábiles.`,
    );
  }

  for (const entry of pending) {
    if (provincesDownloaded >= MAX_PROVINCES) break;
    provincesDownloaded += 1;

    const xml = await fetchProvinceXml(entry.identificador);
    if (!xml) {
      warnings.push(`BORME: no se pudo descargar el XML de ${entry.title} (${entry.dateKey}).`);
      continue;
    }

    for (const article of parseProvinceXml(xml)) {
      if (article.etiquetas.length === 0) continue;
      businesses.push(articleToBusiness(article, province, entry.dateKey, entry.identificador));
    }
  }

  if (businesses.length === 0 && daysWithData === 0) {
    warnings.push("BORME: no se encontró ningún sumario disponible.");
  }

  return {
    businesses: businesses.slice(0, limit),
    interpretation: `BORME (${province.title}): ${businesses.length} constituciones con actividad sanitaria en ${daysWithData} día(s) de sumario.`,
    warnings,
    provider: "borme",
  };
}
