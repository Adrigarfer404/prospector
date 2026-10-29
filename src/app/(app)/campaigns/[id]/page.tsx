"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import {
  LEAD_STATUS_OPTIONS,
  STEP_TYPE_OPTIONS,
  campaignChannelLabel,
  campaignStatusLabel,
  formatDateTime,
  recipientStatusLabel,
  stepTypeLabel,
} from "@/components/format";
import type {
  CampaignDetailDTO,
  CampaignStepDTO,
  LeadStatus,
  ListDTO,
  PreviewMessage,
  RunSummary,
  RecipientDTO,
  StepType,
} from "@/components/types";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  Modal,
  NoticeBox,
  PageHeader,
  SectionTitle,
  Select,
  StatCard,
  Textarea,
  type Tone,
} from "@/components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;

function campaignTone(status: string): Tone {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "slate";
  return "indigo";
}

type EditableStep = {
  type: StepType;
  name: string;
  delayDays: string;
  delayHours: string;
  subject: string;
  body: string;
  aiEnabled: boolean;
  stopOnReply: boolean;
};

function toEditable(step: CampaignStepDTO): EditableStep {
  return {
    type: step.type as StepType,
    name: step.name ?? "",
    delayDays: String(step.delayDays ?? 0),
    delayHours: String(step.delayHours ?? 0),
    subject: step.subject ?? "",
    body: step.body ?? "",
    aiEnabled: Boolean(step.aiEnabled),
    stopOnReply: step.stopOnReply !== false,
  };
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [campaign, setCampaign] = useState<CampaignDetailDTO | null>(null);
  const [lists, setLists] = useState<ListDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<EditableStep | null>(null);
  const [newStepType, setNewStepType] = useState<StepType>("email");
  const [newStepName, setNewStepName] = useState("");
  const [newStepDelay, setNewStepDelay] = useState("2");
  const [newStepSubject, setNewStepSubject] = useState("");
  const [newStepBody, setNewStepBody] = useState("");

  const [addLeadsOpen, setAddLeadsOpen] = useState(false);
  const [addSource, setAddSource] = useState<"list" | "status">("list");
  const [addListId, setAddListId] = useState("");
  const [addStatus, setAddStatus] = useState<LeadStatus>("new");
  const [addMinScore, setAddMinScore] = useState("");
  const [addingLeads, setAddingLeads] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStepId, setPreviewStepId] = useState("");
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [forceRun, setForceRun] = useState(false);
  const [recovery, setRecovery] = useState<RecipientDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [campaignResponse, listResponse] = await Promise.all([
        apiGet<{ campaign: CampaignDetailDTO }>(`/api/campaigns/${campaignId}`),
        apiGet<{ lists: ListDTO[] }>("/api/lists"),
      ]);
      setCampaign(campaignResponse.campaign);
      setLists(listResponse.lists ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const steps = useMemo(() => campaign?.steps ?? [], [campaign]);

  const stepTiming = useMemo(() => {
    if (!campaign) return new Map<string, { due: boolean; offsetDays: number }>();
    const elapsed = (Date.now() - new Date(campaign.createdAt).getTime()) / DAY_MS;
    const map = new Map<string, { due: boolean; offsetDays: number }>();
    let cumulative = 0;
    for (const step of steps) {
      cumulative += (step.delayDays ?? 0) + (step.delayHours ?? 0) / 24;
      map.set(step.id, { due: elapsed >= cumulative, offsetDays: cumulative });
    }
    return map;
  }, [campaign, steps]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const patchCampaign = (body: Record<string, unknown>, successMessage: string) =>
    runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}`, "PATCH", body);
      setNotice(successMessage);
      await load();
    });

  const launch = () =>
    runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}`, "POST", { action: "launch" });
      setNotice("Campaña activada. Ya puedes ejecutar la secuencia.");
      await load();
    });

  const runCampaignNow = () =>
    runAction(async () => {
      const response = await apiSend<RunSummary>(`/api/campaigns/${campaignId}`, "POST", {
        limit: 25,
        ...(forceRun ? { force: true } : {}),
      });
      setSummary(response);
      await load();
    });

  const resolveRecovery = (outcome: "sent" | "not_sent") => {
    if (!recovery) return;
    void runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}/recipients/${recovery.id}/recover`, "POST", { outcome });
      setRecovery(null);
      setNotice(outcome === "sent" ? "Envío confirmado; la secuencia puede continuar." : "Envío marcado como no realizado; queda pendiente para el próximo intento.");
      await load();
    });
  };

  const saveStep = async () => {
    if (!editingStepId || !stepDraft) return;
    await runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}/steps/${editingStepId}`, "PATCH", {
        type: stepDraft.type,
        name: stepDraft.name.trim() || null,
        delayDays: Number(stepDraft.delayDays) || 0,
        delayHours: Number(stepDraft.delayHours) || 0,
        subject: stepDraft.subject.trim() || null,
        body: stepDraft.body.trim() || null,
        aiEnabled: stepDraft.aiEnabled,
        stopOnReply: stepDraft.stopOnReply,
      });
      setEditingStepId(null);
      setStepDraft(null);
      setNotice("Paso guardado.");
      await load();
    });
  };

  const addStep = async () => {
    await runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}/steps`, "POST", {
        type: newStepType,
        name: newStepName.trim() || undefined,
        delayDays: Number(newStepDelay) || 0,
        delayHours: 0,
        subject: newStepSubject.trim() || undefined,
        body: newStepBody.trim() || undefined,
        aiEnabled: true,
        stopOnReply: true,
      });
      setNewStepName("");
      setNewStepSubject("");
      setNewStepBody("");
      setNotice("Paso añadido a la secuencia.");
      await load();
    });
  };

  const deleteStep = async (step: CampaignStepDTO) => {
    await runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}/steps/${step.id}`, "DELETE");
      setNotice(`Paso "${step.name || stepTypeLabel(step.type)}" eliminado.`);
      await load();
    });
  };

  const moveStep = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const current = steps[index];
    const other = steps[target];
    if (!current || !other) return;
    await runAction(async () => {
      await apiSend(`/api/campaigns/${campaignId}/steps/${current.id}`, "PATCH", {
        order: other.order,
      });
      await apiSend(`/api/campaigns/${campaignId}/steps/${other.id}`, "PATCH", {
        order: current.order,
      });
      await load();
    });
  };

  const addRecipients = async () => {
    setAddingLeads(true);
    setActionError(null);
    try {
      const body =
        addSource === "list"
          ? {
              listId: addListId,
              ...(addMinScore ? { minScore: Number(addMinScore) } : {}),
            }
          : {
              status: addStatus,
              ...(addMinScore ? { minScore: Number(addMinScore) } : {}),
            };
      const response = await apiSend<{ added: number; total: number }>(
        `/api/campaigns/${campaignId}/recipients`,
        "POST",
        body,
      );
      setAddLeadsOpen(false);
      setNotice(`${response.added} destinatarios añadidos (${response.total} seleccionados).`);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setAddingLeads(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setActionError(null);
    try {
      const leadIds = (campaign?.recipients ?? []).slice(0, 5).map((recipient) => recipient.leadId);
      if (leadIds.length === 0) {
        setActionError("Añade destinatarios antes de previsualizar los mensajes.");
        return;
      }
      const response = await apiSend<{ messages: PreviewMessage[] }>(
        `/api/campaigns/${campaignId}/preview`,
        "POST",
        {
          leadIds,
          ...(previewStepId ? { stepId: previewStepId } : {}),
        },
      );
      setPreviewMessages(response.messages ?? []);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  if (loading) {
    return <LoadingBlock label="Cargando campaña…" />;
  }

  if (error || !campaign) {
    return (
      <ErrorBox
        message={error ?? "No se ha encontrado la campaña."}
        onRetry={() => void load()}
      />
    );
  }

  const recipients = campaign.recipients ?? [];
  const sentCount = recipients.filter((recipient) => recipient.status === "sent").length;
  const repliedCount = recipients.filter((recipient) => recipient.status === "replied").length;
  const pendingCount = recipients.filter(
    (recipient) => recipient.status === "pending" || recipient.status === "sending" || recipient.status === "manual",
  ).length;

  return (
    <div className="space-y-6">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <Icon name="chevronLeft" className="h-3.5 w-3.5" />
        Volver a campañas
      </Link>

      <PageHeader
        title={campaign.name}
        description={campaign.objective ?? campaign.description ?? undefined}
        actions={
          <>
            {campaign.status !== "active" ? (
              <Button variant="primary" onClick={launch} disabled={busy}>
                <Icon name="play" className="h-4 w-4" />
                Activar campaña
              </Button>
            ) : (
              <Button onClick={() => patchCampaign({ status: "paused" }, "Campaña pausada.")} disabled={busy}>
                Pausar
              </Button>
            )}
            {campaign.status === "paused" ? (
              <Button onClick={launch} disabled={busy}>
                Reanudar
              </Button>
            ) : null}
            <Button onClick={() => setAddLeadsOpen(true)}>
              <Icon name="plus" className="h-4 w-4" />
              Añadir leads
            </Button>
            <Button
              onClick={() => {
                setPreviewMessages(null);
                setPreviewOpen(true);
              }}
            >
              <Icon name="eye" className="h-4 w-4" />
              Previsualizar
            </Button>
            <Button variant="primary" onClick={runCampaignNow} disabled={busy}>
              <Icon name="refresh" className="h-4 w-4" />
              Ejecutar ahora
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

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={campaignTone(campaign.status)} dot>
            {campaignStatusLabel(campaign.status)}
          </Badge>
          <Badge tone="slate">{campaignChannelLabel(campaign.channel)}</Badge>
          <Badge tone="slate">Límite {campaign.dailyLimit}/día</Badge>
          {campaign.autoSend ? <Badge tone="green">Envío automático</Badge> : <Badge tone="amber">Revisión manual</Badge>}
          <span className="ml-auto text-xs text-slate-400">
            Creada el {formatDateTime(campaign.createdAt)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <StatCard label="Destinatarios" value={recipients.length} />
          <StatCard label="Enviados" value={sentCount} />
          <StatCard label="Respuestas" value={repliedCount} />
          <StatCard label="Pendientes" value={pendingCount} />
        </div>
      </Card>

      {summary ? (
        <Card>
          <SectionTitle
            hint="Resultado de la última ejecución"
            actions={
              <Button variant="ghost" onClick={() => setSummary(null)}>
                Descartar
              </Button>
            }
          >
            Resumen de ejecución
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-5">
            <StatCard label="Procesados" value={summary.processed} />
            <StatCard label="Enviados" value={summary.sent} />
            <StatCard label="Encolados" value={summary.queued} />
            <StatCard label="Omitidos" value={summary.skipped} />
            <StatCard label="Fallidos" value={summary.failed} />
          </div>

          {summary.errors.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Avisos</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
                {summary.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.messages.length > 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Mensajes generados</p>
              {summary.messages.map((message, index) => (
                <div key={index} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{message.leadName}</span>
                    <Badge tone="slate">{message.channel}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-700">{message.subject}</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-600">{message.body}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle
          hint="En verde los pasos que ya han vencido; en gris los que esperan su turno."
          actions={
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={forceRun}
                onChange={(event) => setForceRun(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
              />
              Forzar ejecución aunque la campaña esté en borrador
            </label>
          }
        >
          Secuencia
        </SectionTitle>

        {steps.length === 0 ? (
          <p className="text-sm text-slate-500">
            Esta campaña no tiene pasos. Añade el primero para que pueda enviar mensajes.
          </p>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, index) => {
              const timing = stepTiming.get(step.id);
              const due = timing?.due ?? false;
              const isEditing = editingStepId === step.id;
              return (
                <li
                  key={step.id}
                  className={`rounded-xl border p-4 ${
                    due ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-slate-50/50"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-600 border border-slate-200">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {step.name || stepTypeLabel(step.type)}
                          </span>
                          <Badge tone="slate">{stepTypeLabel(step.type)}</Badge>
                          {due ? <Badge tone="green">Vencido</Badge> : <Badge tone="slate">Programado</Badge>}
                          {step.aiEnabled ? <Badge tone="violet">IA</Badge> : null}
                          {step.stopOnReply ? <Badge tone="slate">Para al responder</Badge> : null}
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <Icon name="clock" className="h-3.5 w-3.5" />
                          Espera {step.delayDays ?? 0} días y {step.delayHours ?? 0} horas
                          {timing ? ` · se activa en el día ${Math.round(timing.offsetDays)}` : ""}
                        </p>
                        {step.subject ? (
                          <p className="mt-2 text-sm font-medium text-slate-800">{step.subject}</p>
                        ) : null}
                        {step.body ? (
                          <p className="mt-1 line-clamp-3 text-xs whitespace-pre-line text-slate-500">
                            {step.body}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        className="h-8 w-8 px-0"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0 || busy}
                        title="Subir paso"
                      >
                        <Icon name="up" className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 px-0"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === steps.length - 1 || busy}
                        title="Bajar paso"
                      >
                        <Icon name="down" className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 px-0"
                        onClick={() => {
                          setEditingStepId(isEditing ? null : step.id);
                          setStepDraft(isEditing ? null : toEditable(step));
                        }}
                        title="Editar paso"
                      >
                        <Icon name="pencil" className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 px-0 text-red-600"
                        onClick={() => void deleteStep(step)}
                        disabled={busy}
                        title="Eliminar paso"
                      >
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isEditing && stepDraft ? (
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Tipo">
                          <Select
                            value={stepDraft.type}
                            onChange={(value) =>
                              setStepDraft({ ...stepDraft, type: value })
                            }
                            options={STEP_TYPE_OPTIONS}
                          />
                        </Field>
                        <Field label="Nombre">
                          <Input
                            value={stepDraft.name}
                            onChange={(value) => setStepDraft({ ...stepDraft, name: value })}
                            placeholder="Primer contacto"
                          />
                        </Field>
                        <Field label="Espera (días)">
                          <Input
                            value={stepDraft.delayDays}
                            onChange={(value) => setStepDraft({ ...stepDraft, delayDays: value })}
                            type="number"
                            min={0}
                            max={90}
                          />
                        </Field>
                        <Field label="Espera (horas)">
                          <Input
                            value={stepDraft.delayHours}
                            onChange={(value) => setStepDraft({ ...stepDraft, delayHours: value })}
                            type="number"
                            min={0}
                            max={23}
                          />
                        </Field>
                      </div>
                      <Field label="Asunto">
                        <Input
                          value={stepDraft.subject}
                          onChange={(value) => setStepDraft({ ...stepDraft, subject: value })}
                        />
                      </Field>
                      <Field label="Cuerpo">
                        <Textarea
                          value={stepDraft.body}
                          onChange={(value) => setStepDraft({ ...stepDraft, body: value })}
                          rows={4}
                        />
                      </Field>
                      <div className="flex flex-wrap items-center gap-5">
                        <Checkbox
                          checked={stepDraft.aiEnabled}
                          onChange={(checked) => setStepDraft({ ...stepDraft, aiEnabled: checked })}
                          label="Personalizar con IA"
                        />
                        <Checkbox
                          checked={stepDraft.stopOnReply}
                          onChange={(checked) =>
                            setStepDraft({ ...stepDraft, stopOnReply: checked })
                          }
                          label="Detener la secuencia si responde"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditingStepId(null);
                            setStepDraft(null);
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button variant="primary" onClick={saveStep} disabled={busy}>
                          Guardar paso
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="mb-3 text-sm font-semibold text-slate-800">Añadir un paso</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Tipo">
              <Select
                value={newStepType}
                onChange={setNewStepType}
                options={STEP_TYPE_OPTIONS}
              />
            </Field>
            <Field label="Nombre">
              <Input
                value={newStepName}
                onChange={setNewStepName}
                placeholder="Seguimiento"
              />
            </Field>
            <Field label="Espera (días)">
              <Input
                value={newStepDelay}
                onChange={setNewStepDelay}
                type="number"
                min={0}
                max={90}
              />
            </Field>
            <Field label="Asunto" hint="Solo para pasos de email.">
              <Input
                value={newStepSubject}
                onChange={setNewStepSubject}
                placeholder="¿Hablamos?"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Cuerpo" hint="Si lo dejas vacío, el agente lo redacta con el Playbook.">
              <Textarea value={newStepBody} onChange={setNewStepBody} rows={3} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={addStep} disabled={busy}>
              <Icon name="plus" className="h-4 w-4" />
              Añadir paso
            </Button>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Destinatarios</h2>
          <Button variant="secondary" onClick={() => setAddLeadsOpen(true)}>
            <Icon name="plus" className="h-4 w-4" />
            Añadir leads
          </Button>
        </div>
        {recipients.length === 0 ? (
          <div className="px-4 pb-5">
            <NoticeBox message="Esta campaña todavía no tiene destinatarios. Añade una lista o un estado de leads." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Paso actual</th>
                  <th className="px-3 py-2 font-medium">Enviados</th>
                  <th className="px-3 py-2 font-medium">Último envío</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recipients.map((recipient) => (
                  <tr key={recipient.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/leads/${recipient.leadId}`}
                        className="font-medium text-slate-900 hover:text-indigo-700"
                      >
                        {recipient.lead.fullName || recipient.lead.email || "Sin nombre"}
                      </Link>
                      {recipient.lead.company?.name ? (
                        <div className="text-xs text-slate-500">{recipient.lead.company.name}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{recipient.lead.email || "—"}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        tone={
                          recipient.status === "replied"
                            ? "green"
                            : recipient.status === "failed"
                              ? "red"
                              : recipient.status === "sent"
                                ? "blue"
                                : "slate"
                        }
                      >
                        {recipientStatusLabel(recipient.status)}
                      </Badge>
                      {recipient.error ? (
                        <div className="mt-1 text-xs text-red-600">{recipient.error}</div>
                      ) : null}
                      {recipient.status === "sending" && Date.now() - new Date(recipient.updatedAt).getTime() >= 15 * 60 * 1000 ? (
                        <div className="mt-1">
                          <Button variant="secondary" onClick={() => setRecovery(recipient)}>Revisar envío</Button>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {Math.min(recipient.currentStep + 1, Math.max(steps.length, 1))} de{" "}
                      {steps.length}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{recipient.sentCount}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-slate-500">
                      {recipient.lastSentAt ? formatDateTime(recipient.lastSentAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(recovery)}
        title="Revisar envío interrumpido"
        description="Antes de continuar, asegúrate de que la ejecución se ha detenido y comprueba en tu correo o proveedor SMTP si el mensaje llegó a enviarse."
        onClose={() => setRecovery(null)}
        footer={<>
          <Button variant="ghost" onClick={() => setRecovery(null)}>Cancelar</Button>
          <Button variant="secondary" disabled={busy || campaign.status !== "paused"} onClick={() => resolveRecovery("not_sent")}>No se envió</Button>
          <Button variant="primary" disabled={busy || campaign.status !== "paused"} onClick={() => resolveRecovery("sent")}>Sí se envió</Button>
        </>}
      >
        <div className="space-y-3 text-sm text-slate-700">
          <p>Destinatario: <strong>{recovery?.lead.fullName || recovery?.lead.email}</strong></p>
          <p>Si confirmas que se envió, la secuencia avanzará y se anotará la confirmación. Si no se envió, quedará pendiente para otro intento.</p>
          {campaign.status !== "paused" ? <NoticeBox message="Pausa la campaña antes de resolver este envío." /> : null}
        </div>
      </Modal>

      <Modal
        open={addLeadsOpen}
        title="Añadir destinatarios"
        description="Elige una lista o un estado de leads para incorporarlos a la secuencia."
        onClose={() => setAddLeadsOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddLeadsOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={addRecipients} disabled={addingLeads}>
              {addingLeads ? "Añadiendo…" : "Añadir"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Origen">
            <Select
              value={addSource}
              onChange={setAddSource}
              options={[
                { value: "list", label: "Una lista" },
                { value: "status", label: "Leads por estado" },
              ]}
            />
          </Field>

          {addSource === "list" ? (
            <Field label="Lista">
              <Select
                value={addListId}
                onChange={setAddListId}
                options={[
                  { value: "", label: "Selecciona una lista" },
                  ...lists.map((list) => ({ value: list.id, label: `${list.name} (${list.count})` })),
                ]}
              />
            </Field>
          ) : (
            <Field label="Estado">
              <Select
                value={addStatus}
                onChange={setAddStatus}
                options={LEAD_STATUS_OPTIONS}
              />
            </Field>
          )}

          <Field label="Score mínimo" hint="Opcional. Filtra por score dentro de la lista.">
            <Input
              value={addMinScore}
              onChange={setAddMinScore}
              type="number"
              min={0}
              max={100}
              placeholder="70"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={previewOpen}
        title="Previsualizar mensajes"
        description="Genera los mensajes de los primeros destinatarios sin enviarlos."
        wide
        onClose={() => setPreviewOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>
              Cerrar
            </Button>
            <Button variant="primary" onClick={runPreview} disabled={previewing}>
              {previewing ? "Generando…" : "Generar vista previa"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Paso">
            <Select
              value={previewStepId}
              onChange={setPreviewStepId}
              options={[
                { value: "", label: "Primer paso de email" },
                ...steps.map((step) => ({
                  value: step.id,
                  label: `${step.order + 1}. ${step.name || stepTypeLabel(step.type)}`,
                })),
              ]}
            />
          </Field>

          {previewMessages === null ? (
            <p className="text-sm text-slate-500">
              Pulsa &quot;Generar vista previa&quot; para ver los mensajes tal y como se enviarán.
            </p>
          ) : previewMessages.length === 0 ? (
            <p className="text-sm text-slate-500">
              No se han podido generar mensajes. Revisa que los destinatarios tengan email.
            </p>
          ) : (
            <div className="space-y-3">
              {previewMessages.map((message) => (
                <div key={message.leadId} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {message.leadName ?? "Sin nombre"}
                    </span>
                    {message.companyName ? (
                      <span className="text-xs text-slate-500">{message.companyName}</span>
                    ) : null}
                    <Badge tone={message.source === "llm" ? "violet" : "slate"}>
                      {message.source === "llm" ? "Generado con IA" : "Plantilla"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800">{message.subject}</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-600">{message.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
