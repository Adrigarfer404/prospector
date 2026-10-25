/**
 * Re-puntúa todos los leads del workspace contra el ICP actual.
 *
 *   npx tsx scripts/rescore-leads.ts          # re-puntúa y guarda
 *   npx tsx scripts/rescore-leads.ts --dry    # sólo informa de los cambios
 *
 * Útil después de tocar el scoring o los criterios: los `score` y `scoreReason`
 * guardados en la base son un snapshot y no se recalculan solos.
 */

import { prisma } from "../src/lib/db";
import { getWorkspace } from "../src/lib/workspace";
import { computeLeadScore, loadCriteria, scoreAndSaveLead } from "../src/lib/pipeline";

const dryRun = process.argv.includes("--dry");

async function main() {
  const workspace = await getWorkspace();
  const criteria = await loadCriteria(workspace.id);
  const leads = await prisma.lead.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, fullName: true, score: true, scoreReason: true },
    orderBy: { score: "desc" },
  });

  console.log(`Workspace: ${workspace.name}`);
  console.log(`Criterios: ${criteria.length} · leads: ${leads.length}`);
  if (dryRun) console.log("\n--- SIMULACIÓN (no se guarda nada) ---\n");

  const changes: { id: string; name: string; before: number; after: number }[] = [];

  for (const lead of leads) {
    if (dryRun) {
      const result = await computeLeadScore(workspace.id, lead.id, criteria);
      if (!result) continue;
      if (result.score !== lead.score || result.reason !== lead.scoreReason) {
        changes.push({
          id: lead.id,
          name: lead.fullName ?? "(sin nombre)",
          before: lead.score,
          after: result.score,
        });
      }
      continue;
    }
    await scoreAndSaveLead(workspace.id, lead.id, criteria);
  }

  if (dryRun) {
    const up = changes.filter((c) => c.after > c.before).length;
    const down = changes.filter((c) => c.after < c.before).length;
    const same = changes.length - up - down;
    console.log(`Cambian ${changes.length} de ${leads.length} leads (${up} suben, ${down} bajan, ${same} igual)`);
    for (const change of changes.slice(0, 40)) {
      const delta = change.after - change.before;
      console.log(
        `  ${change.name.slice(0, 42).padEnd(44)} ${String(change.before).padStart(3)} -> ${String(change.after).padStart(3)} (${delta > 0 ? "+" : ""}${delta})`,
      );
    }
    if (changes.length > 40) console.log(`  … y ${changes.length - 40} más`);
    console.log("\nEjecuta sin --dry para guardar los cambios.");
    return;
  }

  console.log(`\n✓ ${leads.length} leads re-puntuados.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
