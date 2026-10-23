"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { LeadTable } from "@/components/LeadTable";
import { formatDate } from "@/components/format";
import type { LeadDTO, LeadStatus } from "@/components/types";
import {
  Card,
  EmptyState,
  ErrorBox,
  LoadingBlock,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { Icon } from "@/components/icons";

type ListDetail = {
  id: string;
  name: string;
  description: string | null;
  icp: string | null;
  createdAt: string;
};

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const listId = params.id;

  const [list, setList] = useState<ListDetail | null>(null);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ list: ListDetail; leads: LeadDTO[] }>(`/api/lists/${listId}`);
      setList(response.list);
      setLeads(response.leads ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (leadId: string, status: LeadStatus) => {
    setBusyLeadId(leadId);
    const previous = leads;
    setLeads((current) =>
      current.map((lead) => (lead.id === leadId ? { ...lead, status } : lead)),
    );
    try {
      await apiSend(`/api/leads/${leadId}`, "PATCH", { status });
    } catch (err) {
      setLeads(previous);
      setError(errorMessage(err));
    } finally {
      setBusyLeadId(null);
    }
  };

  if (loading) {
    return <LoadingBlock label="Cargando lista…" />;
  }

  if (error || !list) {
    return (
      <ErrorBox message={error ?? "No se ha encontrado la lista."} onRetry={() => void load()} />
    );
  }

  const avgScore =
    leads.length > 0
      ? Math.round(leads.reduce((total, lead) => total + lead.score, 0) / leads.length)
      : 0;

  return (
    <div className="space-y-6">
      <Link
        href="/lists"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <Icon name="chevronLeft" className="h-3.5 w-3.5" />
        Volver a listas
      </Link>

      <PageHeader
        title={list.name}
        description={list.description ?? undefined}
        actions={
          <>
            <a
              href={`/api/export/leads?listId=${encodeURIComponent(list.id)}`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Icon name="download" className="h-4 w-4" />
              Exportar CSV
            </a>
            <Link
              href={`/campaigns/new?listId=${encodeURIComponent(list.id)}`}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              <Icon name="send" className="h-4 w-4" />
              Crear campaña con esta lista
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Leads" value={leads.length} />
        <StatCard label="Score medio" value={avgScore} />
        <StatCard label="Creada" value={formatDate(list.createdAt)} />
      </div>

      {list.icp ? (
        <Card>
          <p className="text-xs tracking-wide text-slate-500 uppercase">ICP de la lista</p>
          <p className="mt-1 text-sm text-slate-700">{list.icp}</p>
        </Card>
      ) : null}

      <Card padded={false}>
        {leads.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Esta lista está vacía"
              description="Añade prospectos desde el AI Finder o crea una campaña y asígnale esta lista como destinatario."
              action={
                <Link
                  href="/finder"
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Buscar prospectos
                </Link>
              }
            />
          </div>
        ) : (
          <div className="p-4">
            <LeadTable leads={leads} onStatusChange={changeStatus} busyLeadId={busyLeadId} />
          </div>
        )}
      </Card>
    </div>
  );
}
