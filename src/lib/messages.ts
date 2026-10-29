import { completeText, completeJson as aiCompleteJson } from "./ai";
import { parseJson, type IcpCriterion } from "./types";

/**
 * Capa de generación de mensajes. Usa el proveedor de IA que esté
 * configurado en Ajustes (por defecto MiniMax, con la sesión del runtime
 * local), con fallback determinista por plantilla para que la app nunca se
 * quede sin salida aunque el modelo falle.
 */

/**
 * Envoltura fina sobre el cliente de IA. Devuelve null si el modelo falla:
 * quien llama tiene siempre un plan B (plantilla fija).
 */
export async function llmCompleteJson<T>(
  messages: { role: "system" | "user"; content: string }[],
  hint?: string,
): Promise<T | null> {
  try {
    return await aiCompleteJson<T>(
      messages.map((m) => `${m.role === "system" ? m.content + "\n\n" : ""}${m.content}`).join("\n"),
      { maxTokens: 4000, temperature: 0.3 },
    );
  } catch (err) {
    console.error("[llm] completeJson falló", err);
    return null;
  }
}

export async function llmComplete(
  messages: { role: "system" | "user"; content: string }[],
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string | null> {
  try {
    return await completeText(
      messages.map((m) => ({ role: m.role, content: m.content })),
      { maxTokens: opts?.maxTokens ?? 1200, temperature: opts?.temperature ?? 0.5 },
    );
  } catch (err) {
    console.error("[llm] complete falló", err);
    return null;
  }
}

/* ---------- Variables de plantilla ---------- */

export type TemplateVars = Record<string, string>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export type MessageContext = {
  lead: {
    fullName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    jobTitle?: string | null;
    city?: string | null;
    region?: string | null;
    website?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    linkedinUrl?: string | null;
    enrichment?: Record<string, unknown> | null;
    notes?: string | null;
  };
  company: {
    name?: string | null;
    website?: string | null;
    industry?: string | null;
    city?: string | null;
    region?: string | null;
    description?: string | null;
    employees?: number | null;
    enrichment?: Record<string, unknown> | null;
  } | null;
  playbook: {
    ourCompany?: string | null;
    ourOffer?: string | null;
    ourValue?: string | null;
    icpSummary?: string | null;
    proofPoints?: string | string[] | null;
    disqualified?: string | string[] | null;
    tone?: string | null;
    language?: string | null;
    cta?: string | null;
    signature?: string | null;
  };
  identity?: { name?: string | null; email?: string | null; linkedinUrl?: string | null } | null;
};

function firstNameOf(ctx: MessageContext): string {
  if (ctx.lead.firstName) return ctx.lead.firstName;
  if (ctx.lead.fullName) return ctx.lead.fullName.split(/\s+/)[0];
  return "";
}

function asList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = parseJson<string[]>(value, []);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fallthrough */
  }
  return value
    .split(/[;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function buildVariables(ctx: MessageContext): TemplateVars {
  const pb = ctx.playbook;
  const signals = Array.isArray(ctx.lead.enrichment?.signals)
    ? (ctx.lead.enrichment?.signals as string[])
    : Array.isArray(ctx.company?.enrichment?.signals)
      ? (ctx.company?.enrichment?.signals as string[])
      : [];

  return {
    firstName: firstNameOf(ctx),
    fullName: ctx.lead.fullName ?? "",
    lastName: ctx.lead.lastName ?? "",
    jobTitle: ctx.lead.jobTitle ?? "",
    company: ctx.company?.name ?? "",
    companyWebsite: ctx.company?.website ?? "",
    city: ctx.lead.city ?? ctx.company?.city ?? "",
    region: ctx.lead.region ?? ctx.company?.region ?? "",
    website: ctx.lead.website ?? ctx.company?.website ?? "",
    phone: ctx.lead.phoneNumber ?? "",
    linkedin: ctx.lead.linkedinUrl ?? "",
    signals: signals.join(", "),
    ourCompany: pb.ourCompany ?? "AgendaOS",
    ourOffer: pb.ourOffer ?? "",
    ourValue: pb.ourValue ?? "",
    proofPoints: asList(pb.proofPoints).join("; "),
    cta: pb.cta ?? "",
    tone: pb.tone ?? "profesional y cercano",
    language: pb.language ?? "es",
    senderName: ctx.identity?.name ?? "",
    senderEmail: ctx.identity?.email ?? "",
    senderCompany: pb.ourCompany ?? "AgendaOS",
    signature: pb.signature ?? "",
  };
}

const SYSTEM_PROMPT = `Eres un vendedor B2B experto en español que escribe emails de prospección en frío a PROFESIONALES AUTÓNOMOS E INDEPENDIENTES del sector salud en España (fisioterapeutas, nutricionistas, dentistas y psicólogos). Tu destinatario NO es una empresa: es una persona que trabaja por su cuenta, atiende a sus pacientes y gestiona sus citas él mismo.

Reglas estrictas:
- Habla de SU día a día: la agenda con huecos, los recordatorios que tiene que mandar a mano, los pacientes que no se presentan, los cobros que se pierden, el tiempo que le roba administración.
- NO hables de "tu equipo", "tu personal", "tus clínicas", "vuestra empresa" ni de gestión de personal: es un profesional solo. Usa "tu consulta", "tus pacientes", "cuando atiendes".
- Trátale de tú y con respeto de igual a igual: es un profesional, no un empleado.
- Responde SIEMPRE en español de España, tono natural y respetuoso, como un colega que entiende el día a día del negocio.
- Nunca uses clichés de IA (no "en el mundo actual", "es un placer", "quedo a su entera disposición", "espero que este mensaje le encuentre bien").
- Escribe en español de España y no uses anglicismos ni palabras en inglés (nada de "streamline", "feedback", "meeting", "follow-up"): di "facilitar", "agenda", "reunión", "seguimiento".
- Saluda con el nombre de pila (la primera palabra del nombre), no con los apellidos: "Hola Elena,". Si no hay nombre, "Hola,".
- Ve al grano: una frase de contexto observada, el beneficio concreto, una llamada a la acción suave.
- Máximo 120 palabras en el cuerpo del email. Sin emojis. Sin listas de bullets salvo 2-3 puntos muy cortos.
- NO inventes datos: si no sabes el nombre del destinatario, usa "Hola" y no un nombre inventado.
- No prometas resultados concretos que no estén en los datos del playbook.`;

export type GeneratedMessage = {
  subject: string;
  body: string;
  source: "llm" | "template";
  rationale?: string;
};

function fallbackMessage(ctx: MessageContext, vars: TemplateVars): GeneratedMessage {
  const greeting = vars.firstName ? `Hola ${vars.firstName},` : "Hola,";
  const value = vars.ourValue || "gestionar tus citas online sin perder tiempo entre pacientes";
  const subject = `${vars.company ? `Agenda online para ${vars.company}` : "Agenda online sin complicaciones"}`;
  const body = [
    greeting,
    "",
    `Te escribo para presentarte una forma de simplificar la gestión de citas.`,
    `En ${vars.ourCompany} puedes ${value}.`,
    vars.cta ? `Si te interesa, ${vars.cta}` : `Si te interesa, te enseño cómo funciona en 10 minutos.`,
    "",
    vars.signature,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return { subject, body, source: "template" };
}

export async function generateEmailMessage(
  ctx: MessageContext,
  opts?: { subjectTemplate?: string | null; bodyTemplate?: string | null; stepName?: string | null; aiEnabled?: boolean },
): Promise<GeneratedMessage> {
  const vars = buildVariables(ctx);

  if (opts?.aiEnabled !== false) {
    const facts = [
      `Destinatario: ${ctx.lead.fullName ?? "(desconocido)"}${ctx.lead.jobTitle ? ` — ${ctx.lead.jobTitle}` : ""}`,
      ctx.company?.name ? `Empresa: ${ctx.company.name}` : null,
      ctx.company?.city || ctx.lead.city ? `Ciudad: ${ctx.company?.city ?? ctx.lead.city}` : null,
      ctx.company?.description ? `Sobre la empresa: ${ctx.company.description}` : null,
      ctx.company?.website ? `Web: ${ctx.company.website}` : null,
      ctx.lead.website ? `Web del profesional: ${ctx.lead.website}` : null,
      `Señales detectadas: ${vars.signals || "ninguna"}`,
      `Nuestro producto: ${vars.ourCompany} — ${vars.ourOffer || vars.ourValue}`,
      vars.proofPoints ? `Pruebas: ${vars.proofPoints}` : null,
      vars.cta ? `CTA sugerido: ${vars.cta}` : null,
      `Tono: ${vars.tone}`,
      opts?.stepName ? `Tipo de paso de la secuencia: ${opts.stepName}` : null,
      opts?.subjectTemplate ? `Asunto de referencia: ${renderTemplate(opts.subjectTemplate, vars)}` : null,
      opts?.bodyTemplate ? `Borrador de referencia: ${renderTemplate(opts.bodyTemplate, vars)}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const parsed = await llmCompleteJson<{
      subject?: string;
      body?: string;
      rationale?: string;
    }>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Genera un email de prospección en frío. Usa el asunto y borrador de referencia si existen, pero elimina las afirmaciones sobre el destinatario que no estén verificadas en los datos. No inventes hechos.\n\n${facts}\n\nDevuelve JSON: {"subject": string, "body": string, "rationale": string}`,
        },
      ],
    );
    if (parsed?.body && parsed.body.trim().length > 20) {
      return {
        subject: (parsed.subject || "Sin asunto").trim(),
        body: parsed.body.trim(),
        rationale: parsed.rationale,
        source: "llm",
      };
    }
  }

  const fallback = fallbackMessage(ctx, vars);
  if (opts?.subjectTemplate) fallback.subject = renderTemplate(opts.subjectTemplate, vars);
  if (opts?.bodyTemplate) fallback.body = renderTemplate(opts.bodyTemplate, vars);
  return fallback;
}

export async function generateLinkedInMessage(ctx: MessageContext, opts?: { aiEnabled?: boolean; bodyTemplate?: string | null }): Promise<string> {
  const vars = buildVariables(ctx);
  if (opts?.aiEnabled !== false) {
    const parsed = await llmCompleteJson<{ message?: string }>([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Genera un mensaje de LinkedIn (NOTA de conexión o primer mensaje, máximo 300 caracteres, en español, sin emojis, sin enlaces).\n\nDestinatario: ${ctx.lead.fullName ?? "(desconocido)"}${ctx.lead.jobTitle ? `, ${ctx.lead.jobTitle}` : ""}${ctx.company?.name ? `, en ${ctx.company.name}` : ""}\nNuestro producto: ${vars.ourCompany} — ${vars.ourOffer || vars.ourValue}\nTono: ${vars.tone}${opts?.bodyTemplate ? `\nBorrador de referencia: ${renderTemplate(opts.bodyTemplate, vars)}` : ""}\nNo afirmes hechos que no estén verificados.\n\nDevuelve JSON: {"message": string}`,
      },
    ]);
    if (parsed?.message?.trim()) return parsed.message.trim();
  }
  if (opts?.bodyTemplate) return renderTemplate(opts.bodyTemplate, vars);
  const who = ctx.lead.firstName ?? "";
  return `${who ? `${who}, ` : ""}te escribo para presentarte ${vars.ourCompany} y su agenda online. ¿Te enseño cómo funciona?`;
}

export async function generateResearchSummary(ctx: MessageContext): Promise<string | null> {
  try {
    const parsed = await llmCompleteJson<{
      summary?: string;
      fitNotes?: string;
      painPoints?: string[];
    }>([
      {
        role: "system",
        content:
          "Eres un analista de cuentas. Devuelves JSON {\"summary\": string, \"fitNotes\": string, \"painPoints\": string[]}. Responde en español, conciso y verificable: no inventes datos que no estén en el contexto.",
      },
      {
        role: "user",
        content: `Contexto del prospecto:\n${JSON.stringify(
          {
            lead: ctx.lead,
            company: ctx.company,
            playbook: { ourCompany: ctx.playbook.ourCompany, ourOffer: ctx.playbook.ourOffer },
          },
          null,
          1,
        )}`,
      },
    ]);
    if (!parsed) return null;
    return [parsed.summary, parsed.fitNotes].filter(Boolean).join(" — ") || null;
  } catch (err) {
    console.error("[messages] research summary falló", err);
    return null;
  }
}

export function criteriaFromPlaybook(raw: string): IcpCriterion[] {
  const parsed = parseJson<IcpCriterion[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}
