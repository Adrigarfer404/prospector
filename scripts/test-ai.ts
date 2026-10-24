/**
 * Comprobación del proveedor de IA activo.
 *
 *   npx tsx scripts/test-ai.ts              # JSON + búsqueda web
 *   npx tsx scripts/test-ai.ts --json       # sólo JSON
 *   npx tsx scripts/test-ai.ts --search     # sólo búsqueda web
 */

import { resolveAiSettings, testAiConnection, testWebSearch } from "../src/lib/ai";

async function main() {
  const settings = await resolveAiSettings();
  console.log(`Proveedor : ${settings.provider}`);
  console.log(`Modelo    : ${settings.model}`);
  console.log(`Búsqueda  : ${settings.webSearchProvider} (${settings.webSearchModel})`);
  console.log(`Endpoint  : ${settings.baseUrl ?? "(el del proveedor)"}`);
  console.log(`Clave API : ${settings.apiKey ? "configurada" : "sin clave (sesión local)"}`);
  console.log();

  const only = process.argv.includes("--json")
    ? "json"
    : process.argv.includes("--search")
      ? "search"
      : "all";

  if (only === "all" || only === "json") {
    console.log("→ Prueba de JSON…");
    const result = await testAiConnection();
    console.log(`  ${result.ok ? "OK" : "FALLO"} — ${result.detail}`);
  }

  if (only === "all" || only === "search") {
    console.log("→ Prueba de búsqueda web…");
    const result = await testWebSearch();
    console.log(
      `  ${result.ok ? "OK" : "FALLO"} — motor: ${result.provider ?? "ninguno"} · ${result.detail}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
