"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import {
  LEAD_STATUS_OPTIONS,
  channelLabel,
  displayName,
  emailStatusLabel,
  formatDate,
  formatDateTime,
  leadStatusLabel,
  recipientStatusLabel,
} from "@/components/format";
import type { CampaignDTO, LeadDTO, LeadDetailDTO, LeadStatus } from "@/components/types";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  LoadingBlock,
  Modal,
  NoticeBox,
  PageHeader,
  ScoreBadge,
  SectionTitle,
  Select,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params.id;

  const [lead, setLead] = useState<LeadDetailDTO | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [addingToCampaign, setAddingToCampaign] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadResponse, campaignResponse] = await Promise.all([
        apiGet<{ lead: LeadDetailDTO }>(`/api/leads/${leadId}`),
        apiGet<{ campaigns: CampaignDTO[] }>("/api/campaigns"),
      ]);
      setLead(leadResponse.lead);
      setNotes(leadResponse.lead.notes ?? "");
      setCampaigns(campaignResponse.campaigns ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, successMessage: string) => {
    setActionError(null);
    setNotice(null);
    try {
      const response = await apiSend<{ lead: LeadDTO }>(`/api/leads/${leadId}`, "PATCH", body);
      setLead((current) => (current ? { ...current, ...response.lead } : current));
      setNotice(successMessage);
      return true;
    } catch (err) {
      setActionError(errorMessage(err));
      return false;
    }
  };

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setActionError("No se ha podido copiar al portapapeles.");
    }
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    const ok = await patch({ notes }, "Notas guardadas.");
    setSavingNotes(false);
    if (!ok) setNotice(null);
  };

  const addToCampaign = async () => {
    if (!selectedCampaignId) {
      setActionError("Selecciona una campaña.");
      return;
    }
    setAddingToCampaign(true);
    setActionError(null);
    try {
      const response = await apiSend<{ added: number; total: number }>(
        `/api/campaigns/${selectedCampaignId}/recipients`,
        "POST",
        { leadIds: [leadId] },
      );
      setCampaignModalOpen(false);
      setNotice(`Lead añadido a la campaña (${response.added} destinatario nuevo).`);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setAddingToCampaign(false);
    }
  };

  if (loading) {
    return <LoadingBlock label="Cargando ficha del lead…" />;
  }

  if (error || !lead) {
    return <ErrorBox message={error ?? "No se ha encontrado el lead."} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <Icon name="chevronLeft" className="h-3.5 w-3.5" />
        Volver a leads
      </Link>

      <PageHeader
        title={displayName(lead)}
        description={
          [
            lead.jobTitle,
            lead.companyName,
            [lead.city, lead.region].filter(Boolean).join(", "),
          ]
            .filter(Boolean)
            .join(" · ") || "Lead sin datos descriptivos"
        }
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setSelectedCampaignId("");
                setCampaignModalOpen(true);
              }}
            >
              <Icon name="send" className="h-4 w-4" />
              Añadir a campaña
            </Button>
            {lead.email ? (
              <Button onClick={() => void copy(lead.email ?? "", "lead-email")}>
                <Icon name="copy" className="h-4 w-4" />
                {copied === "lead-email" ? "Copiado" : "Copiar email"}
              </Button>
            ) : null}
            <Button
              onClick={() => void patch({ status: "contacted" }, "Lead marcado como contactado.")}
            >
              <Icon name="check" className="h-4 w-4" />
              Marcar como contactado
            </Button>
          </>
        }
      />

      {actionError ? <ErrorBox message={actionError} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <SectionTitle
              actions={
                <Select
                  value={lead.status}
                  onChange={(value) =>
                    void patch(
                      { status: value as LeadStatus },
                      `Estado actualizado a ${leadStatusLabel(value)}.`,
                    )
                  }
                  options={LEAD_STATUS_OPTIONS}
                  className="min-w-[10rem] py-1 text-xs"
                />
              }
            >
              Datos de contacto
            </SectionTitle>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">Email</dt>
                <dd className="mt-0.5 flex items-center gap-2 text-sm text-slate-800">
                  {lead.email ? (
                    <>
                      <span className="break-all">{lead.email}</span>
                      <button
                        type="button"
                        onClick={() => void copy(lead.email ?? "", "email")}
                        className="text-slate-400 hover:text-slate-700"
                        title="Copiar email"
                      >
                        <Icon name="copy" className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-slate-400">No disponible</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">Teléfono</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{lead.phoneNumber || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">Cargo</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{lead.jobTitle || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">LinkedIn</dt>
                <dd className="mt-0.5 text-sm text-slate-800">
                  {lead.linkedinUrl ? (
                    <a
                      href={lead.linkedinUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                    >
                      Ver perfil
                      <Icon name="external" className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">Ubicación</dt>
                <dd className="mt-0.5 text-sm text-slate-800">
                  {[lead.city, lead.region, lead.country].filter(Boolean).join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">Fuente</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{lead.source}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">Creado</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{formatDate(lead.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-slate-500 uppercase">
                  Último contacto
                </dt>
                <dd className="mt-0.5 text-sm text-slate-800">
                  {lead.lastContactedAt ? formatDate(lead.lastContactedAt) : "Nunca"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <SectionTitle>Empresa</SectionTitle>
            {lead.companyName ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-slate-900">{lead.companyName}</p>
                {lead.companyWebsite ? (
                  <a
                    href={lead.companyWebsite}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                  >
                    {lead.companyDomain ?? lead.companyWebsite}
                    <Icon name="external" className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <div>
                  <Link
                    href={`/companies?q=${encodeURIComponent(lead.companyName)}`}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Ver en Empresas
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Este lead no está vinculado a una empresa.</p>
            )}
          </Card>

          <Card>
            <SectionTitle hint="Direcciones encontradas en la web pública del negocio">
              Emails encontrados
            </SectionTitle>
            {lead.emails.length === 0 ? (
              <p className="text-sm text-slate-500">
                No se han encontrado emails alternativos para este lead.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lead.emails.map((email) => (
                  <li key={email.email} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 break-all text-sm text-slate-800">
                      {email.email}
                    </span>
                    <Badge
                      tone={
                        email.status === "verified"
                          ? "green"
                          : email.status === "invalid"
                            ? "red"
                            : email.status === "risky"
                              ? "amber"
                              : "slate"
                      }
                    >
                      {emailStatusLabel(email.status)}
                    </Badge>
                    <span className="text-xs text-slate-400">
                      {email.source} · {email.confidence}%
                    </span>
                    <button
                      type="button"
                      onClick={() => void copy(email.email, email.email)}
                      className="text-slate-400 hover:text-slate-700"
                      title="Copiar email"
                    >
                      <Icon name="copy" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {lead.aiSummary ? (
            <Card>
              <SectionTitle hint="Resumen generado por el agente">Resumen IA</SectionTitle>
              <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">
                {lead.aiSummary}
              </p>
            </Card>
          ) : null}

          <Card>
            <SectionTitle
              actions={
                <Button variant="primary" onClick={() => void saveNotes()} disabled={savingNotes}>
                  {savingNotes ? "Guardando…" : "Guardar notas"}
                </Button>
              }
            >
              Notas
            </SectionTitle>
            <Textarea
              value={notes}
              onChange={setNotes}
              rows={5}
              placeholder="Contexto de la llamada, objections, siguiente paso…"
            />
          </Card>

          <Card>
            <SectionTitle>Conversaciones</SectionTitle>
            {lead.conversations.length === 0 ? (
              <p className="text-sm text-slate-500">
                Este lead todavía no tiene conversaciones registradas.
              </p>
            ) : (
              <ul className="space-y-3">
                {lead.conversations.map((conversation) => (
                  <li key={conversation.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={conversation.direction === "inbound" ? "green" : "slate"}>
                        {conversation.direction === "inbound" ? "Recibido" : "Enviado"}
                      </Badge>
                      <Badge tone="slate">{channelLabel(conversation.channel)}</Badge>
                      <span className="text-xs text-slate-400">
                        {formatDateTime(conversation.createdAt)}
                      </span>
                      {conversation.status ? (
                        <span className="text-xs text-slate-400">
                          {recipientStatusLabel(conversation.status)}
                        </span>
                      ) : null}
                    </div>
                    {conversation.subject ? (
                      <p className="mt-2 text-sm font-medium text-slate-900">{conversation.subject}</p>
                    ) : null}
                    <p className="mt-1 text-sm whitespace-pre-line text-slate-600">
                      {conversation.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Fit con tu ICP</SectionTitle>
            <div className="flex items-center gap-3">
              <ScoreBadge score={lead.score} className="px-2 py-1 text-base" />
              <span className="text-sm text-slate-600">
                {lead.score >= 70
                  ? "Encaje alto"
                  : lead.score >= 40
                    ? "Encaje medio"
                    : "Encaje bajo"}
              </span>
            </div>
            {lead.scoreReason ? (
              <p className="mt-3 text-sm leading-relaxed text-slate-700">{lead.scoreReason}</p>
            ) : null}
            {lead.fitNotes ? (
              <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                {lead.fitNotes}
              </p>
            ) : null}
          </Card>

          <ProfileCard lead={lead} />

          <Card>
            <SectionTitle>Listas</SectionTitle>
            {lead.lists.length === 0 ? (
              <p className="text-sm text-slate-500">No está en ninguna lista.</p>
            ) : (
              <ul className="space-y-2">
                {lead.lists.map((list) => (
                  <li key={list.id}>
                    <Link
                      href={`/lists/${list.id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {list.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle>Campañas</SectionTitle>
            {lead.campaigns.length === 0 ? (
              <p className="text-sm text-slate-500">No está en ninguna campaña.</p>
            ) : (
              <ul className="space-y-2">
                {lead.campaigns.map((campaign) => (
                  <li key={campaign.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {campaign.name}
                    </Link>
                    <Badge tone="slate">{recipientStatusLabel(campaign.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={campaignModalOpen}
        title="Añadir a una campaña"
        description="El lead se incorporará como destinatario de la secuencia."
        onClose={() => setCampaignModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCampaignModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void addToCampaign()} disabled={addingToCampaign}>
              {addingToCampaign ? "Añadiendo…" : "Añadir a la campaña"}
            </Button>
          </>
        }
      >
        {campaigns.length === 0 ? (
          <NoticeBox message="Todavía no tienes campañas. Crea una primero desde la sección Campañas." />
        ) : (
          <Field label="Campaña">
            <Select
              value={selectedCampaignId}
              onChange={setSelectedCampaignId}
              options={[
                { value: "", label: "Selecciona una campaña" },
                ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
              ]}
            />
          </Field>
        )}
      </Modal>
    </div>
  );
}

/**
 * Perfil del prospecto: traduce las señales detectadas en su web a un
 * veredicto comercial para el nicho de AgendaOS (profesional autónomo o
 * pequeño negocio sin CRM).
 */
function ProfileCard({ lead }: { lead: LeadDTO }) {
  const enrichment = lead.enrichment ?? {};
  const signals: string[] = Array.isArray(enrichment.signals)
    ? (enrichment.signals as string[])
    : [];

  const isChain = signals.some((s) => /cadena|policl|multiproyecto|franquicia/i.test(s));
  const hasCrm = signals.some((s) => /crm|software de gesti[óo]n|portal del paciente/i.test(s));
  const manualAgenda = signals.some((s) => /a mano|por tel[eé]fono|whatsapp|papel/i.test(s));
  const soloPractice = signals.some((s) => /consulta privada|solo profesional/i.test(s));
  const homeVisits = signals.some((s) => /domicilio/i.test(s));

  const verdict = isChain
    ? { label: "Cadena o policlínica", tone: "red" as const, note: "Probablemente no es el decisor." }
    : hasCrm
      ? {
          label: "Ya tiene CRM",
          tone: "amber" as const,
          note: "Está digitalizado: el pitch sería sustituir su CRM, no su agenda.",
        }
      : soloPractice || homeVisits
        ? {
            label: "Profesional independiente",
            tone: "green" as const,
            note: "Encaja con el ICP: profesional que trabaja por su cuenta.",
          }
        : manualAgenda
          ? {
              label: "Gestiona las citas a mano",
              tone: "green" as const,
              note: "Oportunidad: aún no tiene software de agenda.",
            }
          : {
              label: "Pequeño negocio de salud",
              tone: "slate" as const,
              note: "Revisa si es un autónomo con consulta propia.",
            };

  return (
    <Card>
      <SectionTitle>Perfil del prospecto</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        {manualAgenda ? <Badge tone="amber">Agenda manual</Badge> : null}
        {soloPractice ? <Badge tone="green">Consulta privada</Badge> : null}
        {homeVisits ? <Badge tone="green">Trabaja a domicilio</Badge> : null}
        {hasCrm ? <Badge tone="red">Con CRM</Badge> : null}
      </div>
      <p className="mt-3 text-sm text-slate-600">{verdict.note}</p>

      {signals.length > 0 ? (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">
            Señales detectadas en su web
          </p>
          <ul className="mt-2 space-y-1.5">
            {signals.map((signal) => (
              <li key={signal} className="flex gap-2 text-sm text-slate-600">
                <Icon name="target" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Sin señales: aún no se ha analizado la web de este negocio.
        </p>
      )}
    </Card>
  );
}
