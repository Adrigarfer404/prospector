/**
 * Barrido de Google Maps: busca negocios por categorías y ubicaciones y
 * guarda un cursor para continuar en la siguiente ejecución.
 *
 *   npx tsx scripts/sweep-maps.ts                    # 3 celdas (por defecto)
 *   npx tsx scripts/sweep-maps.ts --cells 10         # 10 celdas en esta pasada
 *   npx tsx scripts/sweep-maps.ts --enrich           # además: crawl + email + lead
 *   npx tsx scripts/sweep-maps.ts --category dentist --province valencia
 *   npx tsx scripts/sweep-maps.ts --dry              # sin red ni escrituras
 *   npx tsx scripts/sweep-maps.ts --reset            # vuelve el cursor al principio
 *   npx tsx scripts/sweep-maps.ts --unlock           # libera un barrido interrumpido
 *
 * Requiere OUTSCRAPER_API_KEY en el .env.
 */

import { prisma } from "../src/lib/db";
import { getWorkspace } from "../src/lib/workspace";
import { runMapsSweep, sweepMatrix, SWEEP_CATEGORIES, SWEEP_PROVINCES } from "../src/lib/providers/discovery/sweep";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const dryRun = process.argv.includes("--dry");
const enrich = process.argv.includes("--enrich");
const reset = process.argv.includes("--reset");
const unlock = process.argv.includes("--unlock");
const cells = Number(argValue("cells") ?? 3);
const categoryId = argValue("category");
const provinceId = argValue("province");
const limit = Number(argValue("limit") ?? 25);
const minReviews = Number(argValue("min-reviews") ?? 0);

async function main() {
  const matrix = sweepMatrix();
  if (!Number.isInteger(cells) || cells < 1 || cells > matrix.length) throw new Error(`cells debe ser un entero entre 1 y ${matrix.length}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit debe ser un entero entre 1 y 100");
  if (!Number.isInteger(minReviews) || minReviews < 0) throw new Error("min-reviews debe ser un entero no negativo");
  if (categoryId && !SWEEP_CATEGORIES.some(c => c.id === categoryId)) throw new Error("Categoría desconocida");
  const provinceAlias = provinceId === "santa-cruz" ? "caceres" : provinceId === "merida" ? "badajoz" : provinceId;
  if (provinceAlias && !SWEEP_PROVINCES.some(p => p.id === provinceAlias)) throw new Error("Ubicación desconocida");
  if (reset && (categoryId || provinceId)) throw new Error("--reset no se puede combinar con una búsqueda por categoría o ubicación");
  const workspace = dryRun ? await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } }) : await getWorkspace();
  const workspaceId = workspace?.id ?? "";

  console.log(`Workspace: ${workspace?.name ?? "(aún no existe)"}`);
  console.log(`Matriz: ${SWEEP_PROVINCES.length} ubicaciones × ${SWEEP_CATEGORIES.length} categorías = ${matrix.length} celdas`);
  console.log(
    `Presupuesto: ${cells} celda(s) · ${limit} negocios por celda · mínimo ${minReviews} reseñas`,
  );
  if (enrich) console.log("Modo enrich: crawl de web + búsqueda de emails + alta de leads.");
  if (dryRun) console.log("\n--- SIMULACIÓN (sin consultas externas ni escrituras) ---\n");

  const state = await prisma.sweepState.findUnique({
    where: { workspaceId_source: { workspaceId, source: "maps" } },
  });
  console.log(`Cursor: ${state?.cursor ?? 0}/${matrix.length}`);

  if (unlock) {
    if (dryRun) throw new Error("--unlock no se puede combinar con --dry");
    const unlocked = await prisma.job.updateMany({ where: { workspaceId, type: "sweep-maps", status: "running" }, data: { status: "error", message: "Bloqueo liberado manualmente" } });
    console.log(`Bloqueos liberados: ${unlocked.count}.`);
    return;
  }
  const { outscraperConfigured } = await import("../src/lib/providers/discovery/outscraper");
  if (!dryRun && !outscraperConfigured()) throw new Error("Falta OUTSCRAPER_API_KEY; no se ha lanzado el barrido.");

  // La escritura del workspace serializa la comprobación del bloqueo en SQLite.
  const job = dryRun ? null : await prisma.$transaction(async tx => {
    await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: new Date() } });
    const running = await tx.job.findFirst({ where: { workspaceId, type: "sweep-maps", status: "running" } });
    if (running) throw new Error("Ya hay un barrido en curso. Si se interrumpió, comprueba que se ha detenido y usa --unlock.");
    return tx.job.create({ data: { workspaceId, type: "sweep-maps", status: "running", progress: 0, total: cells, message: `Barrido de Maps: ${cells} celda(s)` } });
  });
  let outcome;
  try {
    if (reset && !dryRun) {
      await prisma.sweepState.upsert({ where: { workspaceId_source: { workspaceId, source: "maps" } }, create: { workspaceId, source: "maps", cursor: 0, total: matrix.length }, update: { cursor: 0, total: matrix.length } });
      console.log("Cursor reiniciado a 0.\n");
    }
    outcome = await runMapsSweep({ workspaceId, cells, limit, minReviews, enrich, dryRun, ...(categoryId ? { categoryId } : {}), ...(provinceId ? { provinceId } : {}) });
  } catch (err) {
    if (job) await prisma.job.update({ where: { id: job.id }, data: { status: "error", message: err instanceof Error ? err.message : String(err) } });
    throw err;
  }

  for (const cell of outcome.cells) {
    if (dryRun) { console.log(`  ${cell.label}`); continue; }
    const suffix = cell.skipped ? ` (falló: ${cell.skipped})` : "";
    console.log(
      `  ${cell.label.padEnd(34)} ${String(cell.found).padStart(3)} encontrados · ${String(cell.saved).padStart(3)} guardados · ${String(cell.leads).padStart(2)} leads${suffix}`,
    );
  }

  for (const warning of outcome.warnings) console.log(`  ⚠ ${warning}`);

  if (job) await prisma.job.update({
    where: { id: job.id },
    data: {
      status: outcome.cells.some(cell => cell.skipped) ? "error" : "done",
      progress: outcome.cells.filter(cell => !cell.skipped).length,
      message: `${outcome.companies} negocios · ${outcome.leads} leads`,
      result: JSON.stringify(outcome),
    },
  });
  if (outcome.cells.some(cell => cell.skipped)) process.exitCode = 1;

  if (dryRun) { console.log(`\n${outcome.cells.length} celdas seleccionadas; cursor sin cambios.`); return; }
  console.log(
    `\n✓ ${outcome.companies} negocios · ${outcome.leads} leads. Cursor: ${outcome.cursorBefore} → ${outcome.cursorAfter}/${outcome.totalCells}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
