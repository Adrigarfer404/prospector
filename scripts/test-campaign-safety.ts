// Ejecutar únicamente con una base SQLite temporal: DATABASE_URL=file:/tmp/... node --import tsx scripts/test-campaign-safety.ts
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { runCampaign, registerReply } from "../src/lib/campaigns";
import { isContactBlocked } from "../src/lib/contact-policy";
import { getTransporter } from "../src/lib/emailer";
import { fetchPage } from "../src/lib/providers/enrichment/website";
import { PATCH } from "../src/app/api/inbox/[id]/route";

async function main() {
  assert.ok(process.env.DATABASE_URL?.startsWith("file:/tmp/"), "La prueba requiere una base temporal");
  globalThis.fetch = async () => { throw new Error("red desactivada para la prueba"); };
  const workspace = await prisma.workspace.create({ data: { name: "test", playbook: { create: {} }, identities: { create: { name: "test", email: "test@example.com", isDefault: true } } } });
  const lead = await prisma.lead.create({ data: { workspaceId: workspace.id, fullName: "Ana", email: "ana@example.com" } });
  const campaign = await prisma.campaign.create({ data: { workspaceId: workspace.id, name: "test", status: "active", steps: { create: [{ order: 0, type: "email" }, { order: 1, type: "email", delayDays: 1 }] }, recipients: { create: { leadId: lead.id } } } });
  const first = await runCampaign(workspace.id, campaign.id);
  assert.equal(first.queued, 1);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "new");
  assert.equal((await runCampaign(workspace.id, campaign.id)).queued, 0);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { campaignId: campaign.id } });
  const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "closed" }) }), { params: Promise.resolve({ id: conversation.id }) });
  assert.equal(response.status, 200);
  const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
  assert.equal(recipient.currentStep, 1);
  assert.equal(recipient.status, "pending");
  assert.equal((await runCampaign(workspace.id, campaign.id)).queued, 0);
  await registerReply({ workspaceId: workspace.id, leadId: lead.id, body: "Gracias" });
  assert.equal((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).status, "replied");
  await prisma.blocklistEntry.create({ data: { workspaceId: workspace.id, type: "domain", value: "EXAMPLE.COM" } });
  assert.ok(await isContactBlocked(workspace.id, lead));
  assert.ok(await isContactBlocked(workspace.id, { ...lead, status: "do_not_contact" }));
  assert.notEqual(getTransporter({ host: "smtp.example.com", port: 587, user: "a", pass: "old" }), getTransporter({ host: "smtp.example.com", port: 587, user: "a", pass: "new" }));
  assert.equal(await fetchPage("http://127.0.0.1:3000"), null);
  assert.equal(await fetchPage("http://169.254.169.254/latest"), null);
  console.log("PASS: campañas, tareas manuales, respuestas, bloqueo y credenciales SMTP");
}
main().finally(() => prisma.$disconnect());
