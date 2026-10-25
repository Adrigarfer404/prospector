import { searchBusinesses } from "../src/lib/providers/discovery";
async function main(){
  const r = await searchBusinesses({ query: "fisioterapia en Madrid", location: "Madrid", limit: 30, country: "ES" });
  console.log("interpretación:", r.interpretation);
  console.log("provider:", r.provider);
  const by: Record<string, number> = {};
  for (const b of r.businesses) by[b.source] = (by[b.source] ?? 0) + 1;
  console.log("negocios por fuente:", JSON.stringify(by));
  console.log("con web:", r.businesses.filter((b) => b.website).length);
  console.log("con teléfono:", r.businesses.filter((b) => b.phoneNumber).length);
  console.log("warnings:", r.warnings);
  for (const b of r.businesses.slice(0, 12)) {
    console.log(`  [${b.source}] ${b.name.slice(0,38).padEnd(40)} web=${(b.website ?? "-").slice(0,34).padEnd(36)} tel=${b.phoneNumber ?? "-"}`);
  }
}
main().catch(e => { console.error("ERR", (e as Error).message); process.exit(1); });
