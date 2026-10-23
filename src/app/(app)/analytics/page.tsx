"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import {
  LEAD_STATUS_OPTIONS,
  campaignStatusLabel,
  formatDateTime,
  formatRelative,
  leadStatusLabel,
} from "@/components/format";
import type { AnalyticsDTO } from "@/components/types";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  StatCard,
} from "@/components/ui";

const ACTIVITY_LABELS: Record<string, string> = {
  "finder.search": "Búsqueda en el AI Finder",
  "campaign.run": "Ejecución de campaña",
  "campaign.launch": "Campaña activada",
  "inbox.reply": "Respuesta recibida",
  "lead.created": "Lead creado",
};

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<AnalyticsDTO>("/api/analytics");
      setAnalytics(response);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <LoadingBlock label="Cargando métricas…" />;
  }

  if (error || !analytics) {
    return <ErrorBox message={error ?? "No se han podido cargar las métricas."} onRetry={() => void load()} />;
  }

  const { totals, leadsByStatus, campaigns, activity } = analytics;
  const statusEntries = Object.entries(leadsByStatus);
  const maxStatus = Math.max(1, ...statusEntries.map(([, value]) => value));

  const responseRate = totals.sent > 0 ? Math.round((totals.replies / totals.sent) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Cómo va tu prospección: cuántos leads tienes, cuánto has enviado y cuántas respuestas has conseguido."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Actualizar
          </button>
        }
      />

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Leads" value={totals.leads} hint={`${totals.companies} empresas`} />
        <StatCard label="Score medio" value={totals.avgScore} hint="Puntuación media de tus leads" />
        <StatCard label="Mensajes enviados" value={totals.sent} hint={`${responseRate}% de respuesta`} />
        <StatCard label="Respuestas" value={totals.replies} hint={`${totals.pendingTasks} tareas pendientes`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Listas" value={totals.lists} />
        <StatCard label="Campañas" value={totals.campaigns} />
        <StatCard label="Conversaciones" value={totals.conversations} />
        <StatCard label="Tareas pendientes" value={totals.pendingTasks} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="Distribución de tus leads por estado">Leads por estado</SectionTitle>
          {statusEntries.length === 0 ? (
            <EmptyState
              title="Sin leads todavía"
              description="Busca prospectos en el AI Finder para empezar a ver el embudo."
            />
          ) : (
            <ul className="space-y-3">
              {statusEntries
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <li key={status}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{leadStatusLabel(status)}</span>
                      <span className="font-medium text-slate-900">{count}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.round((count / maxStatus) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Embudo típico: {LEAD_STATUS_OPTIONS.map((option) => option.label).join(" → ")}.
          </p>
        </Card>

        <Card>
          <SectionTitle>Campañas</SectionTitle>
          {campaigns.length === 0 ? (
            <EmptyState
              title="Sin campañas"
              description="Crea tu primera campaña para empezar a medir el outreach."
              action={
                <Link
                  href="/campaigns/new"
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Nueva campaña
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="truncate text-sm font-medium text-slate-800 hover:text-indigo-700"
                  >
                    {campaign.name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="slate">{campaign.recipients} destinatarios</Badge>
                    <Badge
                      tone={
                        campaign.status === "active"
                          ? "green"
                          : campaign.status === "paused"
                            ? "amber"
                            : "slate"
                      }
                    >
                      {campaignStatusLabel(campaign.status)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>Actividad reciente</SectionTitle>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay actividad registrada.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">
                    {ACTIVITY_LABELS[item.type] ?? item.type}
                    {item.subject ? (
                      <span className="text-slate-500"> · {item.subject}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-400">{formatDateTime(item.createdAt)}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{formatRelative(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
