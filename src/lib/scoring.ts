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

const CLINICAL_WORDS = [  "fisioterapeut",
  "nutricion",
  "dietista",
  "psicolog",
  "osteopat",
  "logoped",
  "dentist",
  "podolog",
  "traumatolog",
  "quiropract",
  "acupunct",
  "homeopat",
  "coach",
  "entrenador",
  "preparador",
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

  for (const criterion of criteria) {
    const weight = criterion.weight ?? positive;
    const label =
      criterion.label ?? `${criterion.field} ${criterion.op}${criterion.value !== undefined ? ` ${criterion.value}` : ""}`;
    const ok = evaluateCriterion(criterion, ctx);
    if (ok) {
      // Un peso negativo = criterio de exclusión: cumplirlo resta.
      score += weight;
      matched.push(label);
    } else {
      // Los criterios de exclusión no penalizan cuando NO se cumplen.
      score -= criterion.penalty ?? negative;
      missed.push(label);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const reason = [
    matched.length ? `Cumple: ${matched.slice(0, 3).join("; ")}` : "Sin criterios cumplidos",
    missed.length ? `No cumple: ${missed.slice(0, 2).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return { score, reason, matched, missed };
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
