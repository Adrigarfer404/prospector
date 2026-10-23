"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { LeadTable } from "@/components/LeadTable";
import { LEAD_STATUS_OPTIONS } from "@/components/format";
import type { LeadDTO, LeadStatus } from "@/components/types";
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  TableSkeleton,
} from "@/components/ui";
import { Icon } from "@/components/icons";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "Todos los estados" },
  ...LEAD_STATUS_OPTIONS,
];

const SCORE_OPTIONS = [
  { value: "", label: "Cualquier score" },
  { value: "40", label: "Score 40 o más" },
  { value: "70", label: "Score 70 o más" },
  { value: "90", label: "Score 90 o más" },
];

const EMAIL_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "true", label: "Solo con email" },
  { value: "false", label: "Solo sin email" },
];

const PROFILE_OPTIONS = [
  { value: "", label: "Todos los perfiles" },
  { value: "autonomo", label: "Profesional independiente" },
  { value: "negocio_sin_crm", label: "Pequeño negocio sin CRM" },
  { value: "negocio_con_equipo", label: "Pequeño negocio con equipo" },
  { value: "con_crm", label: "Ya tiene CRM" },
  { value: "cadena", label: "Cadena o policlínica" },
  { value: "plataforma", label: "Plataforma de citas" },
  { value: "desconocido", label: "Sin analizar" },
];

const SORT_OPTIONS = [
  { value: "score", label: "Mejor score" },
  { value: "created", label: "Más recientes" },
  { value: "name", label: "Nombre (A-Z)" },
];

function LeadsContent() {
  const searchParams = useSearchParams();
  const listId = searchParams.get("listId") ?? "";
  const companyId = searchParams.get("companyId") ?? "";

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [minScore, setMinScore] = useState("");
  const [hasEmail, setHasEmail] = useState("");
  const [profile, setProfile] = useState("");
  const [sort, setSort] = useState("score");
  const [skip, setSkip] = useState(0);

  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(queryInput);
      setSkip(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (listId) params.set("listId", listId);
      if (companyId) params.set("companyId", companyId);
      if (status) params.set("status", status);
      if (query) params.set("q", query);
      if (minScore) params.set("minScore", minScore);
      if (hasEmail) params.set("hasEmail", hasEmail);
      if (profile) params.set("profile", profile);
      if (sort) params.set("sort", sort);
      params.set("take", String(PAGE_SIZE));
      params.set("skip", String(skip));

      const response = await apiGet<{ leads: LeadDTO[]; total: number }>(
        `/api/leads?${params.toString()}`,
      );
      setLeads(response.leads ?? []);
      setTotal(response.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [listId, companyId, status, query, minScore, hasEmail, profile, sort, skip]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (leadId: string, next: LeadStatus) => {
    setBusyLeadId(leadId);
    setStatusError(null);
    const previous = leads;
    setLeads((current) =>
      current.map((lead) => (lead.id === leadId ? { ...lead, status: next } : lead)),
    );
    try {
      await apiSend(`/api/leads/${leadId}`, "PATCH", { status: next });
    } catch (err) {
      setLeads(previous);
      setStatusError(errorMessage(err));
    } finally {
      setBusyLeadId(null);
    }
  };

  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = `/api/export/leads${listId ? `?listId=${encodeURIComponent(listId)}` : ""}`;

  const filtersActive = useMemo(
    () => Boolean(query || status || minScore || hasEmail || profile || listId || companyId),
    [query, status, minScore, hasEmail, profile, listId, companyId],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Todos los prospectos que has encontrado, con su score, su estado y sus datos de contacto."
        actions={
          <a
            href={exportHref}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Icon name="download" className="h-4 w-4" />
            Exportar CSV
          </a>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="lead-search">
              Buscar
            </label>
            <Input
              id="lead-search"
              value={queryInput}
              onChange={setQueryInput}
              placeholder="Nombre, email, cargo o empresa"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="lead-status">
              Estado
            </label>
            <Select
              id="lead-status"
              value={status}
              onChange={(value) => {
                setStatus(value);
                setSkip(0);
              }}
              options={STATUS_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="lead-score">
              Score mínimo
            </label>
            <Select
              id="lead-score"
              value={minScore}
              onChange={(value) => {
                setMinScore(value);
                setSkip(0);
              }}
              options={SCORE_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="lead-email">
              Email
            </label>
            <Select
              id="lead-email"
              value={hasEmail}
              onChange={(value) => {
                setHasEmail(value);
                setSkip(0);
              }}
              options={EMAIL_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="lead-profile">
              Perfil
            </label>
            <Select
              id="lead-profile"
              value={profile}
              onChange={(value) => {
                setProfile(value);
                setSkip(0);
              }}
              options={PROFILE_OPTIONS}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <label
                className="mb-1.5 block text-sm font-medium text-slate-700"
                htmlFor="lead-sort"
              >
                Ordenar por
              </label>
              <Select id="lead-sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
            </div>
            {filtersActive ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setQueryInput("");
                  setQuery("");
                  setStatus("");
                  setMinScore("");
                  setHasEmail("");
                  setSkip(0);
                }}
              >
                <Icon name="close" className="h-3.5 w-3.5" />
                Limpiar filtros
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-slate-500">
            {loading ? "Cargando…" : `${total} ${total === 1 ? "lead" : "leads"}`}
          </p>
        </div>
      </Card>

      {statusError ? <ErrorBox message={statusError} /> : null}
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      <Card padded={false}>
        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : leads.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Aún no hay prospectos"
              description={
                filtersActive
                  ? "Ningún lead coincide con estos filtros. Prueba a limpiarlos."
                  : "Prueba con 'fisioterapeutas en Madrid' en el AI Finder para empezar."
              }
              action={
                filtersActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQueryInput("");
                      setQuery("");
                      setStatus("");
                      setMinScore("");
                      setHasEmail("");
                    }}
                  >
                    Limpiar filtros
                  </Button>
                ) : (
                  <Link
                    href="/finder"
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Ir al AI Finder
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <div className="p-4">
            <LeadTable leads={leads} onStatusChange={changeStatus} busyLeadId={busyLeadId} />
          </div>
        )}
      </Card>

      {!loading && leads.length > 0 ? (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>
            Anterior
          </Button>
          <span className="text-sm text-slate-500">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={skip + PAGE_SIZE >= total}
            onClick={() => setSkip(skip + PAGE_SIZE)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando leads…" />}>
      <LeadsContent />
    </Suspense>
  );
}
