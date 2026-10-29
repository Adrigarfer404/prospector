/**
 * Prueba end-to-end contra la API en marcha.
 *   1) npm run dev
 *   2) npx tsx scripts/test-e2e.ts
 *
 * Comprueba consultas y exportación sin modificar datos ni crear respuestas
 * simuladas. Los flujos de envío aislados se prueban con npm run test:delivery.
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

  const [lists, campaigns, inbox] = await Promise.all([
    api<{ lists: Json[] }>("/api/lists"),
    api<{ campaigns: Json[] }>("/api/campaigns"),
    api<{ conversations: Json[] }>("/api/inbox"),
  ]);
  check("Listas responden", Array.isArray(lists.lists), `${lists.lists.length} listas`);
  check("Campañas responden", Array.isArray(campaigns.campaigns), `${campaigns.campaigns.length} campañas`);
  check("Inbox responde", Array.isArray(inbox.conversations), `${inbox.conversations.length} conversaciones`);
  const csv = await fetch(`${BASE}/api/export/leads`);
  const lines = (await csv.text()).trim().split("\n");
  check("Export CSV", csv.ok && lines[0].includes("email"), `${Math.max(0, lines.length - 1)} filas`);
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks PASS ===`);
  if (failed.length) process.exitCode = 1;
}

main().catch(err => { console.error("Error:", err); process.exitCode = 1; });
