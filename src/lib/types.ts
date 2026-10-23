/**
 * Tipos de dominio compartidos.
 *
 * Nota: SQLite no soporta enums ni Json en Prisma, así que el dominio se
 * expresa como unions de string y el JSON se serializa como texto.
 */

export const LEAD_STATUSES = [
  "new",
  "researched",
  "contacted",
  "replied",
  "qualified",
  "unsubscribed",
  "bounced",
  "do_not_contact",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const STEP_TYPES = [
  "email",
  "linkedin_connect",
  "linkedin_message",
  "linkedin_like",
  "call",
  "wait",
  "condition",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const RECIPIENT_STATUSES = [
  "pending",
  "sending",
  "sent",
  "replied",
  "failed",
  "booked",
  "skipped",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const EMAIL_STATUSES = ["verified", "unverified", "invalid", "catch_all", "risky"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const CHANNELS = ["email", "linkedin", "call", "note"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Criterio de ICP usado por el scoring y el AI Finder. */
export type IcpCriterion = {
  field: string;
  op:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "in"
    | "not_in"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "exists"
    | "not_exists"
    | "regex";
  value?: string | number | boolean | string[];
  /** Puntos si el criterio se cumple. Negativo = criterio de exclusión. */
  weight?: number;
  /** Puntos si NO se cumple. 0 para criterios de exclusión. */
  penalty?: number;
  label?: string;
};

export type Json = Record<string, unknown>;

/* ---------- Helpers JSON sobre columnas String ---------- */

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/* ---------- Shapes de UI (serializables) ---------- */

export type LeadDTO = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
  website: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: LeadStatus;
  score: number;
  scoreReason: string | null;
  profile: string;
  fitNotes: string | null;
  source: string;
  aiSummary: string | null;
  notes: string | null;
  enrichment: Json;
  companyId: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companyDomain: string | null;
  emails: { email: string; status: string; source: string; confidence: number }[];
  listIds: string[];
  lastContactedAt: string | null;
  createdAt: string;
};

export type CompanyDTO = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
  size: string | null;
  employees: number | null;
  source: string;
  score: number;
  tags: string[];
  leadCount: number;
  createdAt: string;
};
