/**
 * Barrido diario de Google Maps: construye el censo de negocios por
 * categorías y provincias, avanzando un cursor para no repetir celdas.
 *
 *   npx tsx scripts/sweep-maps.ts                    # 3 celdas (por defecto)
 *   npx tsx scripts/sweep-maps.ts --cells 10         # 10 celdas en esta pasada
 *   npx tsx scripts/sweep-maps.ts --enrich           # además: crawl + email + lead
 *   npx tsx scripts/sweep-maps.ts --category dentist --province valencia
 *   npx tsx scripts/sweep-maps.ts --dry              # no escribe nada
 *   npx tsx scripts/sweep-maps.ts --reset            # vuelve el cursor al principio
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
const cells = Number(argValue("cells") ?? 3);
const categoryId = argValue("category");
const provinceId = argValue("province");
const limit = Number(argValue("limit") ?? 25);
const minReviews = Number(argValue("min-reviews") ?? 0);

async function main() {
  const workspace = await getWorkspace();
  const matrix = sweepMatrix();

  console.log(`Workspace: ${workspace.name}`);
  console.log(`Matriz: ${SWEEP_PROVINCES.length} provincias × ${SWEEP_CATEGORIES.length} categorías = ${matrix.length} celdas`);
  console.log(
    `Presupuesto: ${cells} celda(s) · ${limit} negocios por celda · mínimo ${minReviews} reseñas`,
  );
  if (enrich) console.log("Modo enrich: crawl de web + búsqueda de emails + alta de leads.");
  if (dryRun) console.log("\n--- SIMULACIÓN (no se escribe nada) ---\n");

  const state = await prisma.sweepState.findUnique({
    where: { workspaceId_source: { workspaceId: workspace.id, source: "maps" } },
  });
  console.log(`Cursor: ${state?.cursor ?? 0}/${matrix.length}`);

  if (reset && !dryRun) {
    await prisma.sweepState.upsert({
      where: { workspaceId_source: { workspaceId: workspace.id, source: "maps" } },
      create: { workspaceId: workspace.id, source: "maps", cursor: 0, total: matrix.length },
      update: { cursor: 0 },
    });
    console.log("Cursor reiniciado a 0.\n");
  }

  const job = await prisma.job.create({
    data: {
      workspaceId: workspace.id,
      type: "sweep-maps",
      status: "running",
      progress: 0,
      total: cells,
      message: `Barrido de Maps: ${cells} celda(s)`,
    },
  });

  const outcome = await runMapsSweep({
    workspaceId: workspace.id,
    cells,
    limit,
    minReviews,
    enrich,
    dryRun,
    ...(categoryId ? { categoryId } : {}),
    ...(provinceId ? { provinceId } : {}),
  });

  for (const cell of outcome.cells) {
    const suffix = cell.skipped ? ` (falló: ${cell.skipped})` : "";
    console.log(
      `  ${cell.label.padEnd(34)} ${String(cell.found).padStart(3)} encontrados · ${String(cell.saved).padStart(3)} guardados · ${String(cell.leads).padStart(2)} leads${suffix}`,
    );
  }

  for (const warning of outcome.warnings) console.log(`  ⚠ ${warning}`);

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: outcome.warnings.length ? "done" : "done",
      progress: cells,
      message: `${outcome.companies} negocios · ${outcome.leads} leads`,
      result: JSON.stringify({
        cells: outcome.cells,
        cursorBefore: outcome.cursorBefore,
        cursorAfter: outcome.cursorAfter,
        companies: outcome.companies,
        leads: outcome.leads,
        warnings: outcome.warnings,
      }),
    },
  });

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
