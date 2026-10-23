/**
 * Limpieza de prospectos: funde duplicados, descarta los leads que no son
 * contactables y repuntúa lo que queda.
 *
 *   npx tsx scripts/cleanup-leads.ts          # limpia
 *   npx tsx scripts/cleanup-leads.ts --dry    # sólo informa
 */

import { prisma } from "../src/lib/db";
import { getWorkspace } from "../src/lib/workspace";
import { scoreAndSaveLead } from "../src/lib/pipeline";
import { defaultAgendaosCriteria } from "../src/lib/scoring";
import { MEDICAL_CONTEXT_WORDS, NAME_STOPWORDS, stripAccents } from "../src/lib/providers/enrichment/website";

const dryRun = process.argv.includes("--dry");

const MEDICAL_SUBSTRINGS = MEDICAL_CONTEXT_WORDS.filter((w) => w.length >= 8).map(stripAccents);

function normalizeKey(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(sl|slu|sa|sau|sc|cb|s l|s a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿El nombre contiene una palabra clínica ("Teresa Paciente")? */
function isJunkName(name: string | null | undefined): boolean {
  if (!name) return false;
  const words = normalizeKey(name).split(" ").filter(Boolean);
  if (words.some((w) => MEDICAL_CONTEXT_WORDS.includes(w))) return true;
  if (words.some((w) => MEDICAL_SUBSTRINGS.some((token) => w.includes(token)))) return true;
  // "Fundadora Psicofisio" es un encabezado con cargo, no una persona.
  return NAME_STOPWORDS.some((word) => name.trim().startsWith(word));
}

/** Un nombre que es el de la empresa no identifica a una persona. */
function isBusinessName(name: string | null | undefined, companyName: string | null | undefined): boolean {
  if (!name || !companyName) return false;
  const a = normalizeKey(name);
  const b = normalizeKey(companyName);
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

type LeadRow = {
  id: string;
  companyId: string | null;
  fullName: string | null;
  jobTitle: string | null;
  phoneNumber: string | null;
  email: string | null;
  linkedinUrl: string | null;
  website: string | null;
  score: number;
  company: { name: string } | null;
};

/** A qué lead conviene quedarse dentro de una empresa. */
function quality(lead: LeadRow): number {
  let q = 0;
  // Una persona vale más que "el negocio" como lead.
  if (!isBusinessName(lead.fullName, lead.company?.name)) q += 6;
  if (lead.jobTitle) q += 4;
  if (lead.jobTitle && /propietari|direc|gerent|fundador|responsable|titular/i.test(lead.jobTitle)) q += 4;
  if (lead.phoneNumber) q += 2;
  if (lead.email) q += 2;
  q += Math.min(lead.score, 40) / 10;
  return q;
}

async function main() {
  const workspace = await getWorkspace();
  const leads = (await prisma.lead.findMany({
    where: { workspaceId: workspace.id },
    include: { company: { select: { id: true, name: true } } },
  })) as LeadRow[];

  const deleted: { lead: LeadRow; reason: string }[] = [];
  const renamed: { lead: LeadRow; name: string }[] = [];
  const merged: { from: LeadRow; into: LeadRow; fields: string[] }[] = [];

  // ---------------------------------------------------------------------
  // 1) Fusión por empresa: un lead por persona y un email por empresa.
  // ---------------------------------------------------------------------
  const byCompany = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    if (!lead.companyId) continue;
    byCompany.set(lead.companyId, [...(byCompany.get(lead.companyId) ?? []), lead]);
  }

  for (const group of byCompany.values()) {
    const keeper = [...group].sort((a, b) => quality(b) - quality(a))[0];
    if (!keeper) continue;

    // Si otro lead de la misma empresa ya tiene email, este que sólo comparte
    // el teléfono de la empresa no aporta (suele ser un testimonio).
    const companyHasEmail = group.some((l) => l.email);

    for (const lead of group) {
      if (lead.id === keeper.id) continue;

      // ¿Es un duplicado (mismo email o mismo nombre) o un nombre basura?
      const sameEmail = Boolean(lead.email && lead.email === keeper.email);
      const sameName = normalizeKey(lead.fullName) === normalizeKey(keeper.fullName);
      const junk = !isBusinessName(lead.fullName, lead.company?.name) && isJunkName(lead.fullName);
      const sinCanalPropio = !lead.email && companyHasEmail;

      if (!sameEmail && !sameName && !junk && !sinCanalPropio) {
        // Son dos personas distintas: se conservan las dos.
        continue;
      }

      // El lead superviviente hereda los canales de contacto que le falten.
      const fields: string[] = [];
      const patch: Record<string, string | null> = {};
      if (!keeper.email && lead.email) {
        patch.email = lead.email;
        fields.push("email");
      }
      if (!keeper.phoneNumber && lead.phoneNumber) {
        patch.phoneNumber = lead.phoneNumber;
        fields.push("teléfono");
      }
      if (!keeper.jobTitle && lead.jobTitle) {
        patch.jobTitle = lead.jobTitle;
        fields.push("cargo");
      }
      if (!keeper.linkedinUrl && lead.linkedinUrl) {
        patch.linkedinUrl = lead.linkedinUrl;
        fields.push("LinkedIn");
      }
      if (fields.length > 0) {
        if (!dryRun) await prisma.lead.update({ where: { id: keeper.id }, data: patch });
        merged.push({ from: lead, into: keeper, fields });
      }

      const reason = junk
        ? `nombre no válido (${lead.fullName})`
        : sameEmail
          ? `email duplicado en la empresa (${lead.email})`
          : sameName
            ? `mismo nombre en la misma empresa (${lead.fullName})`
            : `sin canal propio (la empresa ya tiene email)`;
      deleted.push({ lead, reason });
    }
  }

  // ---------------------------------------------------------------------
  // 2) Nombres basura que se quedan solos en su empresa: se renombran.
  // ---------------------------------------------------------------------
  const deletedIds = new Set(deleted.map((d) => d.lead.id));
  for (const lead of leads) {
    if (deletedIds.has(lead.id)) continue;
    if (isBusinessName(lead.fullName, lead.company?.name)) continue;
    if (!isJunkName(lead.fullName)) continue;
    const siblings = leads.filter(
      (l) => l.companyId && l.companyId === lead.companyId && l.id !== lead.id && !deletedIds.has(l.id),
    );
    if (siblings.length === 0 && lead.company?.name) {
      renamed.push({ lead, name: lead.company.name });
    }
  }

  // ---------------------------------------------------------------------
  // 3) Leads sin ningún canal de contacto: no se pueden vender.
  // ---------------------------------------------------------------------
  for (const lead of leads) {
    if (deletedIds.has(lead.id)) continue;
    if (renamed.some((r) => r.lead.id === lead.id)) continue;
    if (!lead.email && !lead.phoneNumber) {
      deleted.push({ lead, reason: "sin email ni teléfono" });
    }
  }

  console.log(`Leads totales: ${leads.length}`);
  console.log(`A eliminar: ${deleted.length} · a renombrar: ${renamed.length} · a fundir: ${merged.length}`);
  for (const item of deleted) {
    console.log(`  ✗ ${item.lead.fullName ?? "(sin nombre)"} <${item.lead.email ?? "sin email"}> — ${item.reason}`);
  }
  for (const item of renamed) {
    console.log(`  ↻ ${item.lead.fullName} → ${item.name}`);
  }
  for (const item of merged) {
    console.log(`  → ${item.from.fullName} se funde en ${item.into.fullName} (hereda ${item.fields.join(", ")})`);
  }

  if (!dryRun) {
    if (deleted.length > 0) {
      await prisma.lead.deleteMany({ where: { id: { in: deleted.map((d) => d.lead.id) } } });
      console.log(`  ✓ ${deleted.length} leads eliminados`);
    }
    for (const item of renamed) {
      const parts = item.name.trim().split(/\s+/);
      await prisma.lead.update({
        where: { id: item.lead.id },
        data: {
          fullName: item.name,
          firstName: parts[0] ?? null,
          lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
        },
      });
    }
    if (renamed.length > 0) {
      console.log(`  ✓ ${renamed.length} leads renombrados con el nombre de la empresa`);
    }
  }

  const criteria = defaultAgendaosCriteria();
  const remaining = await prisma.lead.findMany({ where: { workspaceId: workspace.id } });
  if (!dryRun) {
    for (const lead of remaining) {
      await scoreAndSaveLead(workspace.id, lead.id, criteria);
    }
  }
  const withEmail = remaining.filter((l) => l.email).length;
  console.log(`Leads finales: ${remaining.length} (${withEmail} con email)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
