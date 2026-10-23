/**
 * Prueba end-to-end contra la API en marcha.
 *   1) npm run dev
 *   2) npx tsx scripts/test-e2e.ts
 *
 * Recorre el flujo real: listas -> campaña -> destinatarios -> ejecución con
 * IA -> inbox (respuesta) -> export CSV.
 */

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

type Json = Record<string, unknown>;

async function api<T = Json>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return data as T;
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function main() {
  console.log(`\n=== E2E contra ${BASE} ===\n`);

  // 1) Salud general
  const analytics = await api<{ totals: Record<string, number> }>("/api/analytics");
  check(
    "Analítica responde",
    typeof analytics.totals.leads === "number",
    `leads=${analytics.totals.leads} empresas=${analytics.totals.companies} listas=${analytics.totals.lists} campanas=${analytics.totals.campaigns}`,
  );

  // 2) Playbook
  const playbook = await api<{ playbook: { ourCompany: string; icpCriteria: unknown[] } }>(
    "/api/playbook",
  );
  check(
    "Playbook configurado",
    Boolean(playbook.playbook?.ourCompany) && playbook.playbook.icpCriteria.length > 0,
    `${playbook.playbook?.ourCompany} · ${playbook.playbook.icpCriteria.length} criterios`,
  );

  // 3) Leads con email
  const leads = await api<{ leads: Json[]; total: number }>("/api/leads?take=200&sort=score");
  const withEmail = leads.leads.filter((l) => (l.email as string | null)?.includes("@"));
  check(
    "Leads contactables",
    withEmail.length > 0,
    `${leads.total} leads, ${withEmail.length} con email. Top: ${withEmail
      .slice(0, 3)
      .map((l) => `${l.fullName} <${l.email}> (score ${l.score})`)
      .join(" | ")}`,
  );

  if (!withEmail.length) {
    console.log("\nSin leads con email: ejecuta primero `npx tsx scripts/seed.ts`.");
    return;
  }

  // 4) Lista + alta masiva
  const list = await api<{ list: { id: string; name: string } }>("/api/lists", {
    method: "POST",
    body: { name: `E2E ${new Date().toISOString().slice(11, 19)}`, icp: "prueba" },
  });
  const assign = await api<{ added: number }>("/api/leads/assign-list", {
    method: "POST",
    body: {
      leadIds: withEmail.slice(0, 3).map((l) => l.id),
      listId: list.list.id,
      add: true,
    },
  });
  check("Alta masiva en lista", assign.added === 3, `${assign.added} leads añadidos`);

  const listDetail = await api<{ leads: Json[] }>(`/api/lists/${list.list.id}`);
  check(
    "Lista contiene los leads",
    listDetail.leads.length === 3,
    `${listDetail.leads.length} leads en la lista`,
  );

  // 5) Campaña con 3 pasos
  const campaign = await api<{ campaign: { id: string; name: string } }>("/api/campaigns", {
    method: "POST",
    body: {
      name: `E2E campaña ${new Date().toISOString().slice(11, 19)}`,
      channel: "mixed",
      autoSend: false,
      steps: [
        {
          type: "email",
          name: "Primer email",
          delayDays: 0,
          aiEnabled: true,
          subject: "Agenda online para {{company}}",
          body: "Hola {{firstName}},\n\n{{ourValue}}.\n\n{{cta}}\n\n{{signature}}",
        },
        { type: "linkedin_connect", name: "Conexión", delayDays: 1, aiEnabled: true },
        { type: "call", name: "Llamada", delayDays: 2 },
      ],
    },
  });
  check("Campaña creada con 3 pasos", Boolean(campaign.campaign.id), campaign.campaign.name);

  // 6) Destinatarios
  const recipients = await api<{ added: number }>(
    `/api/campaigns/${campaign.campaign.id}/recipients`,
    {
      method: "POST",
      body: { leadIds: withEmail.slice(0, 3).map((l) => l.id) },
    },
  );
  check("Destinatarios añadidos", recipients.added === 3, `${recipients.added} destinatarios`);

  // 7) Vista previa con IA
  const preview = await api<{ messages: { subject: string; body: string; source: string }[] }>(
    `/api/campaigns/${campaign.campaign.id}/preview`,
    {
      method: "POST",
      body: { leadIds: withEmail.slice(0, 3).map((l) => l.id) },
    },
  );
  const first = preview.messages?.[0];
  check(
    "Mensajes generados por IA",
    Boolean(first?.body && first.body.length > 60),
    first
      ? `fuente=${first.source} · "${first.subject}" · ${first.body.length} chars`
      : "sin mensajes",
  );

  // 8) Activar y ejecutar
  await api(`/api/campaigns/${campaign.campaign.id}`, {
    method: "POST",
    body: { action: "launch" },
  });
  const run = await api<{
    processed: number;
    sent: number;
    queued: number;
    messages: { leadName: string; body: string }[];
  }>(`/api/campaigns/${campaign.campaign.id}`, {
    method: "POST",
    body: { limit: 3, force: true },
  });
  check(
    "Campaña ejecutada",
    run.processed > 0,
    `procesados=${run.processed} enviados=${run.sent} encolados=${run.queued}`,
  );

  // 9) Tareas generadas (LinkedIn / llamada)
  const tasks = await api<{ tasks: Json[] }>("/api/tasks");
  check("Tareas manuales generadas", tasks.tasks.length > 0, `${tasks.tasks.length} tareas`);

  // 10) Inbox: registrar respuesta
  const reply = await api<{ conversation: { id: string } }>("/api/inbox", {
    method: "POST",
    body: {
      leadId: withEmail[0].id,
      subject: "Re: Agenda online",
      body: "Hola, sí me interesa. ¿Me enseñas el jueves?",
      campaignId: campaign.campaign.id,
    },
  });
  check("Respuesta registrada", Boolean(reply.conversation?.id), reply.conversation?.id);

  const inbox = await api<{ conversations: Json[]; unreadCount: number }>("/api/inbox");
  check(
    "Inbox muestra la respuesta",
    inbox.conversations.some((c) => c.direction === "inbound"),
    `${inbox.conversations.length} conversaciones, ${inbox.unreadCount} sin leer`,
  );

  // 11) Export CSV
  const csv = await fetch(`${BASE}/api/export/leads`);
  const csvText = await csv.text();
  const lines = csvText.trim().split("\n");
  check(
    "Export CSV",
    csv.ok && lines.length > 1 && lines[0].includes("email"),
    `${lines.length - 1} filas · cabecera: ${lines[0].slice(0, 60)}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks PASS ===`);
  if (failed.length) {
    console.log("Fallos:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E falló:", err instanceof Error ? err.message : err);
  process.exit(1);
});
