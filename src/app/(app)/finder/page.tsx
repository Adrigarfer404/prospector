"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  ScoreBadge,
  SectionTitle,
  Spinner,
  StatCard,
} from "@/components/ui";
import { displayName } from "@/components/format";
import type { FinderResult, LeadDTO } from "@/components/types";

const EXAMPLES = [
  "fisioterapeutas en Madrid",
  "dentistas en Valencia",
  "nutricionistas en Barcelona",
  "osteópatas en Sevilla",
];

const PHASES = [
  "Buscando negocios en la web…",
  "Contrastando con el BORME…",
  "Enriqueciendo webs y correos de contacto…",
  "Puntuando los prospectos contra tu ICP…",
  "Guardando los resultados…",
];

export default function FinderPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [listName, setListName] = useState("");
  const [resolve, setResolve] = useState(true);
  // Google Maps es opt-in: sin la API key de Outscraper no se puede usar.
  const [includeMaps, setIncludeMaps] = useState(false);
  const [mapsConfigured, setMapsConfigured] = useState(false);

  const [searching, setSearching] = useState(false);
  const [phase, setPhase] = useState(0);
  const [result, setResult] = useState<FinderResult | null>(null);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedList, setSavedList] = useState<{ id: string; name: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!searching) return;
    const timer = setInterval(() => {
      setPhase((current) => Math.min(current + 1, PHASES.length - 1));
    }, 7000);
    return () => clearInterval(timer);
  }, [searching]);

  // ¿Está Google Maps disponible en este servidor?
  useEffect(() => {
    let cancelled = false;
    void apiGet<{ mapsConfigured: boolean }>("/api/finder")
      .then((data) => {
        if (!cancelled) setMapsConfigured(Boolean(data.mapsConfigured));
      })
      .catch(() => {
        /* si no se puede consultar, se deja el checkbox deshabilitado */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSearch = query.trim().length >= 3 && !searching;

  const runSearch = async () => {
    if (!canSearch) return;
    setSearching(true);
    setPhase(0);
    setError(null);
    setResult(null);
    setLeads([]);
    setSavedList(null);
    setSaveError(null);

    try {
      const response = await apiSend<FinderResult>("/api/finder", "POST", {
        query: query.trim(),
        ...(location.trim() ? { location: location.trim() } : {}),
        resolve,
        includeMaps,
      });
      setResult(response);

      const all = await apiGet<{ leads: LeadDTO[] }>("/api/leads?take=200&sort=score");
      const ids = new Set(response.leadIds ?? []);
      setLeads(all.leads.filter((lead) => ids.has(lead.id)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const saveToList = async () => {
    const name = listName.trim();
    if (!name) {
      setSaveError("Escribe un nombre para la lista antes de guardar.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const created = await apiSend<{ list: { id: string; name: string } }>("/api/lists", "POST", {
        name,
        description: `Generado con el AI Finder: ${query.trim()}`,
        icp: query.trim(),
      });
      const listId = created.list.id;

      // Alta masiva: un único POST en vez de un PATCH por lead.
      await apiSend("/api/leads/assign-list", "POST", {
        leadIds: leads.map((lead) => lead.id),
        listId,
        add: true,
      });

      setSavedList(created.list);
      setLeads((current) =>
        current.map((lead) => ({ ...lead, listIds: Array.from(new Set([...lead.listIds, listId])) })),
      );
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const counters = useMemo(() => {
    if (!result) return null;
    return [
      { label: "Negocios encontrados", value: result.found },
      { label: "Empresas", value: result.companies },
      { label: "Prospectos", value: result.leads },
      { label: "Enriquecidos", value: result.enriched },
    ];
  }, [result]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Finder"
        description="Describe a quién buscas y el agente encuentra negocios reales, visita su web y te trae contactos con email y teléfono."
      />

      <Card className="overflow-hidden">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
          className="space-y-4"
        >
          <Field label="¿A quién buscas?">
            <Input
              value={query}
              onChange={setQuery}
              placeholder="Ej. fisioterapeutas en Madrid que tengan web propia"
              className="py-3 text-base"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-700"
              >
                {example}
              </button>
            ))}
          </div>

          {includeMaps && !mapsConfigured ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Google Maps está marcado pero el servidor no tiene OUTSCRAPER_API_KEY: se buscará sólo
              en la web y en el BORME.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Ubicación" hint="Ciudad o barrio. Si lo dejas vacío se usa la del texto.">
              <Input
                value={location}
                onChange={setLocation}
                placeholder="Madrid"
                disabled={searching}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={resolve}
                  onChange={(event) => setResolve(event.target.checked)}
                  disabled={searching}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Buscar también los negocios sin web
              </label>
              <label
                className={`flex items-center gap-2 pb-2.5 text-sm ${
                  mapsConfigured ? "text-slate-600" : "text-slate-400"
                }`}
                title={
                  mapsConfigured
                    ? "Añade el censo de Google Maps: negocios con reseñas y teléfono, no sólo los mejor posicionados en la web."
                    : "Requiere OUTSCRAPER_API_KEY en el .env del servidor."
                }
              >
                <input
                  type="checkbox"
                  checked={includeMaps}
                  onChange={(event) => setIncludeMaps(event.target.checked)}
                  disabled={searching || !mapsConfigured}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Incluir Google Maps
              </label>
              <Button type="submit" variant="primary" disabled={!canSearch} className="h-[42px]">
                {searching ? <Spinner /> : <Icon name="search" className="h-4 w-4" />}
                Buscar prospectos
              </Button>
            </div>
          </div>
        </form>
      </Card>

      {searching ? (
        <Card>
          <div className="flex items-center gap-3">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <div>
              <p className="text-sm font-medium text-slate-900">Buscando prospectos…</p>
              <p className="text-xs text-slate-500">
                Puede tardar entre 30 y 60 segundos. No cierres esta ventana.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {PHASES.map((text, index) => (
              <li
                key={text}
                className={`flex items-center gap-2 text-sm ${
                  index < phase
                    ? "text-slate-400"
                    : index === phase
                      ? "font-medium text-slate-800"
                      : "text-slate-300"
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                    index < phase
                      ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                      : index === phase
                        ? "border-indigo-300 bg-indigo-50 text-indigo-600"
                        : "border-slate-200 text-slate-300"
                  }`}
                >
                  {index < phase ? "✓" : index + 1}
                </span>
                {text}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {error ? <ErrorBox message={error} onRetry={() => void runSearch()} /> : null}

      {result && !searching ? (
        <div ref={resultRef} className="space-y-6">
          <Card>
            <SectionTitle hint="Cómo ha interpretado el agente tu búsqueda">
              Interpretación
            </SectionTitle>
            <p className="text-sm leading-relaxed text-slate-700">{result.interpretation}</p>

            {counters ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {counters.map((counter) => (
                  <StatCard key={counter.label} label={counter.label} value={counter.value} />
                ))}
              </div>
            ) : null}

            {result.warnings.length > 0 ? (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">Avisos de la búsqueda</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {result.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card>
            <SectionTitle
              hint={`${leads.length} prospectos listos para revisar`}
              actions={
                <Link
                  href="/leads"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Ver todos los leads
                  <Icon name="external" className="h-3.5 w-3.5" />
                </Link>
              }
            >
              Prospectos encontrados
            </SectionTitle>

            {leads.length === 0 ? (
              <EmptyState
                title="No se han guardado prospectos"
                description="Prueba con otra búsqueda, por ejemplo 'fisioterapeutas en Madrid'."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {leads.map((lead) => (
                  <div key={lead.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-sm font-medium text-slate-900 hover:text-indigo-700"
                      >
                        {displayName(lead)}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[
                          lead.jobTitle,
                          lead.companyName,
                          [lead.city, lead.region].filter(Boolean).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Sin datos adicionales"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      {lead.email ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="mail" className="h-3.5 w-3.5 text-slate-400" />
                          {lead.email}
                        </span>
                      ) : (
                        <span className="text-slate-400">Sin email</span>
                      )}
                      {lead.phoneNumber ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="phone" className="h-3.5 w-3.5 text-slate-400" />
                          {lead.phoneNumber}
                        </span>
                      ) : null}
                    </div>
                    <ScoreBadge score={lead.score} />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-slate-100 pt-5">
              {savedList ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  Guardados {leads.length} prospectos en la lista{" "}
                  <Link href={`/lists/${savedList.id}`} className="font-semibold underline">
                    {savedList.name}
                  </Link>
                  .
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field label="Guardar en una lista" className="flex-1">
                    <Input
                      value={listName}
                      onChange={setListName}
                      placeholder="Ej. Fisioterapia Madrid"
                      disabled={saving}
                    />
                  </Field>
                  <Button
                    variant="primary"
                    onClick={() => void saveToList()}
                    disabled={saving || leads.length === 0}
                  >
                    {saving ? <Spinner /> : null}
                    Guardar en lista
                  </Button>
                </div>
              )}
              {saveError ? <p className="mt-2 text-sm text-red-600">{saveError}</p> : null}
            </div>
          </Card>

          <Card>
            <SectionTitle>De dónde vienen los datos</SectionTitle>
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <Icon name="target" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span>
                  Los negocios se localizan con <strong>búsqueda web en tiempo real</strong> y se
                  contrastan con el <strong>BORME</strong> (registro mercantil) para ampliar la
                  cobertura.
                </span>
              </li>
              <li className="flex gap-2">
                <Icon name="search" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span>
                  Para los negocios enriquecidos se visita <strong>su web pública</strong> y se
                  extraen emails y teléfonos de contacto publicados por la propia empresa.
                </span>
              </li>
              {(result.sources ?? []).some((source) => source.toLowerCase().includes("maps")) ? (
                <li className="flex gap-2">
                  <Icon name="target" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                  <span>
                    Parte de los negocios viene de <strong>Google Maps</strong>: aporta los que no
                    salen bien posicionados en la web, su <strong>teléfono</strong> y su{" "}
                    <strong>número de reseñas</strong>, que es la señal de demanda que se usa para
                    priorizar.
                  </span>
                </li>
              ) : null}
              <li className="flex gap-2">
                <Icon name="chart" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span>
                  Cada prospecto se <strong>puntúa contra tu ICP</strong> (Playbook) para que priorices
                  a quién contactar primero.
                </span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              No se importan datos personales de redes sociales: solo información publicada por los
              negocios.
            </p>
          </Card>
        </div>
      ) : null}

      {!result && !searching && !error ? (
        <EmptyState
          title="Aún no hay búsquedas"
          description="Prueba con 'fisioterapeutas en Madrid' para ver los negocios que encuentra el agente."
        />
      ) : null}

      {result && result.leads > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge tone="indigo">
            Fuente: {(result.sources ?? ["web"]).join(" + ") || "web"}
          </Badge>
          <Badge tone="slate">Web pública del negocio</Badge>
          <Badge tone="slate">Puntuación con tu ICP</Badge>
          {(result.sources ?? []).some((source) => source.toLowerCase().includes("maps")) ? (
            <Badge tone="slate">Datos de lugar y reputación: Google Maps</Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
