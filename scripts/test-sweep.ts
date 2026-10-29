import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { prisma } from "../src/lib/db";
import { outscraperMapsSearch } from "../src/lib/providers/discovery/outscraper";
import { mapsPlaceToBusiness } from "../src/lib/providers/discovery/maps";
import { runMapsSweep, SWEEP_PROVINCES, SWEEP_CATEGORIES, sweepMatrix } from "../src/lib/providers/discovery/sweep";
import { enrichBusiness, findEmails, verifyEmails } from "../src/lib/providers/enrichment";

async function main() {
  assert.ok(process.env.DATABASE_URL?.startsWith("file:/tmp/"), "Se requiere una base temporal");
  process.env.OUTSCRAPER_API_KEY = "test-key";
  assert.equal(SWEEP_PROVINCES.length, 52); assert.equal(new Set(SWEEP_PROVINCES.map(p => p.id)).size, 52);
  assert.ok(SWEEP_PROVINCES.some(p => p.id === "la-rioja")); assert.ok(SWEEP_PROVINCES.some(p => p.id === "zamora"));
  assert.equal(SWEEP_CATEGORIES.length, 10); assert.equal(sweepMatrix().length, 520);
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.outscraper.com/google-maps-search");
    assert.equal(new Headers(init?.headers).get("X-API-KEY"), "test-key");
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: "Success", data: [[{ name: "Clínica", place_id: "test-1", full_address: "Calle 1, Madrid", city: "Madrid", state: "Madrid", phone: "+34910000000", reviews: 45 }]] }), { status: 200 });
  };
  const places = await outscraperMapsSearch({ query: "fisioterapia", location: "Madrid, Spain", limit: 25 });
  assert.deepEqual(requestBody.query, ["fisioterapia, Madrid, Spain"]); assert.equal(requestBody.async, false);
  assert.equal(places.length, 1); assert.equal(mapsPlaceToBusiness(places[0])?.city, "Madrid");
  assert.equal(mapsPlaceToBusiness(places[0])?.raw.reviewCount, 45);
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "Pending", id: "1" }), { status: 202 });
  await assert.rejects(() => outscraperMapsSearch({ query: "test" }));
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "Success", data: ["incorrecto"] }), { status: 200 });
  await assert.rejects(() => outscraperMapsSearch({ query: "test" }));

  const workspace = await prisma.workspace.create({ data: { name: "test", playbook: { create: {} } } });
  let calls = 0;
  let failSecond = true;
  const deps = {
    outscraperConfigured: () => true,
    outscraperMapsSearch: async () => { calls++; if (calls === 2 && failSecond) throw new Error("fallo simulado"); return places; },
    enrichBusiness, findEmails, verifyEmails,
  };
  const initial = await runMapsSweep({ workspaceId: workspace.id, cells: 3, dryRun: true }, deps);
  assert.equal(initial.cells.length, 3); assert.equal(calls, 0);
  assert.equal(await prisma.company.count(), 0); assert.equal(await prisma.sweepState.count(), 0);
  const first = await runMapsSweep({ workspaceId: workspace.id, cells: 3 }, deps);
  assert.equal(first.cursorAfter, 1); assert.equal(first.cells.length, 2); assert.ok(first.cells[1].skipped);
  assert.equal((await prisma.sweepState.findFirstOrThrow()).cursor, 1);
  failSecond = false;
  const resumed = await runMapsSweep({ workspaceId: workspace.id, cells: 1 }, deps);
  assert.equal(resumed.cells[0].label, "Odontología en Madrid"); assert.equal(resumed.cursorAfter, 2);
  assert.equal(await prisma.company.count(), 1, "resultados repetidos no crean empresas duplicadas");
  const unavailable = await runMapsSweep({ workspaceId: workspace.id }, { ...deps, outscraperConfigured: () => false });
  assert.equal(unavailable.cursorBefore, 2); assert.equal(unavailable.cursorAfter, 2); assert.equal(unavailable.cells.length, 0);
  const targeted = await runMapsSweep({ workspaceId: workspace.id, cells: 1, categoryId: "dentist", provinceId: "valencia" }, deps);
  assert.equal(targeted.cursorAfter, 2); assert.equal((await prisma.sweepState.findFirstOrThrow()).cursor, 2);
  await assert.rejects(() => runMapsSweep({ workspaceId: workspace.id, categoryId: "incorrecta" }, deps));
  await assert.rejects(() => runMapsSweep({ workspaceId: workspace.id, cells: NaN }, deps));

  const enrichedDeps = { ...deps,
    outscraperMapsSearch: async () => [{ name: "Centro Dos", place_id: "test-2", full_address: "Madrid", city: "Madrid", phone: "+34910000001", site: "https://example.com" }],
    enrichBusiness: (async (business) => ({ business, company: null, contacts: [], emails: [{ email: "hola@example.com", source: "web", confidence: 95 }], signals: [], website: null, skipped: false, skipReason: null })) as typeof enrichBusiness,
  };
  await runMapsSweep({ workspaceId: workspace.id, cells: 1, enrich: true }, enrichedDeps);
  const email = await prisma.leadEmail.findFirstOrThrow({ where: { email: "hola@example.com" } });
  assert.equal(email.status, "unverified"); assert.equal(email.verifiedAt, null); assert.equal(email.source, "crawl");
  await prisma.leadEmail.update({ where: { id: email.id }, data: { status: "verified", source: "manual", confidence: 100, verifiedAt: new Date() } });
  await runMapsSweep({ workspaceId: workspace.id, cells: 1, categoryId: "dentist", provinceId: "madrid", enrich: true }, enrichedDeps);
  const preserved = await prisma.leadEmail.findUniqueOrThrow({ where: { id: email.id } });
  assert.equal(preserved.status, "verified"); assert.equal(preserved.source, "manual");

  const failingEnrichment = { ...enrichedDeps, enrichBusiness: (async () => { throw new Error("fallo de enriquecimiento"); }) as typeof enrichBusiness };
  const enrichmentFailure = await runMapsSweep({ workspaceId: workspace.id, cells: 1, enrich: true }, failingEnrichment);
  assert.equal(enrichmentFailure.cursorAfter, (await prisma.sweepState.findFirstOrThrow()).cursor);
  assert.ok(enrichmentFailure.cells[0].skipped);

  const verifiedDeps = { ...deps,
    outscraperMapsSearch: async () => [{ name: "Centro Tres", place_id: "test-3", full_address: "Madrid", city: "Madrid", phone: "+34910000002", site: "https://example.org" }],
    enrichBusiness: (async (business) => ({ business, company: null, contacts: [], emails: [], signals: [], website: null, skipped: false, skipReason: null })) as typeof enrichBusiness,
    findEmails: (async () => [{ email: "ana@example.org", source: "pattern", confidence: 60 }]) as typeof findEmails,
    verifyEmails: (async () => [{ email: "ana@example.org", status: "verified", confidence: 90, reason: "test", candidate: { email: "ana@example.org", source: "pattern", confidence: 60 } }]) as typeof verifyEmails,
  };
  await runMapsSweep({ workspaceId: workspace.id, cells: 1, categoryId: "dentist", provinceId: "madrid", enrich: true }, verifiedDeps);
  const verified = await prisma.leadEmail.findFirstOrThrow({ where: { email: "ana@example.org" } });
  assert.equal(verified.status, "verified"); assert.equal(verified.source, "pattern"); assert.ok(verified.verifiedAt);

  const jobs = await prisma.job.count(); const states = await prisma.sweepState.count();
  const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/sweep-maps.ts", "--dry"], { env: process.env, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(await prisma.job.count(), jobs); assert.equal(await prisma.sweepState.count(), states);
  const cursorBeforeInvalid = (await prisma.sweepState.findFirstOrThrow()).cursor;
  const invalid = spawnSync(process.execPath, ["--import", "tsx", "scripts/sweep-maps.ts", "--reset", "--cells", "NaN"], { env: process.env, encoding: "utf8" });
  assert.notEqual(invalid.status, 0); assert.equal((await prisma.sweepState.findFirstOrThrow()).cursor, cursorBeforeInvalid);
  const locked = await prisma.job.create({ data: { workspaceId: workspace.id, type: "sweep-maps", status: "running" } });
  const concurrent = spawnSync(process.execPath, ["--import", "tsx", "scripts/sweep-maps.ts"], { env: process.env, encoding: "utf8" });
  assert.notEqual(concurrent.status, 0); assert.match(concurrent.stderr, /en curso/);
  const unlock = spawnSync(process.execPath, ["--import", "tsx", "scripts/sweep-maps.ts", "--unlock"], { env: process.env, encoding: "utf8" });
  assert.equal(unlock.status, 0, unlock.stderr);
  assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: locked.id } })).status, "error");
  const failedRun = spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-sweep-preload.ts", "scripts/sweep-maps.ts", "--cells", "3"], { env: process.env, encoding: "utf8", timeout: 20_000 });
  assert.notEqual(failedRun.status, 0);
  const lastJob = await prisma.job.findFirstOrThrow({ where: { type: "sweep-maps" }, orderBy: { createdAt: "desc" } });
  assert.equal(lastJob.status, "error"); assert.equal(lastJob.progress, 1);
  assert.equal((await prisma.sweepState.findFirstOrThrow()).cursor, cursorBeforeInvalid + 1);
  console.log("PASS: API, matriz, simulación, reintentos, cursor, deduplicación y emails");
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
