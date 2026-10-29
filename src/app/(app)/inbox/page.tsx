"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { channelLabel, formatDateTime, formatRelative } from "@/components/format";
import type { ConversationDTO, LeadDTO } from "@/components/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

const CHANNEL_OPTIONS = [
  { value: "", label: "Todos los canales" },
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "call", label: "Llamada" },
  { value: "note", label: "Nota" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Abierto" },
  { value: "replied", label: "Respondido" },
  { value: "closed", label: "Cerrado" },
  { value: "booked", label: "Agendado" },
];

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [channel, setChannel] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [replyLeadId, setReplyLeadId] = useState("");
  const [replyChannel, setReplyChannel] = useState("email");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (channel) params.set("channel", channel);
      if (onlyUnread) params.set("unread", "true");
      const response = await apiGet<{
        conversations: ConversationDTO[];
        unreadCount: number;
      }>(`/api/inbox${params.toString() ? `?${params.toString()}` : ""}`);
      setConversations(response.conversations ?? []);
      setUnreadCount(response.unreadCount ?? 0);
      setSelectedId((current) => {
        if (current && response.conversations.some((item) => item.id === current)) return current;
        return response.conversations?.[0]?.id ?? null;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [channel, onlyUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!composeOpen) return;
    apiGet<{ leads: LeadDTO[] }>("/api/leads?take=200&sort=score")
      .then((response) => setLeads(response.leads ?? []))
      .catch(() => setLeads([]));
  }, [composeOpen]);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const updateConversation = async (
    id: string,
    body: Record<string, unknown>,
    message: string,
  ) => {
    setActionError(null);
    try {
      await apiSend(`/api/inbox/${id}`, "PATCH", body);
      setNotice(message);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const resolveDelivery = async (outcome: "sent" | "not_sent") => {
    if (!selected) return;
    setSending(true); setActionError(null);
    try {
      await apiSend(`/api/inbox/${selected.id}/recover`, "POST", { outcome });
      setReviewOpen(false); setNotice(outcome === "sent" ? "Envío confirmado." : "Envío marcado como no realizado.");
      await load();
    } catch (err) { setActionError(errorMessage(err)); } finally { setSending(false); }
  };

  const registerReply = async () => {
    if (!replyLeadId) {
      setActionError("Selecciona el lead al que pertenece la respuesta.");
      return;
    }
    if (!replyBody.trim()) {
      setActionError("Escribe el contenido de la respuesta.");
      return;
    }
    setSending(true);
    setActionError(null);
    try {
      await apiSend("/api/inbox", "POST", {
        leadId: replyLeadId,
        body: replyBody.trim(),
        subject: replySubject.trim() || undefined,
        channel: replyChannel,
      });
      setComposeOpen(false);
      setReplyBody("");
      setReplySubject("");
      setReplyLeadId("");
      setNotice("Respuesta registrada. El lead pasa a estado 'Respondió'.");
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Todas las conversaciones con tus prospectos, entrantes y salientes."
        actions={
          <Button variant="primary" onClick={() => setComposeOpen(true)}>
            <Icon name="plus" className="h-4 w-4" />
            Registrar respuesta
          </Button>
        }
      />

      {actionError ? <ErrorBox message={actionError} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Canal">
              <Select value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={(event) => setOnlyUnread(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            Solo sin leer
          </label>
          <div className="ml-auto flex items-center gap-2 pb-2 text-sm text-slate-500">
            <Badge tone={unreadCount > 0 ? "indigo" : "slate"}>
              {unreadCount} sin leer
            </Badge>
          </div>
        </div>
      </Card>

      {loading ? (
        <LoadingBlock label="Cargando conversaciones…" />
      ) : conversations.length === 0 ? (
        <EmptyState
          title="No hay conversaciones todavía"
          description="Cuando lances una campaña o registres una respuesta, aparecerán aquí."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card padded={false} className="lg:col-span-2">
            <ul className="scroll-thin max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
              {conversations.map((conversation) => {
                const active = conversation.id === selectedId;
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(conversation.id);
                        if (!conversation.read) {
                          void updateConversation(
                            conversation.id,
                            { read: true },
                            "Conversación marcada como leída.",
                          );
                        }
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        active ? "bg-indigo-50/70" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {!conversation.read ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                        ) : (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-transparent" />
                        )}
                        <span className="truncate text-sm font-medium text-slate-900">
                          {conversation.leadName ?? "Sin lead"}
                        </span>
                        <Badge
                          tone={conversation.direction === "inbound" ? "green" : "slate"}
                          className="ml-auto"
                        >
                          {conversation.direction === "inbound" ? "Recibido" : conversation.status === "sending" ? "Resultado pendiente" : conversation.status === "closed" ? "Enviado" : conversation.status === "failed" ? "Fallido" : "Pendiente"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate pl-4 text-xs text-slate-600">
                        {conversation.subject ?? "(sin asunto)"}
                      </p>
                      <p className="mt-0.5 pl-4 text-[11px] text-slate-400">
                        {conversation.leadCompany ? `${conversation.leadCompany} · ` : ""}
                        {formatRelative(conversation.createdAt)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="lg:col-span-3">
            {selected ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {selected.subject ?? "(sin asunto)"}
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {selected.leadName ?? "Sin lead"}
                      {selected.leadCompany ? ` · ${selected.leadCompany}` : ""} ·{" "}
                      {formatDateTime(selected.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={selected.direction === "inbound" ? "green" : "slate"}>
                      {selected.direction === "inbound" ? "Recibido" : selected.status === "sending" ? "Resultado pendiente" : selected.status === "closed" ? "Enviado" : selected.status === "failed" ? "Fallido" : "Pendiente"}
                    </Badge>
                    <Badge tone="slate">{channelLabel(selected.channel)}</Badge>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">
                    {selected.body}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selected.status === "sending" ? (
                    selected.campaignId ? <p className="text-sm text-amber-700">Revisa este envío desde su campaña.</p> : <Button variant="secondary" onClick={() => setReviewOpen(true)}>Revisar envío</Button>
                  ) : <Select
                    value={selected.status}
                    onChange={(value) =>
                      updateConversation(
                        selected.id,
                        { status: value },
                        `Estado actualizado a ${value}.`,
                      )
                    }
                    options={STATUS_OPTIONS}
                    className="w-40 py-1.5 text-xs"
                  />}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      updateConversation(
                        selected.id,
                        { read: !selected.read },
                        selected.read ? "Marcada como no leída." : "Marcada como leída.",
                      )
                    }
                  >
                    {selected.read ? "Marcar como no leída" : "Marcar como leída"}
                  </Button>
                  {selected.leadId ? (
                    <Link
                      href={`/leads/${selected.leadId}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Ver ficha del lead
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                Selecciona una conversación para leerla.
              </p>
            )}
          </Card>
        </div>
      )}

      <Modal open={reviewOpen} title="Revisar envío interrumpido" onClose={() => setReviewOpen(false)}
        description="Comprueba en tu correo o proveedor SMTP si el mensaje se envió y asegúrate de que la ejecución se ha detenido. Podrás resolverlo cuando hayan pasado 15 minutos."
        footer={<><Button variant="ghost" onClick={() => setReviewOpen(false)}>Cancelar</Button><Button variant="secondary" disabled={sending} onClick={() => resolveDelivery("not_sent")}>No se envió</Button><Button variant="primary" disabled={sending} onClick={() => resolveDelivery("sent")}>Sí se envió</Button></>}
      ><p className="text-sm">Identificador del mensaje: {selected?.externalId || "No disponible"}</p></Modal>
      <Modal
        open={composeOpen}
        title="Registrar respuesta"
        description="Pega aquí una respuesta que has recibido por cualquier canal."
        onClose={() => setComposeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposeOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={registerReply} disabled={sending}>
              {sending ? "Registrando…" : "Registrar respuesta"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Lead">
            <Select
              value={replyLeadId}
              onChange={setReplyLeadId}
              options={[
                { value: "", label: "Selecciona un lead" },
                ...leads.map((lead) => ({
                  value: lead.id,
                  label: `${lead.fullName ?? lead.companyName ?? "Sin nombre"}${
                    lead.companyName ? ` (${lead.companyName})` : ""
                  }`,
                })),
              ]}
            />
          </Field>
          <Field label="Canal">
            <Select
              value={replyChannel}
              onChange={setReplyChannel}
              options={[
                { value: "email", label: "Email" },
                { value: "linkedin", label: "LinkedIn" },
                { value: "call", label: "Llamada" },
                { value: "note", label: "Nota" },
              ]}
            />
          </Field>
          <Field label="Asunto" hint="Opcional.">
            <Input
              value={replySubject}
              onChange={setReplySubject}
              placeholder="Re: tu mensaje"
            />
          </Field>
          <Field label="Respuesta">
            <Textarea
              value={replyBody}
              onChange={setReplyBody}
              rows={6}
              placeholder="Pega aquí el texto que te han enviado"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
