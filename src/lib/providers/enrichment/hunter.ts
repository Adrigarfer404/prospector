/**
 * Hunter.io — proveedor OPCIONAL de emails.
 *
 * Sólo se usa si existe `HUNTER_API_KEY`. Sin key devuelve `[]` en silencio:
 * la app debe funcionar siempre con las fuentes abiertas.
 */

import type { EmailCandidate, EmailProvider } from "../contract";
import { logRequestEnd, logRequestStart } from "../../request-logs";

const HUNTER_BASE = "https://api.hunter.io/v2";
const REQUEST_TIMEOUT_MS = 15_000;

type HunterEmail = {
  value?: string;
  type?: string;
  confidence?: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  department?: string;
};

type HunterResponse = {
  data?: {
    domain?: string;
    organization?: string;
    accept_all?: boolean;
    pattern?: string;
    emails?: HunterEmail[];
  };
  errors?: { message?: string }[];
};

/** ¿Hay clave de Hunter configurada? */
export function hasHunterKey(): boolean {
  const key = process.env.HUNTER_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export type HunterResult = {
  candidates: EmailCandidate[];
  organization: string | null;
  acceptAll: boolean;
};

/** Consulta la API de Hunter para un dominio. */
export async function hunterDomainSearch(
  domain: string,
  limit = 20,
): Promise<HunterResult> {
  const empty: HunterResult = { candidates: [], organization: null, acceptAll: false };
  const key = process.env.HUNTER_API_KEY?.trim();
  if (!key) return empty;

  const cleanDomain = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!cleanDomain) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${HUNTER_BASE}/domain-search?domain=${encodeURIComponent(cleanDomain)}&api_key=${encodeURIComponent(key)}&limit=${limit}`;
  const startedAt = logRequestStart("GET", url, "Hunter · búsqueda de dominio");
  let status: number | "ERROR" = "ERROR";
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "prospector/0.1" },
    });
    status = res.status;
    if (!res.ok) return empty;

    const parsed = (await res.json()) as HunterResponse;
    const emails = parsed.data?.emails ?? [];
    const candidates: EmailCandidate[] = [];

    for (const email of emails) {
      const value = email.value?.trim().toLowerCase();
      if (!value || !value.includes("@")) continue;
      const score = typeof email.confidence === "number" ? email.confidence : 50;
      candidates.push({
        email: value,
        source: `hunter:${email.type ?? "personal"}`,
        confidence: Math.min(100, Math.max(0, Math.round(score))),
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return {
      candidates,
      organization: parsed.data?.organization ?? null,
      acceptAll: parsed.data?.accept_all ?? false,
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
    logRequestEnd("GET", url, startedAt, status, "Hunter · búsqueda de dominio");
  }
}

/** EmailProvider basado en Hunter (opcional). */
export class HunterEmailProvider implements EmailProvider {
  readonly name = "hunter";

  async discover(input: {
    domain: string;
    fullName?: string | null;
    website?: string | null;
    knownEmails?: string[];
  }): Promise<EmailCandidate[]> {
    if (!hasHunterKey()) return [];
    const result = await hunterDomainSearch(input.domain);
    const known = new Set((input.knownEmails ?? []).map((email) => email.toLowerCase()));
    return result.candidates.filter((candidate) => !known.has(candidate.email));
  }

  async verify(email: string): Promise<import("../contract").EmailVerifyResult> {
    // Hunter no verifica buzones: se delega en la verificación SMTP.
    const { verifyEmail } = await import("./email");
    return verifyEmail(email);
  }
}

export const hunterEmailProvider: EmailProvider = new HunterEmailProvider();
