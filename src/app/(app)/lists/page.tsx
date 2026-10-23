"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { formatDate } from "@/components/format";
import type { ListDTO } from "@/components/types";
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  ScoreBadge,
  Textarea,
} from "@/components/ui";

export default function ListsPage() {
  const [lists, setLists] = useState<ListDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icp, setIcp] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ lists: ListDTO[] }>("/api/lists");
      setLists(response.lists ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createList = async () => {
    if (!name.trim()) {
      setCreateError("El nombre es obligatorio.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiSend("/api/lists", "POST", {
        name: name.trim(),
        description: description.trim() || undefined,
        icp: icp.trim() || undefined,
      });
      setModalOpen(false);
      setName("");
      setDescription("");
      setIcp("");
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Listas"
        description="Agrupa prospectos por campaña, segmento o mercado para trabajar sobre ellos."
        actions={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            <Icon name="plus" className="h-4 w-4" />
            Nueva lista
          </Button>
        }
      />

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingBlock label="Cargando listas…" />
      ) : lists.length === 0 ? (
        <EmptyState
          title="Todavía no tienes listas"
          description="Crea una lista a mano o usa el botón 'Guardar en lista' del AI Finder."
          action={
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              <Icon name="plus" className="h-4 w-4" />
              Crear la primera lista
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <Link
              key={list.id}
              href={`/lists/${list.id}`}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-indigo-300"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
                  {list.name}
                </h2>
                <ScoreBadge score={list.avgScore} />
              </div>
              {list.description ? (
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">{list.description}</p>
              ) : null}
              <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
                <span>{list.count} leads</span>
                <span>Score medio {list.avgScore}</span>
                <span className="ml-auto">{formatDate(list.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="Nueva lista"
        description="Agrupa prospectos para poder añadirlos a una campaña de un vistazo."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void createList()} disabled={creating}>
              {creating ? "Creando…" : "Crear lista"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre">
            <Input value={name} onChange={setName} placeholder="Ej. Clínicas en Madrid" />
          </Field>
          <Field label="Descripción" hint="Opcional">
            <Textarea
              value={description}
              onChange={setDescription}
              rows={3}
              placeholder="Para qué sirve esta lista"
            />
          </Field>
          <Field label="ICP" hint="Opcional. Descripción del cliente ideal de esta lista.">
            <Textarea value={icp} onChange={setIcp} rows={3} placeholder="Clínicas con web propia" />
          </Field>
          {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
