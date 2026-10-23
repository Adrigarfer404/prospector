"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { channelLabel, formatRelative } from "@/components/format";
import type { TaskDTO } from "@/components/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  LoadingBlock,
  NoticeBox,
  PageHeader,
  Select,
} from "@/components/ui";

const CHANNEL_OPTIONS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "call", label: "Llamadas" },
  { value: "linkedin,call", label: "Todas" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Pendientes" },
  { value: "closed", label: "Completadas" },
  { value: "all", label: "Todas" },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [channel, setChannel] = useState("linkedin,call");
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ channel, status });
      const response = await apiGet<{ tasks: TaskDTO[] }>(`/api/tasks?${params.toString()}`);
      setTasks(response.tasks ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [channel, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (task: TaskDTO) => {
    setBusyId(task.id);
    setError(null);
    setNotice(null);
    try {
      await apiSend(`/api/inbox/${task.id}`, "PATCH", { status: "closed" });
      setNotice(
        task.channel === "call"
          ? "Llamada marcada como hecha."
          : "Acción de LinkedIn marcada como hecha.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tareas"
        description="Acciones que la app no puede hacer por ti: conectar en LinkedIn o llamar. Hazlas aquí para no olvidarlas."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Field label="Canal">
              <Select value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
            </Field>
          </div>
          <div className="w-52">
            <Field label="Estado">
              <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            </Field>
          </div>
          <p className="ml-auto pb-2 text-sm text-slate-500">
            {loading ? "Cargando…" : `${tasks.length} ${tasks.length === 1 ? "tarea" : "tareas"}`}
          </p>
        </div>
      </Card>

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label="Cargando tareas…" />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No hay tareas pendientes"
          description="Cuando una campaña include pasos de LinkedIn o llamadas, aparecerán aquí como acciones manuales."
        />
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={task.id}>
              <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    task.channel === "call" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600"
                  }`}
                >
                  <Icon name={task.channel === "call" ? "phone" : "user"} className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {task.lead?.fullName ?? task.subject ?? "Acción sin lead"}
                    </span>
                    <Badge tone="slate">{channelLabel(task.channel)}</Badge>
                    {task.status !== "open" ? (
                      <Badge tone="green">Completada</Badge>
                    ) : null}
                    <span className="text-xs text-slate-400">{formatRelative(task.createdAt)}</span>
                  </div>

                  {task.lead?.company?.name ? (
                    <p className="mt-1 text-sm text-slate-600">{task.lead.company.name}</p>
                  ) : null}

                  {task.body ? (
                    <p className="mt-2 text-sm whitespace-pre-line text-slate-600">{task.body}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    {task.lead?.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="mail" className="h-3.5 w-3.5 text-slate-400" />
                        {task.lead.email}
                      </span>
                    ) : null}
                    {task.lead?.phoneNumber ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="phone" className="h-3.5 w-3.5 text-slate-400" />
                        {task.lead.phoneNumber}
                      </span>
                    ) : null}
                    {task.lead?.linkedinUrl ? (
                      <a
                        href={task.lead.linkedinUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800"
                      >
                        <Icon name="link" className="h-3.5 w-3.5" />
                        Abrir LinkedIn
                      </a>
                    ) : null}
                    {task.lead?.id ? (
                      <Link
                        href={`/leads/${task.lead.id}`}
                        className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900"
                      >
                        Ver ficha
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="sm:pl-4">
                  {task.status === "open" ? (
                    <Button
                      variant="primary"
                      onClick={() => void complete(task)}
                      disabled={busyId === task.id}
                    >
                      <Icon name="check" className="h-4 w-4" />
                      Marcar como hecha
                    </Button>
                  ) : (
                    <Badge tone="green">Hecha</Badge>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <NoticeBox message="Las tareas salen de los pasos de LinkedIn y de llamada de tus campañas. Hazlas a mano y márcalas para que la app lleve la cuenta." />
    </div>
  );
}
