/**
 * Proveedor de emails: descubrimiento por patrón + verificación SMTP real.
 *
 * La verificación NUNCA envía ningún correo: sólo hace el handshake EHLO y la
 * consulta RCPT TO. Se usa `MAIL FROM:<>` (null sender) para no revelar una
 * dirección real.
 *
 * Sin librerías SMTP: sólo `node:dns` y `node:net`.
 */

import { promises as dns } from "node:dns";
import net from "node:net";
import type { EmailCandidate, EmailProvider, EmailVerifyResult } from "../contract";

/** TTL de la caché en memoria: 1 hora. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Timeout total de la verificación SMTP. */
const SMTP_TOTAL_TIMEOUT_MS = 10_000;
/** Timeout de conexión al MX. */
const SMTP_CONNECT_TIMEOUT_MS = 5_000;

/** Dominio que se anuncia en el EHLO (identifica al software cliente). */
const EHLO_DOMAIN = "agendaos.es";

/** Emails genéricos que suelen existir en negocios pequeñas. */
const GENERIC_LOCALS = ["info", "contacto", "hola", "admin", "contact", "administracion", "recepcion"];

export type EmailProviderOptions = {
  /** Domain ya normalizado (sin protocolo ni www). */
  domain: string;
  /** Nombre completo del lead, si se conoce. */
  fullName?: string | null;
  /** Emails ya conocidos (no se duplican). */
  knownEmails?: string[];
};

/** Normaliza un dominio. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.trim() ?? "";
}

/** Convierte "Sara Vidal Pérez" en ["sara", "vidal", "sara.vidal", ...]. */
function nameParts(fullName: string): {
  first: string;
  last: string;
  firstLast: string;
  firstInitialLast: string;
  firstLastInitial: string;
  firstInitialLastInitial: string;
} {
  const cleaned = fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split(" ").filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase();
  const second = (parts[1] ?? "").toLowerCase();
  const last = (parts.length > 2 ? parts[parts.length - 1] : second).toLowerCase();

  return {
    first,
    last,
    firstLast: `${first}.${last}`,
    firstInitialLast: `${first}.${last[0] ?? ""}`,
    firstLastInitial: `${first[0] ?? ""}.${last}`,
    firstInitialLastInitial: `${first[0] ?? ""}.${last[0] ?? ""}`,
  };
}

/** Descubre emails candidatos a partir del dominio y (opcionalmente) un nombre. */
export function discoverEmailsByPattern(input: EmailProviderOptions): EmailCandidate[] {
  const domain = normalizeDomain(input.domain);
  if (!domain || !domain.includes(".")) return [];

  const candidates: EmailCandidate[] = [];
  const seen = new Set<string>();
  const known = new Set((input.knownEmails ?? []).map((email) => email.toLowerCase()));

  const push = (email: string, source: string, confidence: number): void => {
    const normalized = email.toLowerCase().trim();
    if (!normalized || seen.has(normalized) || known.has(normalized)) return;
    if (!normalized.endsWith(`@${domain}`)) return;
    seen.add(normalized);
    candidates.push({ email: normalized, source, confidence });
  };

  if (input.fullName && input.fullName.trim().length > 2) {
    const parts = nameParts(input.fullName);
    if (parts.first && parts.last) {
      push(`${parts.first}@${domain}`, "patrón:nombre", 70);
      push(`${parts.firstLast}@${domain}`, "patrón:nombre.apellido", 80);
      push(`${parts.firstInitialLast}@${domain}`, "patrón:nombre.aapellido", 65);
      push(`${parts.firstLastInitial}@${domain}`, "patrón:n.apellido", 65);
      push(`${parts.firstInitialLastInitial}@${domain}`, "patrón:n.apellido", 50);
    }
  }

  for (const local of GENERIC_LOCALS) {
    push(`${local}@${domain}`, "patrón:genérico", 35);
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** Resuelve los registros MX del dominio. */
export async function resolveMx(domain: string): Promise<string[]> {
  const clean = normalizeDomain(domain);
  if (!clean) return [];
  try {
    const records = await dns.resolveMx(clean);
    return records
      .filter((record) => Number.isFinite(record.priority))
      .sort((a, b) => a.priority - b.priority)
      .map((record) => record.exchange);
  } catch {
    return [];
  }
}

type SmtpOutcome = {
  status: EmailVerifyResult["status"];
  reason: string;
  confidence: number;
};

/** Ejecuta el diálogo SMTP de verificación (nunca envía correo). */
async function smtpProbe(email: string, mxHost: string): Promise<SmtpOutcome> {
  return new Promise<SmtpOutcome>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let buffer = "";
    let stage: "connect" | "ehlo" | "mail" | "rcpt" = "connect";
    let rcptCode: number | null = null;
    let ehloMessage = "";
  
    const totalTimer = setTimeout(() => {
      finish({
        status: "unverified",
        reason: `Timeout de ${SMTP_TOTAL_TIMEOUT_MS / 1000}s durante la verificación SMTP.`,
        confidence: 20,
      });
    }, SMTP_TOTAL_TIMEOUT_MS);

    function finish(outcome: SmtpOutcome, graceful = false): void {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      socket.removeAllListeners();
      if (graceful) {
        // Deja que RSET/QUIT viajan antes de cerrar el socket.
        setTimeout(() => socket.destroy(), 150);
      } else {
        socket.destroy();
      }
      resolve(outcome);
    }

    socket.setTimeout(SMTP_CONNECT_TIMEOUT_MS);

    socket.on("timeout", () => {
      socket.destroy();
      finish({
        status: "unverified",
        reason: `Timeout de conexión con el servidor MX ${mxHost}.`,
        confidence: 15,
      });
    });

    socket.on("error", (error: Error) => {
      finish({
        status: "unverified",
        reason: `Error de red SMTP con ${mxHost}: ${error.message}`,
        confidence: 15,
      });
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // Respuestas SMTP multilínea: "250-..." seguido de "250 ...".
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/^(\d{3})([ -])(.*)$/);
        if (!match) continue;
        const code = Number(match[1]);
        const isLast = match[2] === " ";

        if (stage === "connect") {
          if (code === 220) {
            socket.write(`EHLO ${EHLO_DOMAIN}\r\n`);
            stage = "ehlo";
          } else if (code >= 400) {
            // El servidor rechaza la conexión (ACL, PTR inválido, grey-listing...).
            finish({
              status: "unverified",
              reason: `El servidor ${mxHost} rechazó la conexión (${code}): ${line.trim()}`,
              confidence: 15,
            });
          }
          continue;
        }

        if (stage === "ehlo") {
          if (code === 250) {
            ehloMessage = line;
            // MAIL FROM con null sender: no revela ninguna dirección real.
            socket.write("MAIL FROM:<>\r\n");
            stage = "mail";
          } else if (code === 421 || code === 450 || code === 451) {
            finish({
              status: "unverified",
              reason: `El servidor ${mxHost} no permite EHLO anónimo (${code}).`,
              confidence: 20,
            });
          }
          continue;
        }

        if (stage === "mail") {
          if (code === 250) {
            socket.write(`RCPT TO:<${email}>\r\n`);
            stage = "rcpt";
          } else {
            finish({
              status: "unverified",
              reason: `El servidor ${mxHost} rechazó MAIL FROM (${code}).`,
              confidence: 25,
            });
          }
          continue;
        }

        if (stage === "rcpt") {
          rcptCode = code;
          if (!isLast) continue;
          socket.write("RSET\r\n");
          socket.write("QUIT\r\n");
          resolveRcpt();
        }
      }
    });

    function resolveRcpt(): void {
      if (rcptCode === null) {
        finish({
          status: "unverified",
          reason: `El servidor ${mxHost} no respondió a RCPT TO.`,
          confidence: 20,
        });
        return;
      }
      if (rcptCode === 250 || rcptCode === 251) {
        finish(
          {
            status: "verified",
            reason: `RCPT TO aceptado (${rcptCode}) por ${mxHost}. El buzón existe.`,
            confidence: 95,
          },
          true,
        );
        return;
      }
      if (rcptCode === 550 || rcptCode === 551 || rcptCode === 553 || rcptCode === 554) {
        finish(
          {
            status: "invalid",
            reason: `RCPT TO rechazado (${rcptCode}) por ${mxHost}: el buzón no existe.`,
            confidence: 90,
          },
          true,
        );
        return;
      }
      if (rcptCode === 450 || rcptCode === 451 || rcptCode === 452) {
        finish(
          {
            status: "unverified",
            reason: `RCPT TO temporal (${rcptCode}) por ${mxHost}: respuesta transoria, no concluyente.`,
            confidence: 30,
          },
          true,
        );
        return;
      }
      finish(
        {
          status: "unverified",
          reason: `RCPT TO devolvió un código no concluyente (${rcptCode}) en ${mxHost}.`,
          confidence: 25,
        },
        true,
      );
    }

    socket.connect(25, mxHost, () => {
      socket.setTimeout(SMTP_TOTAL_TIMEOUT_MS);
    });

    // Nunca dejamos el socket abierto.
    socket.on("close", () => {
      if (!settled) {
        finish({
          status: "unverified",
          reason: `El servidor ${mxHost} cerró la conexión antes de responder (${ehloMessage || "sin EHLO"}).`,
          confidence: 20,
        });
      }
    });
  });
}

/** Verifica un email contra el MX del dominio (sin enviar nada). */
export async function verifyEmail(email: string): Promise<EmailVerifyResult> {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] ?? "";

  if (!normalized.includes("@") || !domain) {
    return {
      email: normalized,
      status: "invalid",
      confidence: 100,
      reason: "Formato de email inválido.",
    };
  }

  const mxHosts = await resolveMx(domain);
  if (mxHosts.length === 0) {
    return {
      email: normalized,
      status: "unverified",
      confidence: 20,
      reason: `El dominio ${domain} no tiene registros MX resolubles.`,
    };
  }

  let lastReason = `No se pudo contactar con ningún MX de ${domain}.`;
  for (const mx of mxHosts.slice(0, 3)) {
    const outcome = await smtpProbe(normalized, mx);
    if (outcome.status === "verified" || outcome.status === "invalid") {
      return { email: normalized, ...outcome };
    }
    lastReason = outcome.reason;
  }

  return {
    email: normalized,
    status: "unverified",
    confidence: 20,
    reason: lastReason,
  };
}

/** EmailProvider con caché en memoria (TTL 1h). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp-pattern";

  private readonly cache = new Map<string, { result: EmailVerifyResult; expiresAt: number }>();

  async discover(input: {
    domain: string;
    fullName?: string | null;
    website?: string | null;
    knownEmails?: string[];
  }): Promise<EmailCandidate[]> {
    return discoverEmailsByPattern({
      domain: input.domain,
      fullName: input.fullName,
      knownEmails: input.knownEmails,
    });
  }

  async verify(email: string): Promise<EmailVerifyResult> {
    const key = email.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const result = await verifyEmail(key);
    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }
}

export const emailProvider: EmailProvider = new SmtpEmailProvider();
