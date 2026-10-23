#!/usr/bin/env tsx
/**
 * Verificación ejecutable de los providers de descubrimiento y enriquecimiento.
 *
 *   npx tsx scripts/test-providers.ts
 *
 * Imprime un resumen PASS/FAIL por bloque. Código de salida 0 si lo esencial
 * funcionó (descubrimiento + crawler + verificación SMTP + LLM).
 */

import { searchBusinesses } from "../src/lib/providers/discovery";
import {
  crawlWebsite,
  discoverEmailsByPattern,
  verifyEmails,
} from "../src/lib/providers/enrichment";
import type { DiscoveredBusiness } from "../src/lib/providers/contract";
import { llmClient } from "../src/lib/providers/llm";

type Block = {
  name: string;
  ok: boolean;
  detail: string;
};

const blocks: Block[] = [];

function line(char = "-"): string {
  return char.repeat(78);
}

function header(title: string): void {
  console.log(`\n${line("=")}\n${title}\n${line("=")}`);
}

function record(name: string, ok: boolean, detail: string): void {
  blocks.push({ name, ok, detail });
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------
  // 1) Descubrimiento
  // ------------------------------------------------------------------
  header("1. DESCUBRIMIENTO — 'fisioterapeutas en Madrid'");

  const started = Date.now();
  const result = await searchBusinesses({ query: "fisioterapeutas en Madrid", limit: 50 });
  const elapsed = Date.now() - started;

  console.log(`Interpretación: ${result.interpretation}`);
  console.log(`Warnings: ${result.warnings.length > 0 ? result.warnings.join(" | ") : "(ninguno)"}`);
  console.log(`\n#   Nombre                                   Web                                     Teléfono             Ciudad`);
  console.log(line("-"));

  for (const [index, business] of result.businesses.entries()) {
    console.log(
      `${String(index + 1).padStart(2)}. ${business.name.slice(0, 38).padEnd(38)} ` +
        `${(business.website ?? "-").slice(0, 38).padEnd(38)} ` +
        `${(business.phoneNumber ?? "-").padEnd(19)} ${business.city ?? business.region ?? "-"}`,
    );
  }

  const withContact = result.businesses.filter(
    (business) => Boolean(business.website) || Boolean(business.phoneNumber),
  );
  const inMadrid = result.businesses.filter(
    (business) => (business.city ?? business.region ?? "").toLowerCase().includes("madrid"),
  );
  const bySource = result.businesses.reduce<Record<string, number>>((acc, business) => {
    acc[business.source] = (acc[business.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `\nTotal: ${result.businesses.length} | con web o teléfono: ${withContact.length} | en Madrid: ${inMadrid.length} | por fuente: ${JSON.stringify(bySource)} | ${elapsed} ms`,
  );

  const discoveryOk = withContact.length >= 10;
  record(
    "Descubrimiento",
    discoveryOk,
    `${result.businesses.length} negocios reales, ${withContact.length} con web o teléfono (mínimo 10)`,
  );

  // ------------------------------------------------------------------
  // 2) Crawler de webs
  // ------------------------------------------------------------------
  header("2. CRAWLER DE WEBS — primeros 3 negocios con web");

  const withWebsite = result.businesses.filter(
    (business): business is DiscoveredBusiness & { website: string } =>
      Boolean(business.website),
  );
  const targets = withWebsite.slice(0, 3);

  let crawlFoundContact = false;
  let crawlSites = 0;

  for (const business of targets) {
    console.log(`\n→ ${business.name} (${business.website})`);
    const crawled = await crawlWebsite(business.website);
    crawlSites += 1;

    console.log(`   emails      : ${crawled.emails.length > 0 ? crawled.emails.join(", ") : "(ninguno)"}`);
    console.log(`   teléfonos   : ${crawled.phoneNumbers.length > 0 ? crawled.phoneNumbers.join(", ") : "(ninguno)"}`);
    console.log(`   descripción : ${crawled.description ?? "(ninguna)"}`);
    console.log(`   contacto    : ${crawled.contactPageUrl ?? "(sin página de contacto)"}`);
    console.log(`   dirección   : ${[crawled.address, crawled.city, crawled.region].filter(Boolean).join(", ") || "(ninguna)"}`);
    console.log(`   equipo      : ${crawled.teamMembers.length > 0 ? crawled.teamMembers.map((member) => `${member.name}${member.role ? ` (${member.role})` : ""}`).join(", ") : "(no detectado)"}`);
    console.log(`   señales     : ${crawled.signals.length > 0 ? crawled.signals.join(" | ") : "(ninguna)"}`);

    if (crawled.emails.length > 0 || crawled.phoneNumbers.length > 0) crawlFoundContact = true;
  }

  record(
    "Crawler",
    crawlFoundContact,
    crawlSites === 0
      ? "no había negocios con web en los resultados"
      : `${crawlSites} webs rastreadas, contacto encontrado: ${crawlFoundContact ? "sí" : "no"}`,
  );

  // ------------------------------------------------------------------
  // 3) Patrón de emails + verificación SMTP
  // ------------------------------------------------------------------
  header("3. EMAILS — patrón de dominio + verificación SMTP (RCPT TO, sin enviar)");

  const domains: string[] = [];
  for (const business of withWebsite) {
    const domain =
      business.domain ??
      (business.website
        ? new URL(
            business.website.startsWith("http") ? business.website : `https://${business.website}`,
          ).hostname.replace(/^www\./, "")
        : null);
    if (domain && !domains.includes(domain)) domains.push(domain);
  }

  let smtpStatus: string | null = null;
  let smtpDetail = "";

  for (const domain of domains.slice(0, 3)) {
    console.log(`\nDominio: ${domain}`);
    const candidates = discoverEmailsByPattern({ domain });
    console.log(
      `Candidatos por patrón (${candidates.length}): ${candidates.slice(0, 5).map((candidate) => `${candidate.email} [${candidate.confidence}]`).join(", ")}`,
    );

    const verified = await verifyEmails(candidates.slice(0, 4));
    for (const item of verified) {
      console.log(`   ${item.email.padEnd(42)} -> ${item.status.padEnd(11)} conf=${item.confidence}  ${item.reason}`);
    }

    // Nos quedamos con el mejor status obtido (verified > catch_all > ...).
    const rank = ["verified", "catch_all", "unverified", "risky", "invalid"] as const;
    const best = verified
      .slice()
      .sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status))[0];
    if (best) {
      smtpStatus = best.status;
      smtpDetail = `${best.email}=${best.status}`;
    }
    if (smtpStatus === "verified" || smtpStatus === "invalid") break;
  }

  record(
    "Verificación SMTP",
    smtpStatus !== null,
    smtpStatus ? `status=${smtpStatus} (${smtpDetail})` : "no se pudo verificar ningún email",
  );

  // ------------------------------------------------------------------
  // 4) LLM
  // ------------------------------------------------------------------
  header("4. LLM — cold email en español para AgendaOS");

  let llmMessage = "";
  let llmError: string | null = null;
  try {
    llmMessage = await llmClient.complete(
      [
        {
          role: "system",
          content:
            "Eres un comercial de AgendaOS, una app de agenda y citas online para profesionales sanitarios en España. Escribes emails en español, tono cercano y directo, máximo 120 palabras, sin emojis y sin titles en mayúsculas.",
        },
        {
          role: "user",
          content:
            "Escribe un cold email para una clínica de fisioterapia en Madrid que aún no tiene agenda online. Incluye un problema concreto, el beneficio y una llamada a la acción.",
        },
      ],
      { maxTokens: 2000, temperature: 0.7 },
    );
  } catch (error) {
    llmError = error instanceof Error ? error.message : String(error);
  }

  if (llmMessage) {
    console.log(llmMessage);
  } else {
    console.log(`Error del LLM: ${llmError}`);
  }

  const llmOk = llmMessage.trim().length > 0;
  record("LLM", llmOk, llmOk ? `${llmMessage.trim().length} caracteres` : (llmError ?? "sin salida"));

  // ------------------------------------------------------------------
  // Resumen
  // ------------------------------------------------------------------
  header("RESUMEN");
  for (const block of blocks) {
    console.log(`${block.ok ? "PASS" : "FAIL"}  ${block.name.padEnd(22)} ${block.detail}`);
  }

  const failed = blocks.filter((block) => !block.ok);
  console.log(`\n${blocks.length - failed.length}/${blocks.length} bloques OK.`);

  if (failed.length > 0) {
    console.log("Bloques con problemas: " + failed.map((block) => block.name).join(", "));
  }
}

main()
  .then(() => {
    const failed = blocks.filter((block) => !block.ok).length;
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error("\nError inesperado en el test de providers:", error);
    process.exit(1);
  });
