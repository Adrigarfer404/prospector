/**
 * Test de generación de mensajes: comprueba que el LLM responde y que el
 * resultado es un email en español utilizable.
 *   npx tsx scripts/test-messages.ts
 */
import { generateEmailMessage, generateLinkedInMessage } from "../src/lib/messages";

const ctx = {
  lead: {
    fullName: "Dra. Elena Márquez",
    firstName: "Elena",
    jobTitle: "Fisioterapeuta y directora de la clínica",
    city: "Madrid",
    website: "https://fisiomadrid.es",
    email: "administracion@fisiomadrid.es",
    phoneNumber: "914331264",
    enrichment: { signals: ["Usa un sistema de reservas externo"] },
  },
  company: {
    name: "FisioMadrid",
    website: "https://fisiomadrid.es",
    industry: "Fisioterapia",
    city: "Madrid",
    description: "Centro de fisioterapia y rehabilitación en Madrid",
    employees: 4,
  },
  playbook: {
    ourCompany: "AgendaOS",
    ourOffer:
      "Agenda de citas online con recordatorios automáticos, ficha de paciente y cobros para profesionales sanitarios independientes",
    ourValue: "dejar de perder pacientes por huecos en la agenda y por recordatorios que nadie manda",
    proofPoints: ["Recordatorios automáticos por email y WhatsApp", "Cobro online confirmado"],
    tone: "profesional y cercano, sin jerga de software",
    language: "es",
    cta: "¿Te enseño en 10 minutos cómo quedaría tu agenda?",
    signature: "Un saludo,\nAlvaro\nAgendaOS · agendaos.es",
  },
  identity: { name: "Alvaro", email: "alvaro@agendaos.es" },
};

async function main() {
  console.log("→ Generando email…");
  const started = Date.now();
  const email = await generateEmailMessage(ctx, { stepName: "Primer email" });
  console.log(`   fuente: ${email.source} · ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  console.log("   ASUNTO:", email.subject);
  console.log("   ---");
  console.log(
    email.body
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n"),
  );
  console.log("   ---");
  if (email.rationale) console.log("   Razonamiento:", email.rationale);

  console.log("\n→ Generando mensaje de LinkedIn…");
  const li = await generateLinkedInMessage(ctx);
  console.log("   ", li);

  const ok = email.source === "llm" && email.body.length > 60 && li.length > 20;
  console.log(`\n${ok ? "PASS" : "FAIL"}: email=${email.source}, cuerpo=${email.body.length} chars, linkedin=${li.length} chars`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
