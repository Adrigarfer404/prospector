import { crawlWebsite } from "../src/lib/providers/enrichment/website";
async function main(){
  const sites = process.argv.slice(2);
  for (const site of sites) {
    console.log(`\n=== ${site} ===`);
    try {
      const r = await crawlWebsite(site);
      console.log("  emails:", r.emails.slice(0,5).join(", ") || "-");
      console.log("  telefonos:", r.phoneNumbers.slice(0,4).join(", ") || "-");
      console.log("  equipo:", r.teamMembers.length ? r.teamMembers.map(m=>`${m.name} (${m.role ?? "?"})`).join(" | ") : "-");
      console.log("  señales:", r.signals.slice(0,4).join(" | ") || "-");
    } catch (e) { console.log("  ERROR:", (e as Error).message); }
  }
}
main();
