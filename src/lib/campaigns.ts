import { prisma } from "./db";
import { randomUUID } from "node:crypto";
import { logActivity } from "./workspace";
import { sendEmail } from "./emailer";
import { generateEmailMessage, generateLinkedInMessage, type MessageContext } from "./messages";
import { parseJson } from "./types";
import { isContactBlocked } from "./contact-policy";

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
  const summary: RunSummary = { processed: 0, sent: 0, queued: 0, skipped: 0, failed: 0, messages: [], errors: [] };
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!campaign || (campaign.status !== "active" && !options?.force)) {
    summary.errors.push(campaign ? "La campaña no está activa" : "Campaña no encontrada");
    return summary;
  }
  const identity = await prisma.identity.findFirst({ where: { workspaceId, isDefault: true } });
  const smtp = identity?.smtpHost ? {
    host: identity.smtpHost, port: identity.smtpPort ?? 587,
    user: identity.smtpUser, pass: identity.smtpPass, secure: identity.smtpSecure,
  } : null;
  // Los registros antiguos en estado sent con pasos pendientes también se recuperan.
  await prisma.campaignRecipient.updateMany({ where: { campaignId, status: "sent", currentStep: { lt: campaign.steps.length } }, data: { status: "pending" } });
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "pending" },
    include: { lead: true }, orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(options?.limit ?? 50, 500)),
  });
  for (const recipient of recipients) {
    // Una reserva condicional impide que dos ejecuciones procesen el mismo lead.
    const claim = await prisma.$transaction(async (tx) => {
      // El primer write serializa reservas y comprobaciones entre procesos SQLite.
      await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: new Date() } });
      if (campaign.autoSend && identity && smtp) {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const [campaignSent, workspaceSent, campaignReserved, workspaceReserved, manualReserved] = await Promise.all([
          tx.conversation.count({ where: { campaignId, channel: "email", direction: "outbound", sentAt: { gte: start } } }),
          tx.conversation.count({ where: { workspaceId, channel: "email", direction: "outbound", sentAt: { gte: start } } }),
          tx.campaignRecipient.count({ where: { campaignId, status: "sending" } }),
          tx.campaignRecipient.count({ where: { campaign: { workspaceId }, status: "sending" } }),
          tx.conversation.count({ where: { workspaceId, channel: "email", status: "sending", campaignId: null } }),
        ]);
        if (campaignSent + campaignReserved >= campaign.dailyLimit || workspaceSent + workspaceReserved + manualReserved >= identity.dailyLimit) return { count: 0 };
      }
      return tx.campaignRecipient.updateMany({
        where: { id: recipient.id, status: recipient.status, currentStep: recipient.currentStep },
        data: { status: "sending" },
      });
    });
    if (!claim.count) continue;
    let currentStep = recipient.currentStep;
    let anchor = recipient.lastSentAt ?? recipient.createdAt;
    let sentCount = recipient.sentCount;
    let lastSentAt = recipient.lastSentAt;
    let deliveryUnknown = false;
    try {
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: recipient.leadId } });
      const blocked = await isContactBlocked(workspaceId, lead);
      if (blocked) {
        await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "skipped", error: blocked } });
        summary.skipped++;
        continue;
      }
      for (;;) {
        const step = campaign.steps[currentStep];
        if (!step) {
          await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "sent", currentStep, error: null } });
          break;
        }
        const delay = (step.delayDays * 24 + step.delayHours) * 3_600_000;
        if (!options?.force && Date.now() < anchor.getTime() + delay) {
          await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "pending", currentStep, lastSentAt } });
          break;
        }
        const stillClaimed = await prisma.campaignRecipient.findFirst({ where: { id: recipient.id, status: "sending" } });
        if (!stillClaimed) break;
        if (stillClaimed.repliedAt) {
          await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "replied" } });
          break;
        }
        if (step.type === "wait") {
          anchor = new Date(anchor.getTime() + delay);
          lastSentAt = anchor;
          currentStep++;
          continue;
        }
        if (step.type === "condition") {
          if (!evaluateCondition(parseJson<StepSettings>(step.settings, {}).condition, lead)) {
            await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "skipped", currentStep } });
            summary.skipped++;
            break;
          }
          currentStep++;
          continue;
        }
        const ctx = await buildMessageContext(recipient.leadId);
        if (!ctx) throw new Error("No se pudo construir el contexto del lead");
        summary.processed++;
        let sent = false;
        let subject = "";
        let body = "";
        let channel = step.type;
        if (step.type === "email") {
          channel = "email";
          const message = await generateEmailMessage(ctx, { subjectTemplate: step.subject, bodyTemplate: step.body, stepName: step.name });
          subject = message.subject;
          body = message.body;
          if (campaign.autoSend && identity && smtp && lead.email) {
            const current = await prisma.campaignRecipient.findFirst({ where: { id: recipient.id, status: "sending" } });
            const freshLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
            if (!current) break;
            if (current.repliedAt) {
              await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "replied" } });
              break;
            }
            const freshBlock = await isContactBlocked(workspaceId, freshLead);
            if (freshBlock) {
              await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "skipped", error: freshBlock } });
              break;
            }
            const start = new Date(); start.setHours(0, 0, 0, 0);
            const [campaignSent, workspaceSent, campaignReserved, workspaceReserved, manualReserved] = await Promise.all([
              prisma.conversation.count({ where: { campaignId, channel: "email", direction: "outbound", sentAt: { gte: start } } }),
              prisma.conversation.count({ where: { workspaceId, channel: "email", direction: "outbound", sentAt: { gte: start } } }),
              prisma.campaignRecipient.count({ where: { campaignId, status: "sending", id: { not: recipient.id } } }),
              prisma.campaignRecipient.count({ where: { campaign: { workspaceId }, status: "sending", id: { not: recipient.id } } }),
              prisma.conversation.count({ where: { workspaceId, channel: "email", status: "sending", campaignId: null } }),
            ]);
            if (campaignSent + campaignReserved >= campaign.dailyLimit || workspaceSent + workspaceReserved + manualReserved >= identity.dailyLimit) {
              await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "pending", currentStep, lastSentAt } });
              break;
            }
            const messageId = `<${randomUUID()}@prospector.local>`;
            // Persistir el contenido antes de SMTP permite investigar un corte.
            const attempt = await prisma.conversation.create({ data: { workspaceId, leadId: lead.id, campaignId, channel: "email", direction: "outbound", subject, body, status: "sending", externalId: messageId } });
            deliveryUnknown = true;
            const result = await sendEmail({ from: { name: identity.name, email: identity.email }, to: { name: lead.fullName, email: lead.email }, subject, body, replyTo: identity.email, smtp, messageId });
            if (!result.sent) {
              if (!result.deliveryUnknown) {
                deliveryUnknown = false;
                await prisma.conversation.update({ where: { id: attempt.id }, data: { status: "failed" } });
              }
              throw new Error(result.error ?? "No se pudo enviar el email");
            }
            const acceptedAt = new Date();
            // La confirmación de SMTP, el historial y el avance se guardan juntos.
            await prisma.$transaction(async tx => {
              await tx.conversation.update({ where: { id: attempt.id }, data: { status: "closed", sentAt: acceptedAt, externalId: result.messageId ?? messageId } });
              const current = await tx.campaignRecipient.findUnique({ where: { id: recipient.id } });
              await tx.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending", currentStep }, data: { currentStep: currentStep + 1, sentCount: sentCount + 1, lastSentAt: acceptedAt, error: null, ...(current?.repliedAt ? { status: "replied" } : {}) } });
              await tx.lead.updateMany({ where: { id: lead.id, status: { notIn: ["unsubscribed", "do_not_contact", "bounced", "replied"] } }, data: { status: "contacted", lastContactedAt: acceptedAt } });
            });
            deliveryUnknown = false;
            sent = true;
            lastSentAt = acceptedAt;
          }
        } else if (step.type === "linkedin_connect" || step.type === "linkedin_message") {
          channel = "linkedin"; subject = step.type === "linkedin_connect" ? "Nota de conexión en LinkedIn" : "Mensaje en LinkedIn";
          body = await generateLinkedInMessage(ctx);
        } else if (step.type === "call") {
          channel = "call"; subject = `Llamar a ${lead.fullName ?? ""}`.trim();
          body = `Llamar al ${lead.phoneNumber ?? "sin teléfono"}. Presentar ${ctx.playbook.ourCompany}.`;
        } else {
          throw new Error(`Tipo de paso no admitido: ${step.type}`);
        }
        if (!sent) await prisma.conversation.create({ data: { workspaceId, leadId: lead.id, campaignId, channel, direction: "outbound", subject, body, status: "open" } });
        summary.messages.push({ leadName: lead.fullName ?? lead.email ?? lead.id, subject, body, channel });
        if (sent) {
          summary.sent++; sentCount++;
          anchor = lastSentAt!;
        } else {
          // Una tarea manual debe completarse antes de continuar la secuencia.
          summary.queued++;
          await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: "manual", error: "Pendiente de envío manual" } });
          break;
        }
        currentStep++;
        // El avance del email ya se ha guardado con la conversación.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed++; summary.errors.push(`${recipient.lead.fullName ?? recipient.leadId}: ${message}`);
      const current = await prisma.campaignRecipient.findUnique({ where: { id: recipient.id } });
      await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "sending" }, data: { status: deliveryUnknown ? "sending" : current?.repliedAt ? "replied" : "failed", error: deliveryUnknown ? `Resultado desconocido: ${message}` : message, currentStep, sentCount, lastSentAt } });
    }
  }
  await logActivity(workspaceId, "campaign.run", campaign.name, { processed: summary.processed, sent: summary.sent, queued: summary.queued });
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

  const recipients = await prisma.campaignRecipient.findMany({
    where: { leadId: opts.leadId, campaign: { workspaceId: opts.workspaceId }, ...(opts.campaignId ? { campaignId: opts.campaignId } : {}) },
    include: { campaign: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  for (const recipient of recipients) {
    const index = recipient.status === "manual" || recipient.status === "sending" ? recipient.currentStep : Math.max(0, recipient.currentStep - 1);
    if (recipient.campaign.steps[index]?.stopOnReply === false) continue;
    await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: { not: "replied" } }, data: { ...(recipient.status === "sending" ? {} : { status: "replied" }), repliedAt: new Date() } });
  }

  await logActivity(opts.workspaceId, "inbox.reply", opts.subject ?? "Respuesta recibida", {
    leadId: opts.leadId,
  });

  return conversation;
}
