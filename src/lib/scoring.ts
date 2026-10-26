import type { IcpCriterion } from "./types";
import type { LeadScore } from "./providers/contract";

/**
 * Scoring ICP determinista (sin LLM) para que el usuario pueda entender
 * exactamente por qué un lead puntúa X. El LLM puede refinar el "fit notes",
 * pero el número siempre viene de aquí.
 */

export type ScoreContext = {
  title: string | null;
  company: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  employees: number | null;
  /** Nº de profesionales detectados en la web (0 si no se pudo saber). */
  teamSize: number;
  /** La web delata una cadena, policlínica o multiproyecto. */
  chainLike: boolean;
  /** Consulta privada de un solo profesional. */
  soloPractice: boolean;
  /** Trabaja a domicilio. */
  homeVisits: boolean;
  /** Atiende sin recepción ni personal de apoyo. */
  soloWithoutReception: boolean;
  /** Gestiona las citas a mano (teléfono, WhatsApp, papel). */
  manualAgenda: boolean;
  /** Ya usa un CRM o software de gestión de pacientes. */
  hasCrm: boolean;
  /** El perfil (cargo, empresa o sector) es del sector salud. */
  sectorMatch: boolean;
  /** Es una plataforma/directorio de citas, no un profesional. */
  isPlatform: boolean;
  hasWebsite: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedIn: boolean;
  usesExternalBooking: boolean;
  noWebsite: boolean;
  /** Nº de reseñas en Google Maps (null si el negocio no viene de Maps). */
  mapsReviews: number | null;
  /** Valoración media en Google Maps (null si no viene de Maps). */
  mapsRating: number | null;
  signals: string[];
};

const OWNER_WORDS = [
  "dueño",
  "duena",
  "director",
  "directora",
  "fundador",
  "fundadora",
  "propietari",
  "responsable",
  "coordinador",
  "coordinadora",
  "gerente",
  "principal",
  "owner",
  "founder",
  "ceo",
  "administrador",
];

/**
 * Palabras que identifican un perfil clínico/sanitario.
 *
 * Se incluyen las formas en inglés porque el sector se etiqueta a menudo así
 * ("physiotherapist", "dentist") y con sólo las formas en español ("fisioterapeut")
 * se perdían más de la mitad de los prospectos: una clínica llamada
 * "Fisioterapia Puerta del Sol" quedaba como "no es del sector salud".
 */
const CLINICAL_WORDS = [
  // --- Español ---
  "fisioterapeut",
  "fisioterapia",
  "fisio",
  "nutricion",
  "dietista",
  "psicolog",
  "osteopat",
  "logoped",
  "odontolog",
  "podolog",
  "traumatolog",
  "quiropract",
  "acupunct",
  "homeopat",
  "medic",
  "ginecolog",
  "urolog",
  "dermatolog",
  "pediatr",
  "enfermer",
  "farmac",
  "coach",
  "entrenador",
  "preparador",
  // --- Inglés (así se etiqueta el sector en muchas webs) ---
  "physiotherap",
  "nutritionist",
  "psycholog",
  "podiatrist",
  "dentist",
  "dental",
  "clinic",
];

/**
 * Páginas donde se lista el equipo de verdad. Un nombre que aparece aquí es
 * un profesional; el mismo nombre en un bloque de testimonios de la home, no.
 */
const TEAM_PAGE_RE =
  /equipo|profesional|quienes-somos|quienes-somos|nosotros|staff|medicos|doctores|terapeutas|especialistas|about-us|our-team/i;

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Etiquetas que se arrastran de la web y NO son un cargo real ("Contacto",
 * "Recepción"). Con ellas no se puede decir si el lead decide él mismo: el
 * criterio queda sin datos en lugar de darse por incumplido.
 */
const GENERIC_TITLE_WORDS = [
  "contacto",
  "contact",
  "info",
  "informacion",
  "atencion al cliente",
  "recepcion",
  "recepcionista",
  "administracion",
  "admin",
  "secretaria",
  "secretario",
  "web",
  "correo",
  "email",
  "telefono",
  "general",
  "sin cargo",
  "n a",
  "na",
  "none",
  "sin datos",
  "formulario",
  "soporte",
  "ayuda",
  "citas",
  "reserva",
  "reservas",
  "pedir cita",
  "consulta",
];

const GENERIC_TITLES = new Set(GENERIC_TITLE_WORDS.map((word) => norm(word)));

/**
 * ¿Hay información suficiente para evaluar este campo?
 *
 * Sin datos no se puede emitir un veredicto: el criterio queda "sin datos" y
 * ni suma ni penaliza. Antes un dato ausente se puntuaba igual que un "no
 * cumple", lo que hundía la puntuación de leads que simplemente no lo tenían.
 */
function hasData(field: string, ctx: ScoreContext): boolean {
  switch (field) {
    case "title": {
      const title = norm(ctx.title);
      return title.length > 0 && !GENERIC_TITLES.has(title);
    }
    case "company":
      return norm(ctx.company).length > 0;
    case "industry":
      return norm(ctx.industry).length > 0;
    case "city":
      return norm(ctx.city).length > 0;
    case "region":
      return norm(ctx.region).length > 0;
    case "employees":
      return ctx.employees !== null && ctx.employees !== undefined;
    case "signals":
      return ctx.signals.length > 0;
    case "mapsReviews":
      return ctx.mapsReviews !== null && ctx.mapsReviews !== undefined;
    case "mapsRating":
      return ctx.mapsRating !== null && ctx.mapsRating !== undefined;
    default:
      return true;
  }
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(/[,;|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function evaluateCriterion(criterion: IcpCriterion, ctx: ScoreContext): boolean {
  const { field, op, value } = criterion;
  const raw = (field: string): unknown => {
    switch (field) {
      case "title":
        return ctx.title;
      case "company":
        return ctx.company;
      case "industry":
        return ctx.industry;
      case "city":
        return ctx.city;
      case "region":
        return ctx.region;
      case "employees":
        return ctx.employees;
      case "teamSize":
        return ctx.teamSize;
      case "chainLike":
        return ctx.chainLike;
      case "soloPractice":
        return ctx.soloPractice;
      case "homeVisits":
        return ctx.homeVisits;
      case "soloWithoutReception":
        return ctx.soloWithoutReception;
      case "manualAgenda":
        return ctx.manualAgenda;
      case "hasCrm":
        return ctx.hasCrm;
      case "sectorMatch":
        return ctx.sectorMatch;
      case "isPlatform":
        return ctx.isPlatform;
      case "hasWebsite":
        return ctx.hasWebsite;
      case "hasEmail":
        return ctx.hasEmail;
      case "hasPhone":
        return ctx.hasPhone;
      case "hasLinkedIn":
        return ctx.hasLinkedIn;
      case "usesExternalBooking":
        return ctx.usesExternalBooking;
      case "noWebsite":
        return ctx.noWebsite;
      case "signals":
        return ctx.signals.join(" ");
      case "mapsReviews":
        return ctx.mapsReviews;
      case "mapsRating":
        return ctx.mapsRating;
      default:
        return undefined;
    }
  };

  const actual = raw(field);
  const actualStr = norm(actual);

  switch (op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "" && actual !== false;
    case "not_exists":
      return actual === undefined || actual === null || actual === "" || actual === false;
    case "equals":
      return actualStr === norm(value);
    case "not_equals":
      return actualStr !== norm(value);
    case "contains":
      return actualStr.includes(norm(value));
    case "not_contains":
      return !actualStr.includes(norm(value));
    case "in":
      return asArray(value).map(norm).includes(actualStr);
    case "not_in":
      return !asArray(value).map(norm).includes(actualStr);
    case "gt":
      return Number(actual) > Number(value);
    case "gte":
      return Number(actual) >= Number(value);
    case "lt":
      return Number(actual) < Number(value);
    case "lte":
      return Number(actual) <= Number(value);
    case "regex":
      try {
        return new RegExp(String(value), "i").test(String(actual ?? ""));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Pares de criterios que son el reverso el uno del otro. Si uno se ha
 * cumplido, no tiene sentido decir "no detectado" del otro: "tiene web" y
 * "sin web" no pueden contarse a la vez en la misma explicación.
 */
const COMPLEMENTARY_FIELDS: Record<string, string> = {
  hasWebsite: "noWebsite",
  noWebsite: "hasWebsite",
};

export function scoreLead(
  ctx: ScoreContext,
  criteria: IcpCriterion[],
  options?: { base?: number; positiveWeight?: number; negativeWeight?: number },
): LeadScore {
  const base = options?.base ?? 22;
  const positive = options?.positiveWeight ?? 10;
  const negative = options?.negativeWeight ?? 3;

  let score = base;
  const matched: string[] = [];
  const missed: string[] = [];
  const missedFields: string[] = [];
  const matchedFields = new Set<string>();
  const unknown: string[] = [];
  const excluded: string[] = [];

  for (const criterion of criteria) {
    const weight = criterion.weight ?? positive;
    const label =
      criterion.label ?? `${criterion.field} ${criterion.op}${criterion.value !== undefined ? ` ${criterion.value}` : ""}`;

    // Peso negativo = criterio de exclusión: sólo resta si se cumple.
    if (weight < 0) {
      if (evaluateCriterion(criterion, ctx)) {
        score += weight;
        excluded.push(label);
      }
      continue;
    }

    // Sin datos no hay veredicto: ni suma ni penaliza.
    if (!hasData(criterion.field, ctx)) {
      unknown.push(label);
      continue;
    }

    if (evaluateCriterion(criterion, ctx)) {
      score += weight;
      matched.push(label);
      matchedFields.add(criterion.field);
    } else {
      score -= criterion.penalty ?? negative;
      missed.push(label);
      missedFields.push(criterion.field);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Se ocultan los criterios "no detectados" cuyo reverso ya se ha cumplido.
  const visibleMissed = missed.filter((_, index) => {
    const complement = COMPLEMENTARY_FIELDS[missedFields[index] ?? ""];
    return !complement || !matchedFields.has(complement);
  });

  const reason = [
    matched.length ? `Cumple: ${matched.slice(0, 3).join("; ")}` : "Sin criterios cumplidos",
    // "No detectado" = rasgo de tu ICP que NO hemos encontrado en este lead.
    // No significa que esté excluido: significa que no hemos visto prueba.
    visibleMissed.length ? `No detectado: ${visibleMissed.slice(0, 2).join("; ")}` : "",
    unknown.length ? `Sin datos: ${unknown.slice(0, 2).join("; ")}` : "",
    excluded.length ? `Excluido: ${excluded.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return { score, reason, matched, missed: visibleMissed, unknown, excluded };
}

/**
 * Criterios por defecto para AgendaOS: profesionales sanitarios independientes
 * en España. El señal más fuerte es "tiene web pero NO tiene agenda online
 * propia" — ese es exactamente el hueco que AgendaOS cubre.
 */
export function defaultAgendaosCriteria(): IcpCriterion[] {
  return [
    // --- Perfil profesional: autónomo o consulta pequeña ---
    {
      field: "sectorMatch",
      op: "equals",
      value: true,
      weight: 12,
      penalty: 4,
      label: "Perfil clínico/salud",
    },
    {
      field: "title",
      op: "contains",
      value: OWNER_WORDS.join("|"),
      weight: 9,
      penalty: 4,
      label: "Decide él mismo (dueño, director, autónomo)",
    },
    {
      field: "soloPractice",
      op: "equals",
      value: true,
      weight: 10,
      penalty: 3,
      label: "Consulta privada de un solo profesional",
    },
    {
      field: "homeVisits",
      op: "equals",
      value: true,
      weight: 7,
      penalty: 3,
      label: "Trabaja a domicilio",
    },
    {
      field: "soloWithoutReception",
      op: "equals",
      value: true,
      weight: 6,
      penalty: 3,
      label: "Atiende sin recepción ni apoyo",
    },
    {
      field: "teamSize",
      op: "lte",
      value: 2,
      weight: 7,
      penalty: 4,
      label: "Practica solo o con 1-2 profesionales",
    },

    // --- Grado de digitalización: aquí está la oportunidad ---
    {
      field: "manualAgenda",
      op: "equals",
      value: true,
      weight: 10,
      penalty: 3,
      label: "Gestiona las citas a mano (sin software)",
    },
    {
      field: "usesExternalBooking",
      op: "equals",
      value: true,
      weight: 6,
      penalty: 3,
      label: "Usa una agenda externa (oportunidad de captura)",
    },
    {
      field: "hasWebsite",
      op: "equals",
      value: true,
      weight: 3,
      penalty: 2,
      label: "Tiene web",
    },
    {
      field: "noWebsite",
      op: "equals",
      value: true,
      weight: 4,
      penalty: 2,
      label: "Sin web (necesita presencia digital)",
    },

    // --- Contactabilidad ---
    {
      field: "hasEmail",
      op: "equals",
      value: true,
      weight: 9,
      penalty: 3,
      label: "Email de contacto disponible",
    },
    {
      field: "hasPhone",
      op: "equals",
      value: true,
      weight: 5,
      penalty: 2,
      label: "Teléfono disponible",
    },
    {
      field: "employees",
      op: "lte",
      value: 10,
      weight: 5,
      penalty: 2,
      label: "Negocio pequeño (1-10 empleados)",
    },
    {
      field: "region",
      op: "equals",
      value: "Madrid",
      weight: 5,
      penalty: 2,
      label: "Zona objetivo Madrid",
    },

    // --- Demanda demostrable (sólo si el negocio viene de Google Maps) ---
    // Un criterio sin datos no puntúa ni penaliza, así que esto no altera la
    // puntuación de los leads que no proceden de Maps.
    {
      field: "mapsReviews",
      op: "gte",
      value: 20,
      weight: 6,
      penalty: 0,
      label: "Tiene demanda real (20+ reseñas en Google)",
    },
    {
      field: "mapsRating",
      op: "gte",
      value: 4,
      weight: 3,
      penalty: 0,
      label: "Bien valorado por sus pacientes (4+ estrellas)",
    },

    // --- Exclusiones: si se cumplen, el lead no es para nosotros ---
    {
      field: "isPlatform",
      op: "equals",
      value: true,
      weight: -40,
      penalty: 0,
      label: "Es una plataforma de citas, no un profesional",
    },
    {
      field: "chainLike",
      op: "equals",
      value: true,
      weight: -26,
      penalty: 0,
      label: "Es una cadena o policlínica",
    },
    {
      field: "hasCrm",
      op: "equals",
      value: true,
      weight: -18,
      penalty: 0,
      label: "Ya usa un CRM o software de pacientes",
    },
    {
      field: "teamSize",
      op: "gte",
      value: 4,
      weight: -14,
      penalty: 0,
      label: "Tiene equipo de 4+ profesionales",
    },
  ];
}

export function buildScoreContext(input: {
  title?: string | null;
  company?: { name?: string | null; industry?: string | null; city?: string | null; region?: string | null; employees?: number | null; website?: string | null } | null;
  email?: string | null;
  phoneNumber?: string | null;
  linkedinUrl?: string | null;
  enrichment?: Record<string, unknown> | null;
}): ScoreContext {
  const enrichment = input.enrichment ?? {};
  const signals = asArray(enrichment.signals);
  const usesExternalBooking =
    Boolean(enrichment.usesExternalBooking) ||
    signals.some((s) => /calendly|doctoralia|dontorres|simplybook|setmore|acuity|resalud|bcode|eideal|bookeo|nhs\.uk|online/i.test(s));
  const website = input.company?.website ?? enrichment.website ?? null;

  const teamMembers = Array.isArray(enrichment.teamMembers)
    ? (enrichment.teamMembers as unknown[])
    : [];
  // El tamaño del equipo se cuenta con los profesionales de verdad: los que
  // tienen cargo o los que aparecen en la página de equipo. Un testimonio de
  // paciente ("Paola Serrano, muy buen trato") no cuenta.
  const membersWithRole = teamMembers.filter(
    (member) =>
      typeof member === "object" &&
      member !== null &&
      Boolean((member as { role?: string | null }).role),
  ).length;
  const membersOnTeamPage = teamMembers.filter((member) =>
    TEAM_PAGE_RE.test(
      typeof member === "object" && member !== null
        ? String((member as { page?: string }).page ?? "")
        : "",
    ),
  ).length;
  const teamSize =
    membersWithRole > 0
      ? membersWithRole
      : membersOnTeamPage > 0
        ? membersOnTeamPage
        : Math.min(teamMembers.length, 3);
  const chainLike = signals.some((s) => /cadena|policl|multiproyecto|franquicia/i.test(s));
  const soloPractice = signals.some((s) => /consulta privada|solo profesional/i.test(s));
  const homeVisits = signals.some((s) => /domicilio/i.test(s));
  const soloWithoutReception = signals.some((s) => /sin recepci|sin personal de apoyo/i.test(s));
  const manualAgenda = signals.some((s) => /a mano|manual|por tel[eé]fono|whatsapp|papel/i.test(s));
  const hasCrm = signals.some((s) => /crm|software de gesti[óo]n|portal del paciente|historia cl[ií]nica/i.test(s));
  const platformHosts = [
    "doctoralia.es","fresha.com","dontorres.com","bcode.es","nubemedical.es","clinicuite.es",
    "barcelonahealth.com","salus.es","medicilio.es","einforma.com","axesor.es","empresite.",
    "infocif.es","opencare.es","eideal.es","simplybook.it","setmore.com","acuityscheduling.com",
    "calendly.com","calenda.com","resalud.es","sanitas.es","adidas.com","milunet.com",
  ];
  const companyDomain = (input.company?.website ?? "").toLowerCase();
  const isPlatform = platformHosts.some((host) => companyDomain.includes(host));

  // Datos de Google Maps (si el negocio viene de esa fuente).
  const mapsData =
    enrichment.maps && typeof enrichment.maps === "object"
      ? (enrichment.maps as Record<string, unknown>)
      : null;
  const mapsReviews = mapsData
    ? Number(mapsData.reviewCount ?? 0) || 0
    : null;
  const mapsRating = mapsData ? Number(mapsData.rating ?? 0) || 0 : null;

  const clinicalPattern = new RegExp(CLINICAL_WORDS.join("|"), "i");
  const sectorMatch =
    clinicalPattern.test(input.title ?? "") ||
    clinicalPattern.test(input.company?.name ?? "") ||
    clinicalPattern.test(input.company?.industry ?? "");

  return {
    title: input.title ?? null,
    company: input.company?.name ?? null,
    industry: input.company?.industry ?? null,
    city: input.company?.city ?? null,
    region: input.company?.region ?? null,
    employees: input.company?.employees ?? null,
    teamSize,
    chainLike,
    soloPractice,
    homeVisits,
    soloWithoutReception,
    manualAgenda,
    hasCrm,
    sectorMatch,
    isPlatform,
    hasWebsite: Boolean(website),
    hasEmail: Boolean(input.email),
    hasPhone: Boolean(input.phoneNumber),
    hasLinkedIn: Boolean(input.linkedinUrl),
    usesExternalBooking,
    noWebsite: !website,
    mapsReviews,
    mapsRating,
    signals,
  };
}

/** Perfil comercial del prospecto, según lo detectado en su web. */
export type ProspectProfile =
  | "autonomo"
  | "negocio_sin_crm"
  | "negocio_con_equipo"
  | "con_crm"
  | "cadena"
  | "plataforma"
  | "desconocido";

export const PROFILE_LABELS: Record<ProspectProfile, string> = {
  autonomo: "Profesional independiente",
  negocio_sin_crm: "Pequeño negocio sin CRM",
  negocio_con_equipo: "Pequeño negocio con equipo",
  con_crm: "Ya tiene CRM",
  cadena: "Cadena o policlínica",
  plataforma: "Plataforma de citas",
  desconocido: "Sin analizar",
};

export function detectProfile(ctx: ScoreContext): ProspectProfile {
  if (ctx.isPlatform) return "plataforma";
  // "Cadena" sólo si hay señales explícitas de varias sedes o franquicia.
  // Tener 4 profesionales en un centro NO es una cadena: es un negocio pequeño.
  if (ctx.chainLike) return "cadena";
  if (ctx.hasCrm) return "con_crm";
  if (ctx.teamSize >= 4) return "negocio_con_equipo";
  if (ctx.soloPractice || ctx.soloWithoutReception) return "autonomo";
  // Una o dos personas sin recepción ni equipo de apoyo: un autónomo.
  if (ctx.teamSize <= 1) return "autonomo";
  if (ctx.homeVisits) return "negocio_con_equipo";
  if (ctx.manualAgenda) return "negocio_sin_crm";
  if (ctx.teamSize > 1) return "negocio_con_equipo";
  return "desconocido";
}
