"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_STATUS_OPTIONS, displayName, formatDate } from "@/components/format";
import type { LeadDTO, LeadStatus } from "@/components/types";
import { Badge, ScoreBadge, Select } from "@/components/ui";

export function LeadTable({
  leads,
  onStatusChange,
  busyLeadId = null,
}: {
  leads: LeadDTO[];
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
  busyLeadId?: string | null;
}) {
  const router = useRouter();

  // La fila entera es clicable, pero sin interferir con enlaces ni con el selector de estado.
  const openLead = (event: React.MouseEvent<HTMLTableRowElement>, leadId: string) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button, select, input")) return;
    router.push(`/leads/${leadId}`);
  };

  return (
    <>
      {/* Tabla en escritorio */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Empresa</th>
              <th className="px-3 py-2 font-medium">Cargo</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Teléfono</th>
              <th className="px-3 py-2 font-medium">Ciudad</th>
              <th className="px-3 py-2 font-medium">Perfil</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={(event) => openLead(event, lead.id)}
                className="align-middle cursor-pointer hover:bg-slate-50/70"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="font-medium text-slate-900 hover:text-indigo-700"
                  >
                    {lead.fullName || lead.companyName || "Sin nombre"}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-slate-600">{lead.companyName || "—"}</td>
                <td className="px-3 py-2.5 text-slate-600">{lead.jobTitle || "—"}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {lead.email ? (
                    <span className="break-all">{lead.email}</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{lead.phoneNumber || "—"}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {[lead.city, lead.region].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <ProfileBadge profile={lead.profile} />
                </td>
                <td className="px-3 py-2.5">
                  <ScoreBadge score={lead.score} />
                </td>
                <td className="px-3 py-2.5">
                  {onStatusChange ? (
                    <Select
                      value={lead.status}
                      onChange={(value) => onStatusChange(lead.id, value)}
                      options={LEAD_STATUS_OPTIONS}
                      className="min-w-[9.5rem] py-1 text-xs"
                      disabled={busyLeadId === lead.id}
                    />
                  ) : (
                    <span className="text-xs text-slate-600">{lead.status}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap text-slate-500">
                  {formatDate(lead.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas en móvil */}
      <div className="divide-y divide-slate-100 md:hidden">
        {leads.map((lead) => (
          <div key={lead.id} className="space-y-2 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/leads/${lead.id}`}
                  className="font-medium text-slate-900 hover:text-indigo-700"
                >
                  {displayName(lead)}
                </Link>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {[lead.jobTitle, lead.companyName].filter(Boolean).join(" · ") || "Sin datos"}
                </p>
              </div>
              <ScoreBadge score={lead.score} />
            </div>
            <div className="flex flex-col gap-1 text-xs text-slate-600">
              {lead.email ? <span className="break-all">{lead.email}</span> : null}
              {lead.phoneNumber ? <span>{lead.phoneNumber}</span> : null}
              {[lead.city, lead.region].filter(Boolean).length > 0 ? (
                <span>{[lead.city, lead.region].filter(Boolean).join(", ")}</span>
              ) : null}
            </div>
            {onStatusChange ? (
              <Select
                value={lead.status}
                onChange={(value) => onStatusChange(lead.id, value)}
                options={LEAD_STATUS_OPTIONS}
                className="py-1 text-xs"
                disabled={busyLeadId === lead.id}
              />
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

/** Etiquetas y color del perfil comercial del prospecto. */
const PROFILE_META: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  autonomo: { label: "Autónomo", tone: "green" },
  negocio_sin_crm: { label: "Sin CRM", tone: "green" },
  negocio_con_equipo: { label: "Con equipo", tone: "amber" },
  con_crm: { label: "Con CRM", tone: "amber" },
  cadena: { label: "Cadena", tone: "red" },
  plataforma: { label: "Plataforma", tone: "red" },
  desconocido: { label: "Sin analizar", tone: "slate" },
};

export function ProfileBadge({ profile }: { profile?: string | null }) {
  const meta = PROFILE_META[profile ?? "desconocido"] ?? PROFILE_META.desconocido;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
