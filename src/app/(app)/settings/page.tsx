"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { formatDate } from "@/components/format";
import type { IdentityDTO } from "@/components/types";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  NoticeBox,
  PageHeader,
  SectionTitle,
  Select,
} from "@/components/ui";

type AiProviderDTO = {
  id: string;
  label: string;
  suggestedModels: string[];
  nativeWebSearch: boolean;
  docs: string;
  needsApiKey: boolean;
};

type AiSettingsDTO = {
  provider: string;
  model: string;
  webSearchModel: string;
  webSearchProvider: string;
  baseUrl: string;
  hasApiKey: boolean;
};

type AiFormState = {
  provider: string;
  model: string;
  webSearchModel: string;
  webSearchProvider: string;
  apiKey: string;
  baseUrl: string;
};

const EMPTY_AI_FORM: AiFormState = {
  provider: "minimax",
  model: "MiniMax-M3",
  webSearchModel: "MiniMax-M3.1-Flash",
  webSearchProvider: "auto",
  apiKey: "",
  baseUrl: "",
};

type FormState = {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
  linkedinUrl: string;
  dailyLimit: string;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPass: "",
  // 587 negocia el TLS (STARTTLS): el SSL implícito sólo es para 465.
  smtpSecure: false,
  linkedinUrl: "",
  dailyLimit: "50",
  isDefault: true,
};

export default function SettingsPage() {
  const [identities, setIdentities] = useState<IdentityDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  /** Identidad que se está editando (si la hay, el guardado hace PATCH). */
  const [editingId, setEditingId] = useState<string | null>(null);

  // Estado de la configuración de IA.
  const [aiProviders, setAiProviders] = useState<AiProviderDTO[]>([]);
  const [aiForm, setAiForm] = useState<AiFormState>(EMPTY_AI_FORM);
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const updateAi = (patch: Partial<AiFormState>) =>
    setAiForm((current) => ({ ...current, ...patch }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ identities: IdentityDTO[] }>("/api/identities");
      setIdentities(response.identities ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Carga la configuración de IA del servidor. */
  const loadAi = useCallback(async () => {
    try {
      const response = await apiGet<{
        settings: AiSettingsDTO;
        providers: AiProviderDTO[];
      }>("/api/ai-settings");
      setAiProviders(response.providers ?? []);
      setAiHasKey(Boolean(response.settings?.hasApiKey));
      setAiForm({
        provider: response.settings?.provider ?? "minimax",
        model: response.settings?.model ?? "MiniMax-M3",
        webSearchModel: response.settings?.webSearchModel ?? "MiniMax-M3.1-Flash",
        webSearchProvider: response.settings?.webSearchProvider ?? "auto",
        apiKey: "",
        baseUrl: response.settings?.baseUrl ?? "",
      });
    } catch (err) {
      setAiError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadAi();
  }, [loadAi]);

  /** Prueba el modelo (o la búsqueda web) sin guardar los cambios. */
  const testAi = async (kind: "test" | "testSearch") => {
    setAiBusy(true);
    setAiResult(null);
    setAiError(null);
    try {
      const response = await apiSend<{
        test?: { ok: boolean; detail: string; model?: string };
        search?: { ok: boolean; detail: string; hits?: number };
      }>("/api/ai-settings", "POST", { ...aiForm, [kind]: true });
      const result = kind === "test" ? response.test : response.search;
      setAiResult(result ? result.detail : "Sin respuesta del servidor.");
    } catch (err) {
      setAiError(errorMessage(err));
    } finally {
      setAiBusy(false);
    }
  };

  const saveAi = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiResult(null);
    try {
      await apiSend("/api/ai-settings", "POST", aiForm);
      setAiResult("Configuración de IA guardada.");
      await loadAi();
    } catch (err) {
      setAiError(errorMessage(err));
    } finally {
      setAiBusy(false);
    }
  };

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const payload = () => ({
    name: form.name.trim() || "Identidad",
    email: form.email.trim(),
    smtpHost: form.smtpHost.trim() || undefined,
    smtpPort: form.smtpPort ? Number(form.smtpPort) : undefined,
    smtpUser: form.smtpUser.trim() || undefined,
    smtpPass: form.smtpPass.length > 0 ? form.smtpPass : undefined,
    smtpSecure: form.smtpSecure,
    linkedinUrl: form.linkedinUrl.trim() || undefined,
    dailyLimit: form.dailyLimit ? Number(form.dailyLimit) : undefined,
    isDefault: form.isDefault,
  });

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setFormError(null);
    try {
      const response = await apiSend<{ ok: boolean; error?: string }>("/api/identities", "POST", {
        ...payload(),
        test: true,
      });
      setTestResult(response);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!form.email.trim()) {
      setFormError("El email es obligatorio.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      if (editingId) {
        await apiSend(`/api/identities/${editingId}`, "PATCH", payload());
        setNotice("Identidad actualizada.");
      } else {
        await apiSend("/api/identities", "POST", payload());
        setNotice("Identidad guardada.");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setTestResult(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  /** Carga una identidad en el formulario para editarla. */
  const edit = (identity: (typeof identities)[number]) => {
    setEditingId(identity.id);
    setTestResult(null);
    setFormError(null);
    setForm({
      name: identity.name,
      email: identity.email,
      smtpHost: identity.smtpHost ?? "",
      smtpPort: String(identity.smtpPort ?? 587),
      smtpUser: identity.smtpUser ?? "",
      smtpPass: "",
      smtpSecure: identity.smtpSecure ?? (identity.smtpPort ?? 587) === 465,
      linkedinUrl: identity.linkedinUrl ?? "",
      dailyLimit: String(identity.dailyLimit ?? 50),
      isDefault: identity.isDefault,
    });
  };

  const remove = async (identity: (typeof identities)[number]) => {
    setSaving(true);
    setFormError(null);
    try {
      await apiSend(`/api/identities/${identity.id}`, "DELETE");
      if (editingId === identity.id) {
        setForm(EMPTY_FORM);
        setEditingId(null);
      }
      setNotice(`Identidad "${identity.name}" eliminada.`);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajustes"
        description="Configura desde qué cuenta se envía el correo y revisa el estado del sistema."
      />

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <Card>
        <SectionTitle hint="El modelo que redacta los emails, extrae prospectos y analiza la web">
          Inteligencia artificial
        </SectionTitle>

        {aiError ? <p className="mb-3 text-sm text-red-600">{aiError}</p> : null}
        {aiResult ? (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {aiResult}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor">
            <Select
              value={aiForm.provider}
              onChange={(provider) => {
                const info = aiProviders.find((p) => p.id === provider);
                updateAi({
                  provider,
                  // Al cambiar de proveedor se propose un modelo que funcione.
                  model: info?.suggestedModels[0] ?? aiForm.model,
                  webSearchModel: info?.suggestedModels[0] ?? aiForm.webSearchModel,
                });
              }}
              options={aiProviders.map((p) => ({ value: p.id, label: p.label }))}
            />
          </Field>
          <Field
            label="Modelo"
            hint={
              aiProviders.find((p) => p.id === aiForm.provider)?.docs ??
              "Modelo que se usará para el análisis y la redacción."
            }
          >
            <Input
              value={aiForm.model}
              onChange={(value) => updateAi({ model: value })}
              placeholder="MiniMax-M3"
            />
          </Field>
          <Field
            label="Clave API"
            hint={
              aiHasKey
                ? "Ya hay una clave guardada: déjala en blanco para no cambiarla."
                : "En MiniMax no hace falta: se usa la sesión del sistema."
            }
          >
            <Input
              value={aiForm.apiKey}
              onChange={(value) => updateAi({ apiKey: value })}
              type="password"
              placeholder={aiHasKey ? "•••••••• (guardada)" : "sk-..."}
            />
          </Field>
          <Field
            label="Endpoint (opcional)"
            hint="Déjalo vacío para el de por defecto. Ej.: https://openrouter.ai/api/v1"
          >
            <Input
              value={aiForm.baseUrl}
              onChange={(value) => updateAi({ baseUrl: value })}
              placeholder="(el del proveedor)"
            />
          </Field>
          <Field
            label="Modelo para buscar en la web"
            hint="El que hace las búsquedas del AI Finder. En Claude y OpenRouter es el mismo."
          >
            <Input
              value={aiForm.webSearchModel}
              onChange={(value) => updateAi({ webSearchModel: value })}
              placeholder="MiniMax-M3.1-Flash"
            />
          </Field>
          <Field label="Motor de búsqueda web">
            <Select
              value={aiForm.webSearchProvider}
              onChange={(webSearchProvider) => updateAi({ webSearchProvider })}
              options={[
                { value: "auto", label: "Automático (el del proveedor, o MiniMax)" },
                { value: "minimax", label: "MiniMax" },
                { value: "anthropic", label: "Claude (Anthropic)" },
                { value: "openrouter", label: "OpenRouter" },
                { value: "openai", label: "El del proveedor compatible con OpenAI" },
                { value: "none", label: "Sin búsqueda web" },
              ]}
            />
          </Field>
        </div>

        <NoticeBox message="La búsqueda web es lo que permite al AI Finder descubrir negocios reales. Si el proveedor elegido no trae búsqueda propia, el buscador automático cae a MiniMax si está disponible en el sistema." />

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button onClick={() => void testAi("test")} disabled={aiBusy}>
            Probar modelo
          </Button>
          <Button onClick={() => void testAi("testSearch")} disabled={aiBusy}>
            Probar búsqueda web
          </Button>
          <Button variant="primary" onClick={saveAi} disabled={aiBusy}>
            Guardar
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="La cuenta desde la que salen tus emails y tu perfil de LinkedIn">
          Identidades de envío
        </SectionTitle>

        {loading ? (
          <LoadingBlock label="Cargando identidades…" />
        ) : identities.length === 0 ? (
          <EmptyState
            title="No hay identidades configuradas"
            description="Crea una identidad con tu email de trabajo para que las campañas envíen desde tu cuenta."
          />
        ) : (
          <ul className="space-y-3">
            {identities.map((identity) => (
              <li
                key={identity.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon name="user" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{identity.name}</span>
                    {identity.isDefault ? <Badge tone="green">Por defecto</Badge> : null}
                    {identity.hasPassword ? (
                      <Badge tone="slate">SMTP configurado</Badge>
                    ) : (
                      <Badge tone="amber">Sin SMTP</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {identity.email}
                    {identity.smtpHost
                      ? ` · ${identity.smtpHost}:${identity.smtpPort ?? 587}${
                          identity.smtpUser ? ` · ${identity.smtpUser}` : ""
                        }`
                      : " · sin servidor SMTP"}
                    {` · límite ${identity.dailyLimit}/día`}
                  </p>
                  {identity.linkedinUrl ? (
                    <a
                      href={identity.linkedinUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Perfil de LinkedIn
                      <Icon name="external" className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => edit(identity)}>
                    Editar
                  </Button>
                  <Button variant="danger" onClick={() => void remove(identity)}>
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <NoticeBox message="Sin SMTP configurado los mensajes no se envían solos: la app los encola y te enseña el texto exacto para que lo copies y lo envíes a mano desde tu correo. Con SMTP y una identidad marcada por defecto, las campañas envían automáticamente." />
      </Card>

      <Card>
        <SectionTitle hint="Puedes crear varias identidades y rotar entre ellas">
          {editingId ? "Editando identidad" : "Nueva identidad"}
        </SectionTitle>

        {editingId ? (
          <NoticeBox message="Estás editando una identidad existente. Si dejas la contraseña en blanco se conserva la que ya tenía." />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <Input
              value={form.name}
              onChange={(value) => update({ name: value })}
              placeholder="Alvaro · AgendaOS"
            />
          </Field>
          <Field label="Email">
            <Input
              value={form.email}
              onChange={(value) => update({ email: value })}
              placeholder="hola@tuempresa.com"
              type="email"
            />
          </Field>
          <Field
            label="Servidor SMTP"
            hint="Host del servidor de salida. Ej.: smtp.dondominio.com, smtp.ionos.com, smtp.gmail.com."
          >
            <Input
              value={form.smtpHost}
              onChange={(value) => update({ smtpHost: value })}
              placeholder="smtp.tuempresa.com"
            />
          </Field>
          <Field
            label="Puerto"
            hint="587 = STARTTLS (recomendado) · 465 = SSL directo · 25 sin cifrar"
          >
            <Input
              value={form.smtpPort}
              onChange={(value) => {
                // El SSL implícito sólo tiene sentido en el 465. En el 587 el
                // TLS se negocia al vuelo: marcarlo rompe la conexión.
                const port = Number(value);
                update({
                  smtpPort: value,
                  smtpSecure: port === 465,
                });
              }}
              type="number"
              min={1}
              max={65535}
            />
          </Field>
          <Field label="Usuario SMTP" hint="Suele ser tu propio email.">
            <Input
              value={form.smtpUser}
              onChange={(value) => update({ smtpUser: value })}
              placeholder="hola@tuempresa.com"
            />
          </Field>
          <Field label="Contraseña SMTP" hint="Se guarda en tu base de datos local.">
            <Input
              value={form.smtpPass}
              onChange={(value) => update({ smtpPass: value })}
              type="password"
              placeholder="••••••••"
            />
          </Field>
          <Field label="Perfil de LinkedIn" hint="Opcional.">
            <Input
              value={form.linkedinUrl}
              onChange={(value) => update({ linkedinUrl: value })}
              placeholder="https://linkedin.com/in/tu-perfil"
            />
          </Field>
          <Field label="Límite diario de envíos">
            <Input
              value={form.dailyLimit}
              onChange={(value) => update({ dailyLimit: value })}
              type="number"
              min={1}
              max={500}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <Checkbox
            checked={form.smtpSecure}
            onChange={(checked) => update({ smtpSecure: checked })}
            label="SSL directo (sólo puerto 465)"
          />
          <Checkbox
            checked={form.isDefault}
            onChange={(checked) => update({ isDefault: checked })}
            label="Usar como identidad por defecto"
          />
        </div>

        {testResult ? (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              testResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {testResult.ok
              ? "Conexión correcta: el servidor SMTP acepta las credenciales."
              : `No se ha podido conectar: ${testResult.error ?? "error desconocido"}.`}
          </div>
        ) : null}

        {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {editingId ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
                setTestResult(null);
              }}
            >
              Cancelar edición
            </Button>
          ) : null}
          <Button onClick={testConnection} disabled={testing}>
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar identidad"}
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Cómo funciona el envío</SectionTitle>
        <ol className="space-y-3 text-sm text-slate-600">
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              1
            </span>
            <span>
              La campaña recorre sus pasos en orden. Cada paso espera su tiempo antes de dispararse.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              2
            </span>
            <span>
              Si el lead responde, la secuencia se detiene para ese lead y la respuesta aparece en el
              Inbox.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              3
            </span>
            <span>
              Los pasos de LinkedIn y de llamada se convierten en tareas: los haces tú y los marcas
              como hechos.
            </span>
          </li>
        </ol>
        <p className="mt-4 text-xs text-slate-500">
          Última revisión de la configuración: {formatDate(new Date().toISOString())}.
        </p>
      </Card>
    </div>
  );
}
