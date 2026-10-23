import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envío real de email por SMTP. Solo se usa si la identidad tiene credenciales
 * configuradas; si no, la app encola el envío y devuelve el contenido para
 * que el usuario lo envíe manualmente (o copie/pegue).
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string | null;
  pass?: string | null;
  secure?: boolean;
};

export type SendResult = {
  ok: boolean;
  sent: boolean;
  messageId?: string;
  error?: string;
  queued: boolean;
};

const transporterCache = new Map<string, Transporter>();

function keyOf(cfg: SmtpConfig) {
  // El modo de cifrado también entra en la clave: si el usuario prueba con
  // STARTTLS y luego guarda con SSL directo, no debe reutilizarse el
  // trasportador antiguo.
  return `${cfg.host}:${cfg.port}:${cfg.user ?? ""}:${cfg.secure ?? cfg.port === 465 ? "ssl" : "starttls"}`;
}

export function getTransporter(cfg: SmtpConfig): Transporter {
  const key = keyOf(cfg);
  const cached = transporterCache.get(key);
  if (cached) return cached;
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  transporterCache.set(key, transporter);
  return transporter;
}

export async function sendEmail(opts: {
  from: { name?: string | null; email: string };
  to: { name?: string | null; email: string };
  subject: string;
  body: string;
  replyTo?: string | null;
  smtp?: SmtpConfig | null;
  html?: string | null;
}): Promise<SendResult> {
  if (!opts.smtp?.host) {
    return {
      ok: false,
      sent: false,
      queued: true,
      error: "Sin SMTP configurado: el mensaje se ha guardado para revisión manual.",
    };
  }
  try {
    const transporter = getTransporter(opts.smtp);
    const info = await transporter.sendMail({
      from: { name: opts.from.name ?? "", address: opts.from.email },
      to: { name: opts.to.name ?? "", address: opts.to.email },
      subject: opts.subject,
      text: opts.body,
      html: opts.html ?? undefined,
      replyTo: opts.replyTo ?? undefined,
    });
    return { ok: true, sent: true, queued: false, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, sent: false, queued: false, error: message };
  }
}

export async function verifySmtp(cfg: SmtpConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = getTransporter(cfg);
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
