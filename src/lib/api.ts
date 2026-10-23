import { NextResponse } from "next/server";
import { prisma } from "./db";
import { getWorkspace } from "./workspace";
import { parseJson, type CompanyDTO, type LeadDTO } from "./types";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

export function serverError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function workspace() {
  return getWorkspace();
}

/* ---------- Mappers DTO ---------- */

type LeadWithRelations = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
  website: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: string;
  score: number;
  scoreReason: string | null;
  profile: string;
  fitNotes: string | null;
  source: string;
  aiSummary: string | null;
  notes: string | null;
  enrichment: string;
  companyId: string | null;
  lastContactedAt: Date | null;
  createdAt: Date;
  company?: { name: string | null; website: string | null; domain: string | null } | null;
  emails?: { email: string; status: string; source: string; confidence: number }[];
  listItems?: { listId: string }[];
};

export function toLeadDTO(lead: LeadWithRelations): LeadDTO {
  return {
    id: lead.id,
    fullName: lead.fullName,
    firstName: lead.firstName,
    lastName: lead.lastName,
    jobTitle: lead.jobTitle,
    email: lead.email,
    phoneNumber: lead.phoneNumber,
    linkedinUrl: lead.linkedinUrl,
    website: lead.website,
    city: lead.city,
    region: lead.region,
    country: lead.country,
    status: lead.status as LeadDTO["status"],
    score: lead.score,
    scoreReason: lead.scoreReason,
    profile: lead.profile ?? "desconocido",
    fitNotes: lead.fitNotes,
    source: lead.source,
    aiSummary: lead.aiSummary,
    notes: lead.notes,
    enrichment: parseJson(lead.enrichment, {}),
    companyId: lead.companyId,
    companyName: lead.company?.name ?? null,
    companyWebsite: lead.company?.website ?? null,
    companyDomain: lead.company?.domain ?? null,
    emails: lead.emails ?? [],
    listIds: (lead.listItems ?? []).map((li) => li.listId),
    lastContactedAt: lead.lastContactedAt ? lead.lastContactedAt.toISOString() : null,
    createdAt: lead.createdAt.toISOString(),
  };
}

export const leadInclude = {
  company: { select: { name: true, website: true, domain: true } },
  emails: {
    select: { email: true, status: true, source: true, confidence: true },
    orderBy: { confidence: "desc" as const },
  },
  listItems: { select: { listId: true } },
};

export type CompanyWithCount = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
  size: string | null;
  employees: number | null;
  source: string;
  score: number;
  tags: string;
  createdAt: Date;
  _count?: { leads: number };
};

export function toCompanyDTO(company: CompanyWithCount): CompanyDTO {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    website: company.website,
    industry: company.industry,
    description: company.description,
    city: company.city,
    region: company.region,
    country: company.country,
    phoneNumber: company.phoneNumber,
    linkedinUrl: company.linkedinUrl,
    size: company.size,
    employees: company.employees,
    source: company.source,
    score: company.score,
    tags: parseJson<string[]>(company.tags, []),
    leadCount: company._count?.leads ?? 0,
    createdAt: company.createdAt.toISOString(),
  };
}
