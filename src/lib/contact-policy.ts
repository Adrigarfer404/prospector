import { prisma } from "./db";

/** Comprueba tanto el estado del lead como las entradas normalizadas de bloqueo. */
export async function isContactBlocked(workspaceId: string, lead: {
  status: string; email: string | null; phoneNumber: string | null;
  linkedinUrl: string | null; fullName: string | null;
}, destination?: string | null): Promise<string | null> {
  if (["unsubscribed", "do_not_contact", "bounced"].includes(lead.status)) return `Lead excluido: ${lead.status}`;
  const entries = await prisma.blocklistEntry.findMany({ where: { workspaceId } });
  const emails = [lead.email, destination].filter((v): v is string => Boolean(v)).map(v => v.trim().toLowerCase());
  const values: Record<string, string[]> = {
    email: emails,
    domain: emails.map(e => e.split("@")[1] ?? ""),
    phone: [lead.phoneNumber ?? ""].map(v => v.replace(/\D/g, "")),
    linkedin: [lead.linkedinUrl ?? ""].map(v => v.trim().toLowerCase()),
    name: [lead.fullName ?? ""].map(v => v.trim().toLowerCase()),
  };
  for (const entry of entries) {
    const value = entry.type === "phone" ? entry.value.replace(/\D/g, "") : entry.value.trim().toLowerCase();
    if (value && values[entry.type]?.includes(value)) return "Lead incluido en la lista de bloqueo";
  }
  return null;
}
