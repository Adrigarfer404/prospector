import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { getTransporter } from "../src/lib/emailer";
import { runCampaign, registerReply } from "../src/lib/campaigns";
import { POST as manualSend } from "../src/app/api/inbox/send/route";
import { POST as recoverManual } from "../src/app/api/inbox/[id]/recover/route";
import { PATCH as patchInbox } from "../src/app/api/inbox/[id]/route";
import { POST as recover } from "../src/app/api/campaigns/[id]/recipients/[recipientId]/recover/route";

async function main() {
  assert.ok(process.env.DATABASE_URL?.startsWith("file:/tmp/"), "La prueba requiere una base temporal");
  globalThis.fetch = async () => { throw new Error("IA desactivada en pruebas"); };
  const workspace = await prisma.workspace.create({ data: { name: "delivery-test", playbook: { create: {} }, identities: { create: { name: "test", email: "sender@example.com", smtpHost: "mock.invalid", smtpPort: 587, smtpSecure: false, isDefault: true, dailyLimit: 50 } } } });
  const transporter = getTransporter({ host: "mock.invalid", port: 587, secure: false });
  const transport = transporter as unknown as { sendMail: (data: { messageId: string; subject: string; text: string }) => Promise<{ messageId: string }> };
  let behavior: "accepted" | "rejected" | "unknown" = "accepted";
  let calls = 0;
  let duringSend: (() => Promise<void>) | null = null;
  transport.sendMail = async message => {
    calls++;
    const attempt = await prisma.conversation.findFirstOrThrow({ where: { externalId: message.messageId } });
    assert.equal(attempt.status, "sending");
    assert.equal(attempt.subject, message.subject);
    assert.equal(attempt.body, message.text);
    if (duringSend) await duringSend();
    if (behavior === "rejected") throw Object.assign(new Error("SMTP rejected"), { responseCode: 550 });
    if (behavior === "unknown") throw new Error("Connection reset after DATA");
    return { messageId: message.messageId };
  };
  async function fixture(dailyLimit = 50) {
    const lead = await prisma.lead.create({ data: { workspaceId: workspace.id, fullName: "Ana", email: `lead-${Math.random()}@example.com` } });
    const campaign = await prisma.campaign.create({ data: { workspaceId: workspace.id, name: "test", status: "active", autoSend: true, dailyLimit, steps: { create: [{ order: 0, type: "email" }, { order: 1, type: "email", delayDays: 1 }] }, recipients: { create: { leadId: lead.id } } }, include: { recipients: true } });
    return { lead, campaign, recipient: campaign.recipients[0] };
  }
  const success = await fixture();
  assert.equal((await runCampaign(workspace.id, success.campaign.id)).sent, 1);
  let recipient = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: success.recipient.id } });
  assert.equal(recipient.status, "pending"); assert.equal(recipient.currentStep, 1); assert.equal(recipient.sentCount, 1);
  const accepted = await prisma.conversation.findFirstOrThrow({ where: { campaignId: success.campaign.id } });
  assert.equal(accepted.status, "closed"); assert.ok(accepted.externalId); assert.ok(accepted.sentAt);
  await runCampaign(workspace.id, success.campaign.id);
  assert.equal(calls, 1, "el siguiente paso todavía no ha vencido");

  behavior = "rejected";
  const rejected = await fixture();
  assert.equal((await runCampaign(workspace.id, rejected.campaign.id)).failed, 1);
  recipient = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: rejected.recipient.id } });
  assert.equal(recipient.status, "failed"); assert.equal(recipient.currentStep, 0);
  assert.equal((await prisma.conversation.findFirstOrThrow({ where: { campaignId: rejected.campaign.id } })).status, "failed");

  behavior = "unknown";
  const uncertain = await fixture();
  assert.equal((await runCampaign(workspace.id, uncertain.campaign.id)).failed, 1);
  recipient = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: uncertain.recipient.id } });
  assert.equal(recipient.status, "sending"); assert.equal(recipient.currentStep, 0);
  const draft = await prisma.conversation.findFirstOrThrow({ where: { campaignId: uncertain.campaign.id } });
  assert.equal(draft.status, "sending"); assert.ok(draft.externalId); assert.ok(draft.body);
  const countBefore = calls;
  await runCampaign(workspace.id, uncertain.campaign.id);
  assert.equal(calls, countBefore, "resultado incierto no se reintenta");
  await prisma.campaign.update({ where: { id: uncertain.campaign.id }, data: { status: "paused" } });
  await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { updatedAt: new Date(Date.now() - 20 * 60_000) } });
  const response = await recover(new Request("http://localhost", { method: "POST", body: JSON.stringify({ outcome: "sent" }) }), { params: Promise.resolve({ id: uncertain.campaign.id, recipientId: recipient.id }) });
  assert.equal(response.status, 200);
  assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: draft.id } })).status, "closed");
  assert.equal(await prisma.conversation.count({ where: { campaignId: uncertain.campaign.id } }), 1);
  assert.equal((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).currentStep, 1);

  behavior = "accepted";
  const limited = await fixture(1);
  await prisma.conversation.create({ data: { workspaceId: workspace.id, campaignId: limited.campaign.id, leadId: limited.lead.id, channel: "email", direction: "outbound", body: "anterior", status: "closed", sentAt: new Date() } });
  await runCampaign(workspace.id, limited.campaign.id);
  assert.equal(calls, countBefore, "el límite diario impide el envío");
  const concurrent = await fixture();
  const beforeConcurrent = calls;
  await Promise.all([runCampaign(workspace.id, concurrent.campaign.id), runCampaign(workspace.id, concurrent.campaign.id)]);
  assert.equal(calls, beforeConcurrent + 1, "dos ejecuciones no envían dos veces");

  const blocked = await fixture();
  await prisma.lead.update({ where: { id: blocked.lead.id }, data: { status: "do_not_contact" } });
  const beforeBlocked = calls;
  await runCampaign(workspace.id, blocked.campaign.id);
  assert.equal(calls, beforeBlocked);
  assert.equal((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: blocked.recipient.id } })).status, "skipped");

  const replying = await fixture();
  duringSend = async () => { await registerReply({ workspaceId: workspace.id, leadId: replying.lead.id, body: "Respuesta" }); };
  await runCampaign(workspace.id, replying.campaign.id);
  duringSend = null;
  const replied = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: replying.recipient.id } });
  assert.equal(replied.status, "replied"); assert.equal(replied.sentCount, 1);

  behavior = "unknown";
  const manualLead = await prisma.lead.create({ data: { workspaceId: workspace.id, email: "manual@example.com" } });
  const manualResponse = await manualSend(new Request("http://localhost", { method: "POST", body: JSON.stringify({ leadId: manualLead.id, subject: "Hola", body: "Prueba" }) }));
  assert.equal((await manualResponse.json()).deliveryUnknown, true);
  const manual = await prisma.conversation.findFirstOrThrow({ where: { leadId: manualLead.id } });
  assert.equal(manual.status, "sending");
  assert.equal((await patchInbox(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "closed" }) }), { params: Promise.resolve({ id: manual.id }) })).status, 409);
  await prisma.conversation.update({ where: { id: manual.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
  const manualParams = { params: Promise.resolve({ id: manual.id }) };
  const manualRecovery = () => new Request("http://localhost", { method: "POST", body: JSON.stringify({ outcome: "not_sent" }) });
  assert.equal((await recoverManual(manualRecovery(), manualParams)).status, 200);
  assert.equal((await recoverManual(manualRecovery(), manualParams)).status, 409);
  assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: manual.id } })).status, "cancelled");
  console.log("PASS: aceptación, rechazo, resultado incierto, recuperación, espera, límite, concurrencia y bloqueo");
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
