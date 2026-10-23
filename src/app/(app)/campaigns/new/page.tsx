"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { STEP_TYPE_OPTIONS } from "@/components/format";
import type { CampaignChannel, StepType } from "@/components/types";
import {
  Button,
  Card,
  Checkbox,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from "@/components/ui";

type DraftStep = {
  key: string;
  type: StepType;
  name: string;
  delayDays: string;
  delayHours: string;
  subject: string;
  body: string;
  aiEnabled: boolean;
};

const CHANNEL_OPTIONS: { value: CampaignChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "mixed", label: "Mixto" },
];

function newStep(type: StepType = "email", index: number, key?: string): DraftStep {
  return {
    key: key ?? `step-${type}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: "",
    delayDays: index === 0 ? "0" : "2",
    delayHours: "0",
    subject: "",
    body: "",
    aiEnabled: true,
  };
}

function CampaignForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listId = searchParams.get("listId");

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<CampaignChannel>("email");
  const [dailyLimit, setDailyLimit] = useState("50");
  const [autoSend, setAutoSend] = useState(false);
  const [steps, setSteps] = useState<DraftStep[]>(() => [newStep("email", 0, "step-inicial")]);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (key: string, patch: Partial<DraftStep>) => {
    setSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    );
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("El nombre de la campaña es obligatorio.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const response = await apiSend<{ campaign: { id: string } }>("/api/campaigns", "POST", {
        name: name.trim(),
        objective: objective.trim() || undefined,
        description: description.trim() || undefined,
        channel,
        dailyLimit: Number(dailyLimit) || 50,
        autoSend,
        steps: steps.map((step) => ({
          type: step.type,
          name: step.name.trim() || undefined,
          delayDays: Number(step.delayDays) || 0,
          delayHours: Number(step.delayHours) || 0,
          subject: step.subject.trim() || undefined,
          body: step.body.trim() || undefined,
          aiEnabled: step.aiEnabled,
          stopOnReply: true,
        })),
      });

      const campaignId = response.campaign.id;

      if (listId) {
        await apiSend(`/api/campaigns/${campaignId}/recipients`, "POST", { listId });
      }

      router.push(`/campaigns/${campaignId}`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  };

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
        title="Nueva campaña"
        description="Define el objetivo, el canal y la secuencia de pasos. Podrás editarla todo después."
      />

      {error ? <ErrorBox message={error} /> : null}

      <Card>
        <SectionTitle>Configuración</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <Input
              value={name}
              onChange={setName}
              placeholder="Ej. Physios Madrid - marzo"
            />
          </Field>
          <Field label="Objetivo" hint="Qué quieres conseguir con esta campaña.">
            <Input
              value={objective}
              onChange={setObjective}
              placeholder="Agendar una demo de 20 minutos"
            />
          </Field>
          <Field label="Descripción" hint="Opcional.">
            <Input
              value={description}
              onChange={setDescription}
              placeholder="Contexto para el equipo"
            />
          </Field>
          <Field label="Canal">
            <Select value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
          </Field>
          <Field label="Límite diario" hint="Máximo de mensajes enviados por día.">
            <Input value={dailyLimit} onChange={setDailyLimit} type="number" min={1} max={500} />
          </Field>
          <div className="flex items-end">
            <Checkbox
              checked={autoSend}
              onChange={setAutoSend}
              label="Envío automático"
              hint="Si está apagado, revisas la vista previa antes de enviar."
            />
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle
          hint="Los pasos se ejecutan en orden respetando las esperas"
          actions={
            <Button
              onClick={() => setSteps((current) => [...current, newStep("email", current.length)])}
            >
              <Icon name="plus" className="h-4 w-4" />
              Añadir paso
            </Button>
          }
        >
          Secuencia
        </SectionTitle>

        {steps.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sin pasos la campaña no haría nada. Añade al menos un email o una acción de LinkedIn.
          </p>
        ) : null}

        <ol className="space-y-4">
          {steps.map((step, index) => (
            <li key={step.key} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-800">
                    {STEP_TYPE_OPTIONS.find((option) => option.value === step.type)?.label ??
                      step.type}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className="h-8 w-8 px-0"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    title="Subir paso"
                  >
                    <Icon name="up" className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 px-0"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === steps.length - 1}
                    title="Bajar paso"
                  >
                    <Icon name="down" className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 px-0 text-red-600"
                    onClick={() => setSteps((current) => current.filter((s) => s.key !== step.key))}
                    title="Eliminar paso"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Tipo">
                  <Select
                    value={step.type}
                    onChange={(value) => updateStep(step.key, { type: value })}
                    options={STEP_TYPE_OPTIONS}
                  />
                </Field>
                <Field label="Nombre del paso" hint="Opcional.">
                  <Input
                    value={step.name}
                    onChange={(value) => updateStep(step.key, { name: value })}
                    placeholder="Primer contacto"
                  />
                </Field>
                <Field label="Espera (días)">
                  <Input
                    value={step.delayDays}
                    onChange={(value) => updateStep(step.key, { delayDays: value })}
                    type="number"
                    min={0}
                    max={90}
                  />
                </Field>
                <Field label="Espera (horas)">
                  <Input
                    value={step.delayHours}
                    onChange={(value) => updateStep(step.key, { delayHours: value })}
                    type="number"
                    min={0}
                    max={23}
                  />
                </Field>
              </div>

              {step.type === "email" ? (
                <div className="mt-3 space-y-3">
                  <Field label="Asunto" hint="Si lo dejas vacío, el agente lo redacta.">
                    <Input
                      value={step.subject}
                      onChange={(value) => updateStep(step.key, { subject: value })}
                      placeholder="¿Hablamos de vuestro centro en Madrid?"
                    />
                  </Field>
                  <Field label="Cuerpo" hint="Si lo dejas vacío, el agente lo escribe con tu Playbook.">
                    <Textarea
                      value={step.body}
                      onChange={(value) => updateStep(step.key, { body: value })}
                      rows={4}
                      placeholder="Hola {{nombre}}, ..."
                    />
                  </Field>
                </div>
              ) : null}

              <div className="mt-3">
                <Checkbox
                  checked={step.aiEnabled}
                  onChange={(checked) => updateStep(step.key, { aiEnabled: checked })}
                  label="Personalizar con IA"
                  hint="El agente adapta el mensaje a cada prospecto usando el Playbook."
                />
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </Link>
        <Button variant="primary" onClick={() => void submit()} disabled={creating}>
          {creating ? "Creando…" : "Crear campaña"}
        </Button>
      </div>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando formulario…" />}>
      <CampaignForm />
    </Suspense>
  );
}
