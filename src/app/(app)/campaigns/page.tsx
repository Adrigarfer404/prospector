"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { campaignChannelLabel, campaignStatusLabel, formatDate } from "@/components/format";
import type { CampaignDTO } from "@/components/types";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  LoadingBlock,
  PageHeader,
  type Tone,
} from "@/components/ui";

function statusTone(status: string): Tone {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "slate";
  return "indigo";
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ campaigns: CampaignDTO[] }>("/api/campaigns");
      setCampaigns(response.campaigns ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas"
        description="Secuencias multicanal: define los pasos, añade destinatarios y lanza el envío."
        actions={
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <Icon name="plus" className="h-4 w-4" />
            Nueva campaña
          </Link>
        }
      />

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingBlock label="Cargando campañas…" />
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="Todavía no tienes campañas"
          description="Crea una campaña, añade tus leads y deja que el agente siga la secuencia por ti."
          action={
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Crear campaña
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-indigo-300"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
                  {campaign.name}
                </h2>
                <Badge tone={statusTone(campaign.status)} dot>
                  {campaignStatusLabel(campaign.status)}
                </Badge>
              </div>
              {campaign.description ? (
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">{campaign.description}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="slate">{campaignChannelLabel(campaign.channel)}</Badge>
                <Badge tone="slate">{campaign.steps.length} pasos</Badge>
                <Badge tone="slate">{campaign.recipients} destinatarios</Badge>
                {campaign.autoSend ? <Badge tone="green">Envío automático</Badge> : null}
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                <div>
                  <dt className="text-[11px] text-slate-500">Enviados</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {campaign.stats.sent ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Respuestas</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {campaign.stats.replied ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Pendientes</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {campaign.stats.pending ?? 0}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-[11px] text-slate-400">Creada el {formatDate(campaign.createdAt)}</p>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">¿Cómo funciona el envío?</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Cada paso se ejecuta cuando vence su espera. Si un lead responde, la secuencia se
              detiene para ese lead. Sin SMTP configurado los mensajes se encolan para que los envíes
              a mano.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Configurar envío
          </Link>
        </div>
      </Card>
    </div>
  );
}
