/**
 * Comprobación de la configuración de correo de un dominio: qué falta para
 * poder enviar y recibir con una marca propia.
 *
 *   npx tsx scripts/check-mail-dns.ts agendaos.es
 *
 * No envía ningún correo ni modifica nada: sólo lee DNS.
 */

import { promises as dns } from "node:dns";

const DKIM_SELECTORS = [
  "default",
  "mail",
  "dkim",
  "selector1",
  "selector2",
  "s1",
  "s2",
  "k1",
  "k2",
  "mailgun",
  "mandrill",
  "zoho",
];

async function txt(host: string): Promise<string[]> {
  try {
    // resolveTxt devuelve cada registro como una lista de trozos: se unen.
    const records = await dns.resolveTxt(host);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

async function mx(host: string): Promise<{ exchange: string; priority: number }[]> {
  try {
    return await dns.resolveMx(host);
  } catch {
    return [];
  }
}

async function main() {
  const domain = (process.argv[2] ?? "agendaos.es").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  console.log(`\n=== Correo de ${domain} ===\n`);

  // MX: dónde llega el correo.
  const records = await mx(domain);
  console.log("MX (servidores que reciben el correo)");
  if (!records.length) {
    console.log("  ✗ NINGUNO. El correo entrante no tiene destino: si alguien responde,");
    console.log("    el mensaje se pierde (o acaba en el servidor web, que no es un servidor de correo).");
  } else {
    for (const record of records.sort((a, b) => a.priority - b.priority)) {
      console.log(`  ✓ ${record.exchange} (prioridad ${record.priority})`);
    }
  }

  // SPF: qué servidores pueden enviar con tu dominio.
  const spf = (await txt(domain)).filter((t) => t.startsWith("v=spf1"));
  console.log("\nSPF (servidores autorizados a enviar)");
  if (!spf.length) {
    console.log("  ✗ No hay registro SPF: casi todos los correos salientes acaban en spam.");
  } else {
    for (const record of spf) {
      console.log(`  ✓ ${record}`);
      const mechanisms = record.split(" ").slice(1);
      console.log(`    mecanismos: ${mechanisms.filter((m) => m !== "all" && m !== "-all" && m !== "~all").join(", ") || "(ninguno)"}`);
      console.log(`    política: ${mechanisms.find((m) => m === "all" || m === "-all" || m === "~all") ?? "sin política"}`);
    }
    if (spf.length > 1) {
      console.log("  ! Hay más de un registro SPF: sólo se permite uno (los demás se ignoran).");
    }
  }

  // DMARC: qué hacer cuando el SPF/DKIM fallan.
  const dmarc = (await txt(`_dmarc.${domain}`)).filter((t) => t.toLowerCase().includes("v=dmarc1"));
  console.log("\nDMARC (qué hacen los receptores si falla la autenticación)");
  if (!dmarc.length) {
    console.log("  · No configurado (recomendable empezar por p=none).");
  } else {
    console.log(`  ✓ ${dmarc[0]}`);
  }

  // DKIM: firma criptográfica del remitente.
  console.log("\nDKIM (firma del remitente)");
  let dkim = 0;
  for (const selector of DKIM_SELECTORS) {
    const records = await txt(`${selector}._domainkey.${domain}`);
    const record = records.find((t) => t.includes("p=") && !t.includes("p=;"));
    if (record) {
      dkim += 1;
      console.log(`  ✓ ${selector}._domainkey.${domain}`);
    }
  }
  if (!dkim) {
    console.log("  · No se ha encontrado ningún selector DKIM con los nombres habituales.");
    console.log("    (puede existir con otro nombre: mira en el panel del proveedor de correo)");
  }

  // Resumen accionable.
  console.log("\n--- Resumen ---");
  const falta: string[] = [];
  if (!records.length) falta.push("MX (para recibir respuestas)");
  if (!spf.length) falta.push("SPF (para que te dejen enviar)");
  if (!dkim) falta.push("DKIM (firma del remitente; sube la entregabilidad)");
  if (!dmarc.length) falta.push("DMARC (recomendado)");

  if (!falta.length) {
    console.log("  ✓ El dominio está listo para enviar y recibir con su propia marca.");
  } else {
    console.log(`  Falta: ${falta.join(", ")}.`);
    console.log("  Los cambios se hacen en la zona DNS donde están los nameservers del dominio");
    console.log("  (no en el panel del proveedor de correo: sólo da los valores).");
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
