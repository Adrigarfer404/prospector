"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import type { IcpCriterionDTO, PlaybookDTO } from "@/components/types";
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from "@/components/ui";

const OP_OPTIONS = [
  { value: "equals", label: "es igual a" },
  { value: "not_equals", label: "no es igual a" },
  { value: "contains", label: "contiene" },
  { value: "not_contains", label: "no contiene" },
  { value: "in", label: "está en" },
  { value: "not_in", label: "no está en" },
  { value: "gt", label: "mayor que" },
  { value: "gte", label: "igual o mayor que" },
  { value: "lt", label: "menor que" },
  { value: "lte", label: "igual o menor que" },
  { value: "exists", label: "existe" },
  { value: "not_exists", label: "no existe" },
  { value: "regex", label: "coincide con" },
];

const FIELD_OPTIONS = [
  { value: "jobTitle", label: "Cargo" },
  { value: "city", label: "Ciudad" },
  { value: "region", label: "Provincia" },
  { value: "country", label: "País" },
  { value: "email", label: "Email" },
  { value: "phoneNumber", label: "Teléfono" },
  { value: "linkedinUrl", label: "LinkedIn" },
  { value: "website", label: "Web" },
  { value: "company.industry", label: "Sector de la empresa" },
  { value: "company.size", label: "Tamaño de la empresa" },
  { value: "company.description", label: "Descripción de la empresa" },
];

type CriterionDraft = {
  key: string;
  field: string;
  op: string;
  value: string;
  weight: string;
  label: string;
};

const emptyCriterion = (): CriterionDraft => ({
  key: Math.random().toString(36).slice(2, 10),
  field: "jobTitle",
  op: "contains",
  value: "",
  weight: "10",
  label: "",
});

export default function PlaybookPage() {
  const [playbook, setPlaybook] = useState<PlaybookDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [proofPoints, setProofPoints] = useState<string[]>([]);
  const [disqualified, setDisqualified] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<CriterionDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ playbook: PlaybookDTO }>("/api/playbook");
      const data = response.playbook;
      setPlaybook(data);
      setProofPoints(data.proofPoints ?? []);
      setDisqualified(data.disqualified ?? []);
      setCriteria(
        (data.icpCriteria ?? []).map((criterion) => ({
          key: Math.random().toString(36).slice(2, 10),
          field: criterion.field ?? "jobTitle",
          op: criterion.op ?? "contains",
          value:
            criterion.value === undefined || criterion.value === null
              ? ""
              : String(criterion.value),
          weight: String(criterion.weight ?? 10),
          label: criterion.label ?? "",
        })),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<PlaybookDTO>) => {
    setPlaybook((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!playbook) return;
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const icpCriteria: IcpCriterionDTO[] = criteria.map((criterion) => ({
        field: criterion.field,
        op: criterion.op,
        value: criterion.value,
        weight: Number(criterion.weight) || 0,
        label: criterion.label || undefined,
      }));
      await apiSend("/api/playbook", "PUT", {
        ourCompany: playbook.ourCompany,
        ourOffer: playbook.ourOffer,
        ourValue: playbook.ourValue,
        icpSummary: playbook.icpSummary,
        tone: playbook.tone,
        language: playbook.language,
        cta: playbook.cta,
        signature: playbook.signature,
        proofPoints: proofPoints.filter((point) => point.trim().length > 0),
        disqualified: disqualified.filter((point) => point.trim().length > 0),
        icpCriteria,
      });
      setNotice("Playbook guardado. El agente lo usará para redactar y puntuar.");
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingBlock label="Cargando playbook…" />;
  }

  if (error || !playbook) {
    return (
      <ErrorBox message={error ?? "No se ha podido cargar el playbook."} onRetry={() => void load()} />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playbook"
        description="La guía comercial de tu negocio. El agente la usa para redactar mensajes y para puntuar a cada prospecto."
        actions={
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Guardando…" : "Guardar playbook"}
          </Button>
        }
      />

      {saveError ? <ErrorBox message={saveError} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <Card>
        <SectionTitle>Tu negocio</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Empresa">
            <Input
              value={playbook.ourCompany}
              onChange={(value) => update({ ourCompany: value })}
              placeholder="AgendaOS"
            />
          </Field>
          <Field label="Idioma">
            <Input
              value={playbook.language}
              onChange={(value) => update({ language: value })}
              placeholder="es"
            />
          </Field>
          <Field label="Qué vendes" hint="Una frase clara.">
            <Textarea
              value={playbook.ourOffer ?? ""}
              onChange={(value) => update({ ourOffer: value })}
              rows={3}
              placeholder="Software de gestión de citas para clínicas"
            />
          </Field>
          <Field label="Por qué tú" hint="Tu ventaja diferencial.">
            <Textarea
              value={playbook.ourValue ?? ""}
              onChange={(value) => update({ ourValue: value })}
              rows={3}
              placeholder="Ahorra 10 horas al mes ensecretos"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Así se calcula el encaje de cada lead">
          Cliente ideal (ICP)
        </SectionTitle>
        <Field label="Resumen del ICP">
          <Textarea
            value={playbook.icpSummary ?? ""}
            onChange={(value) => update({ icpSummary: value })}
            rows={3}
            placeholder="Fisioterapeutas con clínica propia en Madrid de 1 a 10 profesionales"
          />
        </Field>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Criterios de puntuación</p>
            <Button onClick={() => setCriteria((current) => [...current, emptyCriterion()])}>
              <Icon name="plus" className="h-4 w-4" />
              Añadir criterio
            </Button>
          </div>

          {criteria.length === 0 ? (
            <p className="text-sm text-slate-500">
              Sin criterios el score se basará solo en los datos de contacto disponibles.
            </p>
          ) : (
            <div className="space-y-3">
              {criteria.map((criterion, index) => (
                <div
                  key={criterion.key}
                  className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-6"
                >
                  <Field label="Campo">
                    <Select
                      value={criterion.field}
                      onChange={(value) =>
                        setCriteria((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, field: value } : item,
                          ),
                        )
                      }
                      options={FIELD_OPTIONS}
                    />
                  </Field>
                  <Field label="Condición">
                    <Select
                      value={criterion.op}
                      onChange={(value) =>
                        setCriteria((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, op: value } : item,
                          ),
                        )
                      }
                      options={OP_OPTIONS}
                    />
                  </Field>
                  <Field label="Valor">
                    <Input
                      value={criterion.value}
                      onChange={(value) =>
                        setCriteria((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value } : item,
                          ),
                        )
                      }
                      placeholder="fisioterapia"
                    />
                  </Field>
                  <Field label="Peso">
                    <Input
                      value={criterion.weight}
                      onChange={(value) =>
                        setCriteria((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, weight: value } : item,
                          ),
                        )
                      }
                      type="number"
                      min={0}
                      max={100}
                    />
                  </Field>
                  <Field label="Etiqueta" hint="Opcional.">
                    <Input
                      value={criterion.label}
                      onChange={(value) =>
                        setCriteria((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, label: value } : item,
                          ),
                        )
                      }
                      placeholder="Fisio con web"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      className="text-red-600"
                      onClick={() =>
                        setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <Icon name="trash" className="h-4 w-4" />
                      Quitar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Criterios de exclusión</p>
            <p className="mb-2 text-xs text-slate-500">
              Ejemplos: cadenas de franquicias, negocios sin web, competitors.
            </p>
            <div className="space-y-2">
              {disqualified.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={item}
                    onChange={(value) =>
                      setDisqualified((current) =>
                        current.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    className="text-red-600"
                    onClick={() =>
                      setDisqualified((current) => current.filter((_, entryIndex) => entryIndex !== index))
                    }
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button onClick={() => setDisqualified((current) => [...current, ""])}>
                <Icon name="plus" className="h-4 w-4" />
                Añadir exclusión
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Pruebas sociales</p>
            <p className="mb-2 text-xs text-slate-500">
              Datos que puedes usar en los mensajes (clientes, resultados, plazos).
            </p>
            <div className="space-y-2">
              {proofPoints.map((point, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={point}
                    onChange={(value) =>
                      setProofPoints((current) =>
                        current.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    className="text-red-600"
                    onClick={() =>
                      setProofPoints((current) => current.filter((_, entryIndex) => entryIndex !== index))
                    }
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button onClick={() => setProofPoints((current) => [...current, ""])}>
                <Icon name="plus" className="h-4 w-4" />
                Añadir prueba
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Cómo debe sonar el agente">Estilo</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tono">
            <Input
              value={playbook.tone}
              onChange={(value) => update({ tone: value })}
              placeholder="profesional y cercano"
            />
          </Field>
          <Field label="Llamada a la acción" hint="La frase final del mensaje.">
            <Input
              value={playbook.cta ?? ""}
              onChange={(value) => update({ cta: value })}
              placeholder="¿Te va bien una demo de 15 minutos?"
            />
          </Field>
          <Field label="Firma" className="sm:col-span-2">
            <Textarea
              value={playbook.signature ?? ""}
              onChange={(value) => update({ signature: value })}
              rows={3}
              placeholder="Un saludo,\nAlvaro"
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}
