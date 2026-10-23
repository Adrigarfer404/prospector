/**
 * Seed de la app: deja la instancia local con datos REALES para poder vender
 * desde el primer minuto.
 *
 *   npx tsx scripts/seed.ts
 *
 * Flags opcionales:
 *   --queries "fisioterapeutas en Madrid,nutricionistas en Valencia"
 *   --limit 25         negocios por consulta
 *   --enrich 10        negocios a enriquecer por consulta
 *   --skip-discovery  no llama a las APIs externas (sólo crea estructura)
 */

import { prisma } from "../src/lib/db";
import { getWorkspace } from "../src/lib/workspace";
import { discoverProspects, scoreAndSaveLead } from "../src/lib/pipeline";
import { defaultAgendaosCriteria } from "../src/lib/scoring";

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const DEFAULT_QUERIES = [
  "fisioterapia en Madrid",
  "nutrición en Valencia",
  "odontología en Barcelona",
  "psicología en Sevilla",
];

const PLAYBOOK = {
  ourCompany: "AgendaOS",
  ourOffer:
    "Agenda de citas online con recordatorios automáticos, ficha de paciente, evoluciones y cobros para profesionales sanitarios independientes",
  ourValue:
    "dejar de perder pacientes por huecos en la agenda, por recordatorios que nadie manda y por cobros que se pierden",
  icpSummary:
    "Profesionales sanitarios autónomos e independientes en España (fisioterapeutas, nutricionistas, dentistas, psicólogos, osteópatas, logopedas) y pequeños negocios de salud con consulta propia, que gestionan las citas a mano: por teléfono, WhatsApp, papel o con una agenda de terceros, y que no tienen un CRM.",
  disqualified: [
    "Cadenas, franquicias, policlínicas y centros con varias sedes",
    "Hospitales y centros públicos o de grandes aseguradoras",
    "Clínicas con equipo de 4 o más profesionales (no es un autónomo)",
    "Profesionales que ya usan un CRM o software de gestión de pacientes",
  ],
  proofPoints: [
    "No necesitas comprar un CRM ni saber de informática: se monta en 5 minutos",
    "Recordatorios automáticos por email y WhatsApp: menos pacientes que no se presentan",
    "Ficha del paciente con historial y evoluciones en el mismo sitio",
    "Cobro online y confirmado, para dejar de cobrar al final de la consulta",
    "Funciona desde el móvil, para atender entre paciente y paciente",
  ],
  tone: "profesional, cercano, tratando de igual a igual, sin jerga de software y sin promesas exageradas",
  language: "es",
  cta: "¿Te enseño en 10 minutos cómo quedaría tu agenda?",
  signature: "Un saludo,\nAlvaro\nAgendaOS · agendaos.es",
};

const DEFAULT_SEQUENCE = [
  {
    type: "email",
    name: "Primer email",
    delayDays: 0,
    delayHours: 0,
    subject: "Tu agenda, sin huecos ni pacientes perdidos",
    body:
      "Hola {{firstName}},\n\nHe visto que {{company}} gestiona las citas {{city}}. En AgendaOS montamos la agenda online, los recordatorios y el cobro de la reserva en el mismo sitio, para que no se te escape ningún paciente.\n\n{{cta}}\n\n{{signature}}",
    aiEnabled: true,
  },
  {
    type: "linkedin_connect",
    name: "Conexión LinkedIn",
    delayDays: 2,
    delayHours: 0,
    aiEnabled: true,
  },
  {
    type: "linkedin_message",
    name: "Mensaje LinkedIn",
    delayDays: 3,
    delayHours: 0,
    aiEnabled: true,
  },
  {
    type: "email",
    name: "Seguimiento email",
    delayDays: 4,
    delayHours: 0,
    subject: "¿Lo dejamos para la vuelta que viene?",
    body:
      "Hola {{firstName}},\n\nTe escribo por si quieres que te enseñe la agenda funcionando con datos de ejemplo de {{company}}. Sin compromiso.\n\n{{cta}}\n\n{{signature}}",
    aiEnabled: true,
  },
  {
    type: "call",
    name: "Llamada",
    delayDays: 5,
    delayHours: 0,
    aiEnabled: false,
  },
  {
    type: "wait",
    name: "Espera",
    delayDays: 5,
    delayHours: 0,
    aiEnabled: false,
  },
  {
    type: "email",
    name: "Último email",
    delayDays: 0,
    delayHours: 0,
    subject: "Cierro el tema",
    body:
      "Hola {{firstName}},\n\nTe dejo de spam: si en algún momento quieres quitarte las citas de la cabeza, escríbeme y lo miramos.\n\nUn saludo,\nAlvaro",
    aiEnabled: true,
  },
];

async function main() {
  console.log("→ Preparando workspace…");
  const workspace = await getWorkspace();

  const PLAYBOOK_ROW = {
    ...PLAYBOOK,
    disqualified: JSON.stringify(PLAYBOOK.disqualified),
    proofPoints: JSON.stringify(PLAYBOOK.proofPoints),
  };
  await prisma.playbook.upsert({
    where: { workspaceId: workspace.id },
    update: PLAYBOOK_ROW,
    create: { workspaceId: workspace.id, ...PLAYBOOK_ROW },
  });
  console.log("  ✓ Playbook de AgendaOS configurado");

  const criteria = defaultAgendaosCriteria();
  await prisma.playbook.update({
    where: { workspaceId: workspace.id },
    data: { icpCriteria: JSON.stringify(criteria) },
  });
  console.log(`  ✓ ${criteria.length} criterios de ICP por defecto`);

  const identityCount = await prisma.identity.count({ where: { workspaceId: workspace.id } });
  if (identityCount === 0) {
    await prisma.identity.create({
      data: {
        workspaceId: workspace.id,
        name: "Alvaro · AgendaOS",
        email: "alvaro@agendaos.es",
        isDefault: true,
      },
    });
    console.log("  ✓ Identidad de envío por defecto creada (sin SMTP: se encolan los envíos)");
  }

  // Campaña por defecto con la secuencia multicanal.
  const campaignName = "Secuencia inicial · AgendaOS";
  const existingCampaign = await prisma.campaign.findFirst({
    where: { workspaceId: workspace.id, name: campaignName },
  });
  if (!existingCampaign) {
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: workspace.id,
        name: campaignName,
        description:
          "Secuencia estándar: email → LinkedIn → email → llamada. Los mensajes de email se generan con IA y se personalize con los datos del negocio.",
        objective: "Concertar una demo de 10 minutos",
        channel: "mixed",
        autoSend: false,
        steps: {
          create: DEFAULT_SEQUENCE.map((step, index) => ({
            order: index,
            type: step.type,
            name: step.name,
            delayDays: step.delayDays,
            delayHours: step.delayHours,
            subject: "subject" in step ? step.subject : null,
            body: "body" in step ? step.body : null,
            aiEnabled: step.aiEnabled,
            stopOnReply: true,
            settings: JSON.stringify(
              step.type === "linkedin_connect" ? { linkedinAction: "connect" } : {},
            ),
          })),
        },
      },
    });
    console.log(`  ✓ Campaña "${campaignName}" con ${DEFAULT_SEQUENCE.length} pasos`);
  }

  if (hasFlag("rescore")) {
    console.log("→ Recalculando scores con los criterios actuales…");
    const leads = await prisma.lead.findMany({ select: { id: true } });
    for (const lead of leads) {
      await scoreAndSaveLead(workspace.id, lead.id, criteria);
    }
    console.log(`  ✓ ${leads.length} leads repuntuados`);
  }

  if (hasFlag("reenrich")) {
    console.log("→ Reenriqueciendo webs de los negocios existentes…");
    const { crawlWebsite } = await import("../src/lib/providers/enrichment/website");
    const companies = await prisma.company.findMany({
      where: { workspaceId: workspace.id, website: { not: null } },
    });
    let crawled = 0;
    for (const company of companies) {
      if (!company.website) continue;
      try {
        const result = await crawlWebsite(company.website);
        const previous = JSON.parse(company.enrichment || "{}") as Record<string, unknown>;
        // Se reemplazan las señales: si no, las antiguas (p.ej. una detección
        // de "cadena" que ya no se da) se quedan pegadas para siempre.
        const signals = [...new Set(result.signals)];
        await prisma.company.update({
          where: { id: company.id },
          data: {
            phoneNumber: company.phoneNumber ?? result.phoneNumbers[0] ?? null,
            description: company.description ?? result.description ?? null,
            enrichment: JSON.stringify({
              ...previous,
              signals,
              teamMembers: result.teamMembers,
              contactPageUrl: result.contactPageUrl,
            }),
          },
        });
        // Propaga al lead y repuntúa.
        const leads = await prisma.lead.findMany({ where: { companyId: company.id } });
        for (const lead of leads) {
          const leadEnrichment = JSON.parse(lead.enrichment || "{}") as Record<string, unknown>;
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              enrichment: JSON.stringify({
                ...leadEnrichment,
                signals: [...new Set(signals)],
                teamMembers: result.teamMembers,
              }),
            },
          });
          await scoreAndSaveLead(workspace.id, lead.id, criteria);
        }
        crawled += 1;
        console.log(`  ✓ ${company.name} — ${result.teamMembers.length} profesionales, ${result.signals.length} señales`);
      } catch (err) {
        console.log(`  ! ${company.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`  ✓ ${crawled} webs reenriquecidas`);
  }

  if (hasFlag("skip-discovery")) {
    console.log("→ Saltando descubrimiento (--skip-discovery).");
    await summarise();
    return;
  }

  const queries = (arg("queries") ?? DEFAULT_QUERIES.join(",")).split(",").map((q) => q.trim());
  const limit = Number(arg("limit") ?? "25");
  const enrichLimit = Number(arg("enrich") ?? "10");

  for (const query of queries) {
    if (!query) continue;
    const listName = query.charAt(0).toUpperCase() + query.slice(1);
    const list = await prisma.list.findFirst({
      where: { workspaceId: workspace.id, name: listName },
    });
    const targetList =
      list ??
      (await prisma.list.create({
        data: {
          workspaceId: workspace.id,
          name: listName,
          description: `Prospectos de: ${query}`,
          icp: query,
        },
      }));

    console.log(`→ Buscando "${query}"…`);
    const outcome = await discoverProspects({
      workspaceId: workspace.id,
      query,
      limit,
      enrichLimit,
      listId: targetList.id,
      criteria,
    });
    console.log(
      `  ✓ ${outcome.found} negocios · ${outcome.leads} leads · ${outcome.enriched} enriquecidos`,
    );
    for (const warning of outcome.warnings.slice(0, 3)) {
      console.log(`  ! ${warning}`);
    }
  }

  await summarise();
}

async function summarise() {
  const [leads, companies, lists, campaigns] = await Promise.all([
    prisma.lead.count(),
    prisma.company.count(),
    prisma.list.count(),
    prisma.campaign.count(),
  ]);
  const top = await prisma.lead.findMany({
    include: { company: { select: { name: true } } },
    orderBy: { score: "desc" },
    take: 8,
  });
  console.log("\n=== RESUMEN ===");
  console.log(`Empresas: ${companies} · Leads: ${leads} · Listas: ${lists} · Campañas: ${campaigns}`);
  console.log("\nTop leads por score:");
  for (const lead of top) {
    console.log(
      `  ${String(lead.score).padStart(3)}  ${lead.fullName ?? "—"} — ${lead.jobTitle ?? ""} @ ${lead.company?.name ?? "—"} ${lead.email ? `[${lead.email}]` : ""}`,
    );
  }
  console.log("\nArranca la app con:  npm run dev");
}

main()
  .catch((err) => {
    console.error("Seed falló:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
