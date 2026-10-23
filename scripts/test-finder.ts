/**
 * Test del AI Finder basado en búsqueda web real.
 *   npx tsx scripts/test-finder.ts "fisioterapeutas en Madrid"
 */
import { findProspectsViaWeb } from "../src/lib/providers/finder";

async function main() {
  const query = process.argv[2] ?? "fisioterapeutas en Madrid";
  const limit = Number(process.argv[3] ?? "12");

  console.log(`→ Buscando: "${query}" (max ${limit})…`);
  const started = Date.now();

  try {
    const result = await findProspectsViaWeb({ query, limit, timeoutMs: 200_000 });
    console.log(`\n⏱  ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`Interpretación: ${result.interpretation}`);
    console.log(`Consultas web lanzadas: ${result.searchQueries.length}`);
    console.log(`Resultados web brutos: ${result.hits.length}`);
    console.log(`Prospectos extraídos: ${result.businesses.length}`);

    for (const b of result.businesses) {
      const email = (b.raw.email as string | undefined) ?? "-";
      console.log(
        `  • ${b.name.slice(0, 42).padEnd(44)} ${(b.phoneNumber ?? "-").slice(0, 16).padEnd(18)} ${email.slice(0, 34).padEnd(36)} ${b.website ?? "-"}`,
      );
    }
    for (const w of result.warnings) console.log(`  ! ${w}`);
  } catch (err) {
    console.error("ERROR:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
