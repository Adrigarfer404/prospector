import { prisma } from "./db";
import { logActivity } from "./workspace";
import { sendEmail } from "./emailer";
import { generateEmailMessage, generateLinkedInMessage, type MessageContext } from "./messages";
import { parseJson } from "./types";

/**
 * Motor de secuencias multicanal. Cada paso puede ser email (envío real por
 * SMTP si hay credenciales), acción de LinkedIn o llamada (se generan como
 * tareas manuales para que el usuario las ejecute), espera o condición.
 *
 * El estado de cada destinatario avanza por los pasos; si responde, se para
 * la secuencia (stopOnReply).
 */

export type StepSettings = {
  condition?: { field: string; op: string; value?: unknown };
  linkedinAction?: "connect" | "message" | "like" | "comment";
  channel?: string;
};

export type RunSummary = {
  processed: number;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  messages: { leadName: string; subject: string; body: string; channel: string }[];
  errors: string[];
};

function hoursBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

export async function stepDue(
  recipient: { currentStep: number; lastSentAt: Date | null; createdAt: Date },
  step: { delayDays: number; delayHours: number },
  now = new Date(),
) {
  const anchor = recipient.lastSentAt ?? recipient.createdAt;
  const delayHours = step.delayDays * 24 + step.delayHours;
  return hoursBetween(anchor, now) >= delayHours;
}

export async function buildMessageContext(
  leadId: string,
): Promise<MessageContext | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { company: true },
  });
  if (!lead) return null;

  const workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
    include: { playbook: true, identities: true },
  });
  if (!workspace) return null;

  const identity = workspace.identities.find((i) => i.isDefault) ?? workspace.identities[0] ?? null;

  return {
    lead: {
      fullName: lead.fullName,
      firstName: lead.firstName,
      lastName: lead.lastName,
      jobTitle: lead.jobTitle,
      city: lead.city,
      region: lead.region,
      website: lead.website,
      email: lead.email,
      phoneNumber: lead.phoneNumber,
      linkedinUrl: lead.linkedinUrl,
      enrichment: parseJson(lead.enrichment, {}),
      notes: lead.notes,
    },
    company: lead.company
      ? {
          name: lead.company.name,
          website: lead.company.website,
          industry: lead.company.industry,
          city: lead.company.city,
          region: lead.company.region,
          description: lead.company.description,
          employees: lead.company.employees,
          enrichment: parseJson(lead.company.enrichment, {}),
        }
      : null,
    playbook: {
      ourCompany: workspace.playbook?.ourCompany ?? "AgendaOS",
      ourOffer: workspace.playbook?.ourOffer ?? null,
      ourValue: workspace.playbook?.ourValue ?? null,
      icpSummary: workspace.playbook?.icpSummary ?? null,
      proofPoints: workspace.playbook?.proofPoints ?? null,
      disqualified: workspace.playbook?.disqualified ?? null,
      tone: workspace.playbook?.tone ?? null,
      language: workspace.playbook?.language ?? "es",
      cta: workspace.playbook?.cta ?? null,
      signature: workspace.playbook?.signature ?? null,
    },
    identity: identity ? { name: identity.name, email: identity.email } : null,
  };
}

/**
 * Ejecuta los pasos pendientes de una campaña. Idempotente: sólo avanza a los
 * destinatarios cuyo siguiente paso ya ha vencido.
 */
export async function runCampaign(
  workspaceId: string,
  campaignId: string,
  options?: { limit?: number; force?: boolean },
): Promise<RunSummary> {
  const summary: RunSummary = {
    processed: 0,
    sent: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    messages: [],
    errors: [],
  };

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      steps: { orderBy: { order: "asc" } },
    },
  });
  if (!campaign) {
    summary.errors.push("Campaña no encontrada");
    return summary;
  }
  if (campaign.status !== "active" && !options?.force) {
    summary.errors.push("La campaña no está activa");
    return summary;
  }

  const identity = await prisma.identity.findFirst({
    where: { workspaceId, isDefault: true },
  });
  const smtp = identity?.smtpHost
    ? {
        host: identity.smtpHost,
        port: identity.smtpPort ?? 587,
        user: identity.smtpUser,
        pass: identity.smtpPass,
        secure: identity.smtpSecure,
      }
    : null;

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ["pending", "sending"] } },
    include: { lead: true },
    take: options?.limit ?? 50,
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();

  for (const recipient of recipients) {
    let currentStep = recipient.currentStep;
    let lastSentAt = recipient.lastSentAt;
    let sentCount = recipient.sentCount;
    let status = recipient.status;
    // Espera acumulada: los pasos "wait" retrasan al paso siguiente.
    let extraDelayHours = 0;

    // Se avanzan TODOS los pasos que ya han vencido: un paso "wait" no
    // consume el turno, así que encadenar email -> linkedin -> llamada en una
    // sola ejecución tiene sentido.
    for (;;) {
    const step = campaign.steps[currentStep];
    if (!step) {
      if (status !== "skipped") {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "skipped" },
        });
        summary.skipped += 1;
      }
      break;
    }

    if (
      !options?.force &&
      !(await stepDue(
        {
          currentStep,
          lastSentAt: lastSentAt
            ? new Date(lastSentAt.getTime() + extraDelayHours * 3_600_000)
            : null,
          createdAt: recipient.createdAt,
        },
        step,
        now,
      ))
    ) {
      break;
    }

    summary.processed += 1;

    try {
      const ctx = await buildMessageContext(recipient.leadId);
      if (!ctx) {
        summary.skipped += 1;
        continue;
      }

      const settings = parseJson<StepSettings>(step.settings, {});

      if (step.type === "email") {
        const message = await generateEmailMessage(ctx, {
          subjectTemplate: step.subject,
          bodyTemplate: step.body,
          stepName: step.name,
        });

        let sent = false;
        let error: string | undefined;

        if (recipient.lead.email && identity && smtp && campaign.autoSend) {
          const result = await sendEmail({
            from: { name: identity.name, email: identity.email },
            to: { name: recipient.lead.fullName, email: recipient.lead.email },
            subject: message.subject,
            body: message.body,
            replyTo: identity.email,
            smtp,
          });
          sent = result.sent;
          error = result.error;
        }

        await prisma.conversation.create({
          data: {
            workspaceId,
            leadId: recipient.leadId,
            campaignId,
            channel: "email",
            direction: "outbound",
            subject: message.subject,
            body: message.body,
            status: sent ? "closed" : "open",
            sentAt: sent ? new Date() : null,
          },
        });

        if (sent) {
          summary.sent += 1;
        } else {
          summary.queued += 1;
          if (error) summary.errors.push(`${recipient.lead.fullName ?? recipient.leadId}: ${error}`);
        }

        summary.messages.push({
          leadName: recipient.lead.fullName ?? recipient.lead.email ?? recipient.leadId,
          subject: message.subject,
          body: message.body,
          channel: "email",
        });

        await prisma.lead.update({
          where: { id: recipient.leadId },
          data: { status: "contacted", lastContactedAt: new Date() },
        });
      } else if (step.type === "linkedin_connect" || step.type === "linkedin_message") {
        const message = await generateLinkedInMessage(ctx);
        await prisma.conversation.create({
          data: {
            workspaceId,
            leadId: recipient.leadId,
            campaignId,
            channel: "linkedin",
            direction: "outbound",
            subject:
              step.type === "linkedin_connect" ? "Nota de conexión en LinkedIn" : "Mensaje en LinkedIn",
            body: message,
            status: "open",
          },
        });
        summary.queued += 1;
        summary.messages.push({
          leadName: recipient.lead.fullName ?? recipient.leadId,
          subject: `LinkedIn (${settings.linkedinAction ?? step.type})`,
          body: message,
          channel: "linkedin",
        });
      } else if (step.type === "call") {
        const phone = recipient.lead.phoneNumber ?? "sin teléfono";
        await prisma.conversation.create({
          data: {
            workspaceId,
            leadId: recipient.leadId,
            campaignId,
            channel: "call",
            direction: "outbound",
            subject: `Llamar a ${recipient.lead.fullName ?? ""}`.trim(),
            body: `Llamar al ${phone}. Guion sugerido:\n${
              ctx.company?.name ? `Empresa: ${ctx.company.name}. ` : ""
            }Presentar ${ctx.playbook.ourCompany} y ofrecer ${
              ctx.playbook.ourValue ?? "gestión de citas online"
            }.`,
            status: "open",
          },
        });
        summary.queued += 1;
        summary.messages.push({
          leadName: recipient.lead.fullName ?? recipient.leadId,
          subject: `Llamada al ${phone}`,
          body: `Llamada al ${phone}`,
          channel: "call",
        });
      } else if (step.type === "wait") {
        // La espera no produce contacto: acumula el retraso para el paso
        // siguiente y avanza el puntero.
        extraDelayHours += step.delayDays * 24 + step.delayHours;
        currentStep += 1;
        continue;
      } else if (step.type === "condition") {
        const condition = settings.condition;
        const passed = evaluateCondition(condition, recipient.lead);
        if (!passed) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "skipped" },
          });
          summary.skipped += 1;
          status = "skipped";
          break;
        }
      }

      currentStep += 1;
      sentCount += 1;
      lastSentAt = new Date();
      status = "sent";
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "sent",
          currentStep,
          sentCount,
          lastSentAt,
          error: null,
        },
      });
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${recipient.lead.fullName ?? recipient.leadId}: ${message}`);
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "failed", error: message },
      });
      break;
    }
    }
  }

  await logActivity(workspaceId, "campaign.run", campaign.name, {
    processed: summary.processed,
    sent: summary.sent,
    queued: summary.queued,
  });

  return summary;
}

function evaluateCondition(
  condition: { field: string; op: string; value?: unknown } | undefined,
  lead: {
    jobTitle?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    linkedinUrl?: string | null;
    score?: number;
    status?: string;
  },
): boolean {
  if (!condition) return true;
  const actual: unknown =
    condition.field === "score"
      ? lead.score
      : condition.field === "status"
        ? lead.status
        : (lead as Record<string, unknown>)[condition.field];

  switch (condition.op) {
    case "exists":
      return actual !== null && actual !== undefined && actual !== "";
    case "not_exists":
      return actual === null || actual === undefined || actual === "";
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(condition.value ?? "").toLowerCase());
    case "not_contains":
      return !String(actual ?? "").toLowerCase().includes(String(condition.value ?? "").toLowerCase());
    case "equals":
      return String(actual ?? "").toLowerCase() === String(condition.value ?? "").toLowerCase();
    case "gt":
      return Number(actual) > Number(condition.value);
    case "gte":
      return Number(actual) >= Number(condition.value);
    case "lt":
      return Number(actual) < Number(condition.value);
    case "lte":
      return Number(actual) <= Number(condition.value);
    default:
      return true;
  }
}

/** Marca una respuesta y detiene la secuencia del lead en esa campaña. */
export async function registerReply(opts: {
  workspaceId: string;
  leadId: string;
  subject?: string | null;
  body: string;
  channel?: string;
  campaignId?: string | null;
}) {
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: opts.workspaceId,
      leadId: opts.leadId,
      campaignId: opts.campaignId ?? null,
      channel: opts.channel ?? "email",
      direction: "inbound",
      subject: opts.subject ?? null,
      body: opts.body,
      status: "replied",
      read: false,
    },
  });

  await prisma.lead.update({
    where: { id: opts.leadId },
    data: { status: "replied" },
  });

  if (opts.campaignId) {
    await prisma.campaignRecipient.updateMany({
      where: { campaignId: opts.campaignId, leadId: opts.leadId },
      data: { status: "replied", repliedAt: new Date() },
    });
  }

  await logActivity(opts.workspaceId, "inbox.reply", opts.subject ?? "Respuesta recibida", {
    leadId: opts.leadId,
  });

  return conversation;
}
