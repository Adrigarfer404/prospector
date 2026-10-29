import type {
  CampaignChannel,
  Channel,
  LeadStatus,
  StepType,
} from "./types";

/** Etiquetas en español para los estados del dominio. */

export const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Nuevo" },
  { value: "researched", label: "Investigado" },
  { value: "contacted", label: "Contactado" },
  { value: "replied", label: "Respondió" },
  { value: "qualified", label: "Cualificado" },
  { value: "unsubscribed", label: "Dado de baja" },
  { value: "bounced", label: "Rebotó" },
  { value: "do_not_contact", label: "No contactar" },
];

const LEAD_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

export function leadStatusLabel(status: string): string {
  return LEAD_STATUS_LABELS[status] ?? status;
}

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "En pausa",
  completed: "Completada",
};

export function campaignStatusLabel(status: string): string {
  return CAMPAIGN_STATUS_LABELS[status] ?? status;
}

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  sending: "Enviando",
  manual: "Pendiente de acción manual",
  sent: "Secuencia completada",
  replied: "Respondió",
  failed: "Error",
  booked: "Agendado",
  skipped: "Omitido",
};

export function recipientStatusLabel(status: string): string {
  return RECIPIENT_STATUS_LABELS[status] ?? status;
}

const EMAIL_STATUS_LABELS: Record<string, string> = {
  verified: "Verificado",
  unverified: "Sin verificar",
  invalid: "No válido",
  catch_all: "Catch-all",
  risky: "Posible rebote",
};

export function emailStatusLabel(status: string): string {
  return EMAIL_STATUS_LABELS[status] ?? status;
}

const STEP_TYPE_LABELS: Record<string, string> = {
  email: "Email",
  linkedin_connect: "Conexión LinkedIn",
  linkedin_message: "Mensaje LinkedIn",
  linkedin_like: "Like LinkedIn",
  call: "Llamada",
  wait: "Espera",
  condition: "Condición",
};

export function stepTypeLabel(type: string): string {
  return STEP_TYPE_LABELS[type] ?? type;
}

export const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "linkedin_connect", label: "Conexión LinkedIn" },
  { value: "linkedin_message", label: "Mensaje LinkedIn" },
  { value: "linkedin_like", label: "Like LinkedIn" },
  { value: "call", label: "Llamada" },
  { value: "wait", label: "Espera" },
  { value: "condition", label: "Condición" },
];

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  call: "Llamada",
  note: "Nota",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

const CAMPAIGN_CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  mixed: "Mixto",
};

export function campaignChannelLabel(channel: CampaignChannel | string): string {
  return CAMPAIGN_CHANNEL_LABELS[channel] ?? channel;
}

export const TASK_CHANNELS: { value: Channel; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "call", label: "Llamada" },
];

export function scoreTone(score: number): "green" | "amber" | "red" {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

/** Formatea una fecha ISO en formato español corto. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return formatDate(iso);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + second).toUpperCase();
}

export function displayName(
  lead: { fullName: string | null; companyName?: string | null },
): string {
  return lead.fullName?.trim() || lead.companyName?.trim() || "Sin nombre";
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}
