/**
 * Crawler de webs de negocios: extrae emails, teléfonos, equipo, dirección y
 * señales de "necesita agenda online".
 *
 * Límites: máximo 6 páginas por web (home + 4 candidatas + 1 contacto),
 * timeout 12s por página y User-Agent de navegador real.
 */

import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import * as iconv from "iconv-lite";
import type { WebsiteContactResult, WebsiteCrawler } from "../contract";
import { stripAccents } from "../../text";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PAGE_TIMEOUT_MS = 12_000;
const MAX_PAGES = 6;
const MAX_TEAM_PAGES = 4;
/** Tope de profesionales extraídos por web. */
const MAX_TEAM_MEMBERS = 20;

/** Planificadores externos de cita (el negocio ya tiene agenda → peor ICP). */
const SCHEDULING_PROVIDERS = [
  "calendly.com",
  "calendly",
  "doctoralia.es",
  "doctoralia",
  "dontorres.net",
  "dontorres",
  "bcode.es",
  "bcode",
  "resalud.es",
  "resalud",
  "eideal.es",
  "eideal",
  "simplybook.it",
  "simplybook",
  "setmore.com",
  "setmore",
  "acuityscheduling.com",
  "acuityscheduling",
  "medicilio.es",
  "medicilio",
  "saludgest",
  "topdoctor",
  "nubemedical",
  "wearecloud",
  "docky.app",
  "timedium.com",
];

/** Palabras clave de la página de contacto. */
const CONTACT_HINTS = ["contacto", "contact", "contactanos", "contactenos", "donde-estamos", "ubicacion"];

/** Patrones de URL de páginas de equipo. */
const TEAM_HINTS = [
  "equipo",
  "equipo-medico",
  "profesionales",
  "professionals",
  "about",
  "nosotros",
  "quienes-somos",
  "doctores",
  "medicos",
  "especialistas",
  "equipo-humano",
  "staff",
];

/** Roles/títulos que delatan el cargo de una persona. */
const ROLE_PATTERNS = [
  /fisioterap[eé]ut\w*/i,
  /fisioterapeuta/i,
  /osteop[aá]ta/i,
  /dentista/i,
  /odont[óo]log\w*/i,
  /psic[óo]log\w*/i,
  /nutricionista/i,
  /dietista/i,
  /pod[óo]log\w*/i,
  /logopeda/i,
  /m[eé]dico[as]?/i,
  /doctor[as]?/i,
  /especialista/i,
  /director[as]?/i,
  /fundador[as]?/i,
  /coordinador[as]?/i,
  /oste[óo]pat/i,
  /farmac[eé]utico\w*/i,
  /traumat[óo]log\w*/i,
  /oftalm[óo]log\w*/i,
  /ginec[óo]log\w*/i,
  /pediatra/i,
  /card[ií]olog\w*/i,
  /dermat[óo]log\w*/i,
  /rehabilitaci[óo]n/i,
];

/** Palabras que nunca son un nombre de persona. */
export const NAME_STOPWORDS = [
  "Clínica",
  "Clinica",
  "Centro",
  "Consulta",
  "Servicios",
  "Tratamientos",
  "Contacto",
  "Noticias",
  " BLOG",
  "Blog",
  "Sobre",
  "Nosotros",
  "Nuestra",
  "Nuestro",
  "Equipo",
  "Profesionales",
  "Inicio",
  "Accueil",
  "Dirección",
  "Horario",
  "Horario de",
  "Política",
  "Aviso",
  "Legal",
  "Cookies",
  "Mapa",
  "Precio",
  "Precios",
  "Más",
  "Ver",
  "Leer",
  // Cargos: "Fundadora Psicofisio" es un encabezado, no una persona.
  "Fundadora",
  "Fundador",
  "Directora",
  "Director",
  "Gerente",
  "Propietaria",
  "Propietario",
  "Coordinadora",
  "Coordinador",
  "Administradora",
  "Administrador",
  "Responsable",
  "Presidenta",
  "Presidente",
  "Socia",
  "Socio",
  "Médica",
  "Médico",
  "Fisioterapeuta",
  "Nutricionista",
  "Dietista",
  "Odontóloga",
  "Odontólogo",
  "Dentista",
  "Psicóloga",
  "Psicólogo",
  "Osteópata",
  "Osteopata",
  "Logopeda",
  "Podóloga",
  "Podólogo",
  "Terapeuta",
  "Titular",
];


/**
 * Nombres próprios españoles frecuentes. Un encabezado como "Medicina Estética"
 * o "Preguntas Frecuentes" también es 2-3 palabras capitalizadas, así que la
 * forma capitalizada NO basta: hace falta que la primera palabra sea un nombre
 * de pila conocido o que el bloque traiga un cargo.
 */
const SPANISH_GIVEN_NAMES = new Set([
  "ana","angel","antonio","barbara","beatriz","carlos","carmen","cristina","daniel","david","diego","elena","elisa","emilio","encarna","ernesto","esteban","eugenia","evan","felipe","fernando","francisco","gabriel","gema","gerardo","gregorio","hector","helena","hugo","ignacio","irene","isabel","ivan","javier","jessica","joaquin","jorge","jose","juan","julia","laura","leandro","lorena","lucas","lucia","luis","manuel","maria","marta","martin","miguel","marta","monica","nacho","natalia","nicolas","noelia","pablo","pedro","pilar","raul","ricardo","roberto","rocio","rosa","sandra","sergio","silvia","sofia","sonia","susan","teresa","valentina","vanesa","victor","victoria","xavier","yolanda",
  "julio","ignacio","fernando","gregorio","ramon","ramón","sergio","ricardo","ruben","rubén","ruth",
  "alba","beatriz","bruna","cesar","cesar","consuelo","dora","edu","elisa","esther","eugenia","eva",
  "francis","gloria","guillermo","hernan","hernán","hilda","hipolito","hipólito","inmaculada","irene",
  "ivan","jorge","julia","julio","laura","leire","lidia","lorena","lorenzo","mario","marta","miguel",
  "nuria","olga","pablo","paloma","pedro","raul","rebeca","remedios","rita","rocio","rocio","rosa",
  "rosario","ruben","salvador","sara","silvia","tania","teresa","valeria","yolanda","alba","amparo","alberto","alejandra","alvaro","amalia","andrea","araceli","beatriz","borja","carla","carlos","celia","cesar","claudia","david","diego","eduardo","elisa","esther","fatima","gema","gregorio","hilda","ibai","irene","javi","juan","laia","leire","lorenzo","lucia","maite","malena","manu","marta","miguel","nerea","nuria","olga","patxi","paula","raul","rebeca","ruth","sandra","silvia","teresa","unai","valeria","veronica",
  "mayte","ezequiel","ines","aitor","mikel","leo","sabela","aritz","sergi","josu","mari","tere","aitana","noa","clara","raul","ivan","adrian","alvaro","nestor","hector","ismael","fermin","oriol","carla","clara","ines","paola","johanna","rebeca","encarna","milagros","purificacion",
]);

/** Encabezados y palabras de menú que se confunden con nombres. */
export const SERVICE_STOPWORDS = [
  "medicina","estetica","estética","fisioterapia","general","oncologica","oncológica","drenaje",
  "linfatico","linfático","manual","quienes","quienes somos","somos","preguntas","frecuentes",
  "para","nuevos","pacientes","experiencia","profesional","sigue","follow","nos","encuentra",
  "contacto","servicios","tratamientos","osteopatia","osteopatía","drenaje linfatico",
  "atencion","atención","nuestro","equipo","clinic","clinica","clínica","centro","consulta",
  "diagnostico","diagnóstico","tratamiento","rehabilitacion","rehabilitación","terapia",
  "nutricion","nutrición","psicologia","psicología","odontologia","odontología","podologia",
  "podología","logopedia","osteopata","osteópata","fisioterapeuta","fisioterapeutas","nutricionista",
  "nutricionistas","psicologo","psicólogo","psicologa","psicóloga","dentista","odontologo",
  "odontólogo","podologo","podólogo","logopeda","entrenador","entrenadora","preparador",
  "seguros","horario","horarios","tarifas","precios","precio","mapa","mas","más","ver","leer",
  "quienes somos","contactanos","contactános","trabaja","empleo","faq","blog","news","noticias",
  "inicio","home","servicio","politica","privacidad","cookies","legal","aviso","descargas",
  "diagnostico_y_tratamiento","tratamientos_y_precios","recursos","blog_y_noticias","equipo_medico",
  "cita","previa","proxima","anterior","siguiente","media","primer","segunda","segundo","tercer",
  "movil","móvil","telefono","teléfono","whatsapp","email","formulario","mapa","video","galeria",
  "galería","opiniones","testimonios","resenas","reseñas","ofertas","promociones","descuentos",
  "preguntas_frecuentes","quienes_somos","para_nuevos_pacientes","experiencia_profesional",
  "abdominal","seca","seco","profunda","superficial","instrumental","corporal","facial","capilar",
  "postoperatorio","rehabilitacion","evaluacion","valoracion","asesoramiento","seguimiento",
  "revision","consulta","primera","visita","previa","sesion","sesiones","sesion","punto",
  "electro","diatermia","ultrasonido","laser","magnetoterapia","terapia","presoterapia","vendaje",
  "inmovilizacion","masaje","masajes","quiromasaje","pilates","yoga","crossfit","running",
];

/**
 * Palabras clínicas que no son apellidos de profesionales. En webs de salud
 * "Paciente" aparece como si fuera un apellido ("Teresa Paciente") en
 * testimonios o frases del tipo "su paciente...". Con estos términos, un
 * bloque se descarta aunque el nombre de pila sea válido.
 */
export const MEDICAL_CONTEXT_WORDS = [
  "paciente","pacientes","cliente","clientes","sintoma","sintomas","sintomatologia",
  "diagnostico","diagnosticos","tratamiento","tratamientos","terapia","terapias",
  "medico","medica","medicos","enfermeria","enfermero","enfermera","urgencias",
  "hospital","sanidad","receta","recetas","anamnesis","exploracion","pronostico",
  "signos","signos vitales","morbilidad","prevencion","epidemiologia","fisiologia",
  "patologia","prevision","mutualidad","aseguradora","seguro","seguros","domicilio",
  "consentimiento","informacion","informacionte","historia","historia clinica",
];

/** Quita acentos y minúsculas para comparar palabras. */
export { stripAccents } from "../../text";

/**
 * Tokens de servicio de 8+ letras: si una palabra del candidato las contiene,
 * el candidato es el nombre comercial de la clínica, no una persona
 * ("Fisiorehabilitación Vicálvaro", "Osteopatía Vital"). Los tokens cortos
 * ("clínica", "general") sólo se comparan como palabra exacta.
 */
const SERVICE_TOKEN_SUBSTRINGS = SERVICE_STOPWORDS.filter(
  (word) => !word.includes(" ") && word.length >= 8,
).map(stripAccents);

const MEDICAL_TOKEN_SUBSTRINGS = MEDICAL_CONTEXT_WORDS.filter(
  (word) => !word.includes(" ") && word.length >= 8,
).map(stripAccents);

/** Patrón de nombre humano: 2-3 palabras capitalizadas. */
const PERSON_NAME_RE =
  /^[A-ZÁÉÍÓÚÑ][\p{L}'’.-]*(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'’.-]*){1,2}$/u;

export type CrawledPage = {
  url: string;
  html: string;
};

/** Detecta el charset del header o del meta y decodifica con iconv-lite. */
function decodeBody(buffer: ArrayBuffer, contentType: string | null): string {
  const bytes = Buffer.from(buffer);

  let charset: string | null = null;
  if (contentType) {
    const match = contentType.match(/charset=["']?([\w-]+)/i);
    if (match?.[1]) charset = match[1];
  }

  if (!charset) {
    // Meta charset en los primeros bytes.
    const head = bytes.subarray(0, 2048).toString("latin1");
    const metaMatch =
      head.match(/<meta[^>]+charset=["']?([\w-]+)/i) ??
      head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i);
    if (metaMatch?.[1]) charset = metaMatch[1];
  }

  if (!charset || charset.toLowerCase() === "utf-8" || charset.toLowerCase() === "utf8") {
    return bytes.toString("utf8");
  }

  const normalized = charset.toLowerCase();
  const label = iconv.encodingExists(normalized)
    ? normalized
    : iconv.encodingExists(charset)
      ? charset
      : null;
  if (!label) return bytes.toString("utf8");
  return iconv.decode(bytes, label);
}

/** Solo IPv4 públicas; los destinos IPv6 se rechazan por precaución. */
function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

/** Descarga limitada con DNS fijado y validación en cada redirección. */
export async function fetchPage(url: string): Promise<CrawledPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = new URL(url);
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return null;
      const addresses = await lookup(target.hostname, { all: true, family: 4 });
      if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) return null;
      const address = addresses[0].address;
      const result = await new Promise<{ status: number; location?: string; contentType?: string; bytes: Buffer }>((resolve, reject) => {
        const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
          signal: controller.signal,
          lookup: (_hostname, _options, callback) => callback(null, address, 4),
          headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9,en;q=0.8" },
        }, response => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2_000_000) { response.destroy(new Error("Página demasiado grande")); return; }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => resolve({ status: response.statusCode ?? 0, location: response.headers.location, contentType: response.headers["content-type"], bytes: Buffer.concat(chunks) }));
        });
        request.on("error", reject);
        request.end();
      });
      if (result.status >= 300 && result.status < 400 && result.location) {
        url = new URL(result.location, target).toString();
        continue;
      }
      if (result.status < 200 || result.status >= 300 || (result.contentType && !/text\/html|application\/xhtml/i.test(result.contentType))) return null;
      return { url: target.toString(), html: decodeBody(Uint8Array.from(result.bytes).buffer, result.contentType ?? null) };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Normaliza un email (minúsculas, sin espacios). */
function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0] ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return null;

  const local = email.split("@")[0] ?? "";
  // Falsos positivos típicos: "logo.png@2x", "image.jpg@", "sprite@2x.png".
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|ico)$/i.test(local)) return null;
  if (local.endsWith("@2x") || local.includes("@2x")) return null;
  if (/^(example|sentry|wixpress|squarespace|godaddy|domain|your|email|name|user|info)$/i.test(local)) {
    // genéricos permitidos aparte
    if (!["info", "contacto", "hola", "admin"].includes(local)) return null;
  }
  return email;
}

/** Extrae emails del HTML (texto + enlaces mailto:). */
/** Dominios que no son de contacto real sino herramientas de la web. */
const NON_CONTACT_EMAIL_DOMAINS = new Set([
  "sentry.io","wixpress.com","sentry.wixpress.com","godaddy.com","squarespace.com","shopify.com",
  "mailchimp.com","sendgrid.net","cloudflare.com","google.com","gmail.com","yahoo.com","hotmail.com",
  "outlook.com","example.com","email.com","mail.ru","yandex.ru","2xmail.com","emailonly.com",
]);

/** ¿El email parece de contacto real y no una etiqueta de tracking? */
export function isPlausibleContactEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!value.includes("@")) return false;
  const [local, domain] = value.split("@");
  if (!local || !domain) return false;
  if (NON_CONTACT_EMAIL_DOMAINS.has(domain)) return false;
  // Emails de tracking: hash largo + dominio de analítica.
  if (/^[a-f0-9]{24,}@/.test(local)) return false;
  if (/^(no-?reply|noreply|donotreply|postmaster|abuse|admin|root|webmaster|hostmaster)@/.test(local)) {
    return false;
  }
  if (/(sentry|wixpress|godaddy|squarespace|example|test|placeholder)/.test(domain)) return false;
  return true;
}

export function extractEmails(html: string, $: cheerio.CheerioAPI): string[] {
  const found = new Set<string>();

  $("a[href^='mailto:'], a[href^='MAILTO:']").each((_i, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const email = normalizeEmail(decodeURIComponent(href.replace(/^mailto:/i, "")));
    if (email && isPlausibleContactEmail(email)) found.add(email);
  });

  const rawMatches = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const raw of rawMatches) {
    const email = normalizeEmail(raw);
    if (email && isPlausibleContactEmail(email)) found.add(email);
  }

  return [...found];
}

/** Normaliza un teléfono español a formato +34 XXX XXX XXX. */
export function normalizePhone(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("34") && digits.length === 11) {
    const local = digits.slice(2);
    return `+34 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 9)}`;
  }
  if (digits.length !== 9) return null;
  const first = digits[0];
  const isMobile = first === "6" || first === "7";
  const isLandline = first === "8" || first === "9";
  if (!isMobile && !isLandline) return null;
  return `+34 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
}

/** Extrae teléfonos con formatos españoles. */
export function extractPhones(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\+34[\s.-]?\d{3}[\s.-]?\d{2,3}[\s.-]?\d{2,3}/g,
    /(?<!\d)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g,
    /(?<!\d)[67]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const phone = normalizePhone(match[0]);
      if (phone) found.add(phone);
    }
  }
  return [...found];
}

/** ¿Es un nombre humano plausible? */
export function isPersonName(text: string): boolean {
  const candidate = text.trim().replace(/\s+/g, " ");
  if (candidate.length < 6 || candidate.length > 45) return false;
  if (/\d|@|http|\.es|\.com/i.test(candidate)) return false;
  if (NAME_STOPWORDS.some((word) => candidate.startsWith(word))) return false;
  if (!PERSON_NAME_RE.test(candidate)) return false;
  const words = candidate.split(" ");
  if (words.some((word) => word.length < 2)) return false;

  // Ni una sola palabra del nombre puede ser una palabra de encabezado.
  const lowered = words.map((word) => word.toLowerCase().replace(/[.,]/g, ""));
  if (lowered.some((word) => SERVICE_STOPWORDS.includes(word))) return false;
  if (lowered.some((word) => MEDICAL_CONTEXT_WORDS.includes(word))) return false;

  // Un nombre de persona no lleva dentro un término de servicio ni una
  // palabra clínica: si los lleva, es el nombre comercial del negocio
  // ("Fisiorehabilitación Vicálvaro") o un falso positivo ("Teresa Paciente").
  const compact = lowered.map(stripAccents);
  if (compact.some((word) => SERVICE_TOKEN_SUBSTRINGS.some((token) => word.includes(token)))) {
    return false;
  }
  if (compact.some((word) => MEDICAL_TOKEN_SUBSTRINGS.some((token) => word.includes(token)))) {
    return false;
  }

  return true;
}


/** Busca un cargo en un fragmento corto de texto. */
function matchRole(text: string): string | null {
  const clean = text.trim();
  if (!clean || clean.length > 120) return null;
  for (const pattern of ROLE_PATTERNS) {
    const match = clean.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * ¿El cargo aparece en la misma línea o inmediatamente junto al nombre?
 * Evita que cualquier página que mencione "fisioterapeuta" convierta sus
 * encabezados de servicios ("Diástasis Abdominal", "Punción Seca") en personas.
 */
function roleIsNearby(scope: string, role: string): boolean {
  const pattern = new RegExp(
    `[^.\\n]{0,40}${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.\\n]{0,40}`,
    "i",
  );
  return pattern.test(scope);
}

/**
 * ¿El texto parece el nombre de pila + apellidos de una persona real?
 * Exige que la primera palabra sea un nombre propio español conocido.
 */
export function looksLikePersonFullName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return false;
  const first = words[0].toLowerCase().replace(/[.,]/g, "");
  return SPANISH_GIVEN_NAMES.has(first);
}

/** Quita prefijos de título ("Dra.", "Dr.", "Lic."). */
function stripTitlePrefix(name: string): string {
  return name.replace(/^(dra?\.?|lic\.?|sr\.?|sra\.?)\s+/i, "").trim();
}

/**
 * Muchas consultas llevan el nombre del profesional: "Carlos Mudarra -
 * Nutricionista en Valencia" o "Clínica de Fisioterapia Alba Vidal". Si el
 * nombre del negocio contiene a una persona, esa persona es el mejor contacto
 * (es el dueño, en el caso del ICP de autónomos).
 */
export function personFromBusinessName(businessName: string | null | undefined): string | null {
  if (!businessName) return null;
  const prefix = (businessName.split(/\s+[-–—|,·]\s+/)[0] ?? "").trim();
  if (!prefix) return null;

  const candidates: string[] = [prefix];
  const words = prefix.split(/\s+/).filter(Boolean);
  if (words.length >= 4) candidates.push(words.slice(-2).join(" "));

  for (const candidate of candidates) {
    const clean = candidate.replace(/[.,]+$/, "").trim();
    if (clean.split(/\s+/).length < 2) continue;
    if (!looksLikePersonFullName(clean)) continue;
    if (!isPersonName(clean)) continue;
    return clean;
  }
  return null;
}

/** Extrae el equipo (nombre + cargo) de una página. */
export function extractTeamMembers($: cheerio.CheerioAPI): {
  name: string;
  role: string | null;
}[] {
  const members: { name: string; role: string | null }[] = [];
  const seen = new Set<string>();

  const selectors = "h1, h2, h3, h4, h5, h6, li, p, strong, b, span.item, .name, .nombre, .team-member, .equipo, .doctor, .profesional";

  $(selectors).each((_i, element) => {
    const node = $(element);
    const text = node.text().trim().replace(/\s+/g, " ");
    if (!isPersonName(text)) return;

    const name = stripTitlePrefix(text);
    if (!isPersonName(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;

    // El cargo sólo cuenta si está en posición ESTRICTA: en el propio elemento
    // ("Dra. Elena Márquez, Fisioterapeuta") o en el hermano siguiente si ese
    // hermano es corto y es un cargo. Si se mirase el bloque entero, cualquier
    // listado de servicios ("Suelo Pélvico", "Punción Seca") se convertiría en
    // un profesional porque la página menciona "fisioterapeuta".
    let role: string | null = matchRole(node.text());
    if (!role) {
      const nextText = node.next().text().trim().replace(/\s+/g, " ");
      if (nextText && nextText.length <= 40) role = matchRole(nextText);
    }

    // Sin cargo pegado al nombre y sin nombre de pila conocido no es una
    // persona: es un encabezado o un servicio ("Medicina Estética",
    // "Suelo Pélvico", "Preguntas Frecuentes").
    if (!role && !looksLikePersonFullName(name)) return;

    seen.add(key);
    members.push({ name, role });
  });

  return members;
}

/** Lee los datos de schema.org JSON-LD. */
export function extractJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $("script[type='application/ld+json']").each((_i, element) => {
    const raw = $(element).contents().text();
    if (!raw?.trim()) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const push = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const item of value) push(item);
          return;
        }
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          out.push(record);
          if (record["@graph"]) push(record["@graph"]);
        }
      };
      push(parsed);
    } catch {
      // JSON-LD inválido: se ignora.
    }
  });
  return out;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extrae dirección/ciudad/provincia de JSON-LD. */
function addressFromJsonLd(nodes: Record<string, unknown>[]): {
  address: string | null;
  city: string | null;
  region: string | null;
  telephone: string | null;
  name: string | null;
  employees: { name: string; role: string | null }[];
} {
  let address: string | null = null;
  let city: string | null = null;
  let region: string | null = null;
  let telephone: string | null = null;
  let name: string | null = null;
  const employees: { name: string; role: string | null }[] = [];

  for (const node of nodes) {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    const typeList = types
      .filter((type): type is string => typeof type === "string")
      .map((type) => type.toLowerCase());

    const relevant =
      typeList.some((type) =>
        [
          "medicalorganization",
          "localbusiness",
          "physician",
          "dentist",
          "healthandbeautybusiness",
          "medicalbusiness",
          "hospital",
          "clinic",
          "organization",
          "professionalservice",
        ].includes(type),
      ) || Boolean(node.address);

    if (!relevant) continue;

    name = name ?? asString(node.name);
    telephone = telephone ?? asString(node.telephone);

    const rawAddress = asRecord(node.address);
    if (rawAddress) {
      const street = asString(rawAddress.streetAddress);
      const locality = asString(rawAddress.addressLocality);
      const regionValue = asString(rawAddress.addressRegion);
      const postal = asString(rawAddress.postalCode);
      const composed = [street, postal, locality, regionValue].filter(Boolean).join(", ");
      if (composed) address = address ?? composed;
      city = city ?? locality;
      region = region ?? regionValue;
    }

    const employee = node.employee;
    const employeeList = Array.isArray(employee) ? employee : employee ? [employee] : [];
    for (const item of employeeList) {
      const record = asRecord(item);
      if (!record) continue;
      const employeeName = asString(record.name);
      if (!employeeName) continue;
      employees.push({
        name: employeeName,
        role: asString(record.jobTitle),
      });
    }
  }

  return { address, city, region, telephone, name, employees };
}

/** Señales de "usa un planificador externo" (ya tiene agenda → peor ICP). */
export function detectSignals(html: string, url: string, isHome = true): string[] {
  const signals: string[] = [];
  const haystack = `${html} ${url}`.toLowerCase();

  for (const provider of SCHEDULING_PROVIDERS) {
    if (haystack.includes(provider)) {
      signals.push(`Usa un planificador de citas externo (${provider})`);
      break;
    }
  }

  if (/\b(agenda|citas|reservas|reservar|booking)\b/i.test(html)) {
    signals.push("Menciona gestión de citas/reservas");
  }
  const hasForm = /<form/i.test(html);
  if (hasForm) {
    const formPart = html.slice(html.search(/<form/i), html.search(/<form/i) + 800);
    const hasEmailField = /type=["']email["']|name=["']email["']/i.test(formPart);
    if (!hasEmailField) signals.push("Formulario sin campo de email (no capta leads)");
  } else {
    signals.push("Sin formulario de contacto en la web");
  }

  // --- Perfil del negocio: autónomo independiente vs cadena/policlínica ---
  // Sólo se mira la página principal: en el blog de un profesional solo
  // aparecen frases como "muchos pacientes scouting a nuestras clínicas" que
  // no significan que sea una cadena.
  const text = cheerio.load(html).text().replace(/\s+/g, " ");

  if (isHome && CHAIN_PATTERNS.some((pattern) => pattern.test(text))) {
    signals.push("Cadena, policlínica o multiproyecto (no es un profesional independiente)");
  }
  if (isHome && SOLO_PATTERNS.some((pattern) => pattern.test(text))) {
    signals.push("Consulta privada de un solo profesional");
  }
  if (isHome && HOME_VISIT_PATTERNS.some((pattern) => pattern.test(text))) {
    signals.push("Trabaja a domicilio o en la consulta del domicilio");
  }
  if (isHome && /sin recepci[óo]n|sin personal de recepci[óo]n|sin asistente/i.test(text)) {
    signals.push("Atiende sin recepción ni personal de apoyo");
  }

  // --- Grado de digitalización: ¿gestiona las citas a mano o ya tiene CRM? ---
  if (
    /ll[aá]manos para (pedir|reservar|concertar)/i.test(text) ||
    /reservas? (?:por |a trav[eé]s de )?(?:tel[eé]fono|whatsapp)/i.test(text) ||
    /pedir cita (?:por |a trav[eé]s de )?(?:tel[eé]fono|whatsapp|email)/i.test(text) ||
    /cita previa (?:por |a trav[eé]s de )?(?:tel[eé]fono|whatsapp)/i.test(text) ||
    /consulta de horario|horario de consulta/i.test(text) ||
    /gestionamos las citas|gesti[óo]n de citas.{0,30}manual/i.test(text)
  ) {
    signals.push("Gestiona las citas a mano (teléfono, WhatsApp o papel)");
  }

  if (
    /nuestro software de gesti[óo]n/i.test(text) ||
    /nuestra plataforma de (?:gesti[óo]n|pacientes)/i.test(text) ||
    /portal del paciente/i.test(text) ||
    /historia cl[ií]nica (?:online|electr[óo]nica|en l[ií]nea)/i.test(text) ||
    /software de gesti[óo]n de (?:pacientes|cl[ií]nicas)/i.test(text) ||
    /nuestro crm/i.test(text) ||
    /nuestra aplicaci[óo]n de gesti[óo]n/i.test(text)
  ) {
    signals.push("Ya usa un CRM o software de gestión de pacientes");
  }

  return signals;
}

/** Indicios de cadena, policlínica o multiproyecto. */
const CHAIN_PATTERNS = [
  // Señales estructurales: varias sedes o formato de multicentro.
  /n\s*\d+\s*(?:cl[ií]nicas|centros|sedes|consultas)\s+en/i,
  /\d+\s*(?:cl[ií]nicas|centros|sedes)\s+en\s+(?:toda|distintas|diferentes|varias)/i,
  /nuestras\s+\d+\s+(?:cl[ií]nicas|sedes|centros|consultas)/i,
  /(?:cl[ií]nicas|centros|sedes)\s+en\s+\d+\s+ciudades/i,
  /centros en toda/i,
  /sucursales/i,
  /pr[óo]ximamente en .{0,30}(?:cl[ií]nica|centro|sede|consulta)/i,
  /multicentro/i,
  /policl[ií]nica/i,
  /grupo cl[ií]nico/i,
  /grupo m[eé]dico/i,
  /nuestro equipo de \d+ profesionales/i,
  /franquicia/i,
];

/** Indicios de consulta privada de un solo profesional. */
const SOLO_PATTERNS = [
  /consulta privada/i,
  /en mi consulta/i,
  /mi consulta/i,
  /desde mi domicilio/i,
  /profesional(?:es)? (?:independiente|aut[óo]nomo)/i,
  /trabajo por mi cuenta/i,
  /aut[óo]nomo/i,
  /en casa del paciente/i,
];

/** Indicios de trabajo a domicilio. */
const HOME_VISIT_PATTERNS = [
  /fisioterapia a domicilio/i,
  /a domicilio/i,
  /en tu casa/i,
  /en su casa/i,
  /visitas a domicilio/i,
  /domicilio del paciente/i,
];

/** Crawler de webs de negocio. */
export class BusinessWebsiteCrawler implements WebsiteCrawler {
  readonly name = "website";

  async crawl(website: string): Promise<WebsiteContactResult> {
    const empty: WebsiteContactResult = {
      website: null,
      domain: null,
      emails: [],
      phoneNumbers: [],
      contactPageUrl: null,
      teamMembers: [],
      description: null,
      address: null,
      city: null,
      region: null,
      signals: [],
    };

    let base: string;
    try {
      base = new URL(website.startsWith("http") ? website : `https://${website}`).toString();
    } catch {
      return empty;
    }

    const home = await fetchPage(base);
    if (!home) {
      return { ...empty, website, domain: safeDomain(website), signals: ["No se pudo cargar la web"] };
    }

    const emails = new Set<string>();
    const phones = new Set<string>();
    const teamMembers: { name: string; role: string | null; page: string }[] = [];
    const signals = new Set<string>();
    let description: string | null = null;
    let address: string | null = null;
    let city: string | null = null;
    let region: string | null = null;
    let contactPageUrl: string | null = null;
    let teamPageUrl: string | null = null;

    const pages: CrawledPage[] = [home];
    let current = home;
    let $ = cheerio.load(current.html);

    // 1) Extraer datos de la home.
    collectFromPage($, current, {
      emails,
      phones,
      teamMembers,
      signals,
      isHome: true,
      setDescription: (value) => {
        description = value;
      },
      setAddress: (value) => {
        address = value;
      },
      setCity: (value) => {
        city = value;
      },
      setRegion: (value) => {
        region = value;
      },
      setContactPage: (value) => {
        contactPageUrl = value;
      },
      setTeamPage: (value) => {
        teamPageUrl = value;
      },
    });

    // 2) Localizar páginas de equipo y de contacto.
    const links = collectLinks($, current.url);
    const teamCandidates = links
      .filter((link) => TEAM_HINTS.some((hint) => link.toLowerCase().includes(hint)))
      .slice(0, MAX_TEAM_PAGES);

    const contactCandidate =
      links.find((link) => CONTACT_HINTS.some((hint) => link.toLowerCase().includes(hint))) ?? null;

    const queue: string[] = [];
    if (teamPageUrl) queue.push(teamPageUrl);
    else queue.push(...teamCandidates);
    if (contactPageUrl) queue.push(contactPageUrl);
    else if (contactCandidate) queue.push(contactCandidate);

    // 3) Descargar como máximo MAX_PAGES en total.
    let visited = 1;
    for (const url of queue) {
      if (visited >= MAX_PAGES) break;
      if (pages.some((page) => page.url === url)) continue;
      const page = await fetchPage(url);
      if (!page) continue;
      visited += 1;
      pages.push(page);
      current = page;
      $ = cheerio.load(current.html);
      collectFromPage($, current, {
        emails,
        phones,
        teamMembers,
        signals,
        isHome: false,
        setDescription: (value) => {
          if (!description) description = value;
        },
        setAddress: (value) => {
          if (!address) address = value;
        },
        setCity: (value) => {
          if (!city) city = value;
        },
        setRegion: (value) => {
          if (!region) region = value;
        },
        setContactPage: (value) => {
          if (!contactPageUrl) contactPageUrl = value;
        },
        setTeamPage: (value) => {
          if (!teamPageUrl) teamPageUrl = value;
        },
      });
    }

    // 4) LinkedIn y emails de las páginas de equipo.
    const linkedinUrls = new Set<string>();
    for (const page of pages) {
      const page$ = cheerio.load(page.html);
      page$("a[href*='linkedin.com']").each((_i, element) => {
        const href = page$(element).attr("href");
        if (!href) return;
        const match = href.match(/linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+/i);
        if (match) linkedinUrls.add(`https://www.linkedin.com/${match[0].split("linkedin.com/")[1]}`);
      });
    }
    if (linkedinUrls.size > 0) {
      signals.add(`Perfiles de LinkedIn encontrados (${linkedinUrls.size})`);
    }

    // El equipo se limita y se deduplica: una cadena puede tener setenta
    // profesionales y no sirve de nada arrastrarlos todos a la lista.
    const uniqueTeam: { name: string; role: string | null; page: string }[] = [];
    const seenTeam = new Set<string>();
    for (const member of teamMembers) {
      const key = member.name.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seenTeam.has(key)) continue;
      seenTeam.add(key);
      uniqueTeam.push(member);
      if (uniqueTeam.length >= MAX_TEAM_MEMBERS) break;
    }

    return {
      website: pages[0]?.url ?? website,
      domain: safeDomain(pages[0]?.url ?? website),
      emails: [...emails],
      phoneNumbers: [...phones],
      contactPageUrl,
      teamMembers: uniqueTeam,
      description,
      address,
      city,
      region,
      signals: [...signals],
    };
  }
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type PageSinks = {
  emails: Set<string>;
  phones: Set<string>;
  teamMembers: { name: string; role: string | null; page: string }[];
  /** true en la primera página visitada (la home del negocio). */
  isHome: boolean;
  signals: Set<string>;
  setDescription: (value: string) => void;
  setAddress: (value: string) => void;
  setCity: (value: string) => void;
  setRegion: (value: string) => void;
  setContactPage: (value: string) => void;
  setTeamPage: (value: string) => void;
};

/** Extrae todo lo posible de una página. */
function collectFromPage($: cheerio.CheerioAPI, page: CrawledPage, sinks: PageSinks): void {
  for (const email of extractEmails(page.html, $)) sinks.emails.add(email);

  // Teléfonos: texto visible + enlaces tel:
  const text = $.root().text().replace(/\s+/g, " ");
  for (const phone of extractPhones(text)) sinks.phones.add(phone);
  $("a[href^='tel:'], a[href^='Tel:']").each((_i, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const phone = normalizePhone(href.replace(/^tel:/i, ""));
    if (phone) sinks.phones.add(phone);
  });

  // Descripción.
  const metaDescription =
    $("meta[name='description']").attr("content") ??
    $("meta[property='og:description']").attr("content") ??
    null;
  if (metaDescription) sinks.setDescription(metaDescription.trim());

  // JSON-LD.
  const jsonLd = extractJsonLd($);
  const ld = addressFromJsonLd(jsonLd);
  if (ld.address) sinks.setAddress(ld.address);
  if (ld.city) sinks.setCity(ld.city);
  if (ld.region) sinks.setRegion(ld.region);
  if (ld.telephone) {
    const phone = normalizePhone(ld.telephone);
    if (phone) sinks.phones.add(phone);
  }
  for (const employee of ld.employees) {
    sinks.teamMembers.push({ ...employee, page: page.url });
  }

  // Meta og / locality.
  const ogLocality = $("meta[property='og:locality']").attr("content");
  if (ogLocality) sinks.setCity(ogLocality.trim());
  const ogRegion = $("meta[property='og:region']").attr("content");
  if (ogRegion) sinks.setRegion(ogRegion.trim());

  // Equipo. Se guarda la página de origen: un nombre visto en "Quiénes somos"
  // es un profesional; el mismo nombre en un testimonio de la home, no.
  for (const member of extractTeamMembers($)) {
    sinks.teamMembers.push({ ...member, page: page.url });
  }

  // Enlaces de contacto / equipo.
  const links = collectLinks($, page.url);
  const contact = links.find((link) => CONTACT_HINTS.some((hint) => link.toLowerCase().includes(hint)));
  if (contact) sinks.setContactPage(contact);
  const team = links.find((link) => TEAM_HINTS.some((hint) => link.toLowerCase().includes(hint)));
  if (team) sinks.setTeamPage(team);

  // Señales.
  for (const signal of detectSignals(page.html, page.url, sinks.isHome)) sinks.signals.add(signal);
}

/** Links absolutos de la página (mismo host). */
function collectLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  const baseHost = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  $("a[href]").each((_i, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      return;
    }
    try {
      const absolute = new URL(href, baseUrl);
      if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;
      const host = absolute.hostname.replace(/^www\./, "");
      if (baseHost && host !== baseHost) return;
      const clean = absolute.toString().split("#")[0] ?? absolute.toString();
      if (!links.includes(clean)) links.push(clean);
    } catch {
      // URL inválida: se ignora.
    }
  });
  return links;
}

export const websiteCrawler: WebsiteCrawler = new BusinessWebsiteCrawler();

/** Atajo funcional del crawler. */
export async function crawlWebsite(website: string): Promise<WebsiteContactResult> {
  return websiteCrawler.crawl(website);
}
