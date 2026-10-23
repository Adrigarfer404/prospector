import { resolveBusinessContact } from "../src/lib/providers/finder";
async function main(){
  const targets = [
    { name: "FISILISTIC SL", city: "Madrid", region: "Madrid" },
    { name: "ALENTO PSICOLOGIA SLP", city: "Madrid", region: "Madrid" },
    { name: "LIVIUS MEDICAL SL", city: "Madrid", region: "Madrid" },
  ];
  for (const t of targets) {
    const c = await resolveBusinessContact(t);
    console.log(`\n${t.name}`);
    console.log(`   web:    ${c.website ?? "-"}`);
    console.log(`   email:  ${c.email ?? "-"}`);
    console.log(`   tel:    ${c.phone ?? "-"}`);
    console.log(`   nombre: ${c.contactName ?? "-"} ${c.jobTitle ?? ""}`);
    console.log(`   dir:    ${c.address ?? "-"}`);
  }
}
main().catch(e => { console.error("ERR", (e as Error).message); process.exit(1); });
