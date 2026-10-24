/**
 * Capa de IA intercambiable.
 *
 * La app no sabe qué proveedor hay activo: pide "completa esto" o "busca
 * esto" y este módulo decide a quién llama según la configuración guardada
 * en Ajustes (base de datos) o en las variables de entorno.
 *
 * Prioridad de la configuración:
 *   1) Lo guardado en Ajustes → IA (base de datos).
 *   2) Variables de entorno (AI_PROVIDER, AI_API_KEY, ...).
 *   3) Valores por defecto: MiniMax con la sesión del runtime local.
 *
 * La búsqueda web es un servicio aparte del modelo: cada proveedor tiene su
 * propia forma de buscarla, y aquí se unifican en el mismo formato.
 */

import { prisma } from "../db";
import { getWorkspace } from "../workspace";
import {
  callAnthropic,
  extractAnthropicHits,
  extractAnthropicText,
} from "./anthropic";
import { callOpenAi, extractOpenAiHits, extractOpenAiText } from "./openai";
import {
  AI_PROVIDERS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_BASE_URLS,
  type AiProviderId,
  type AiSettings,
  type AiWebSearchProvider,
  type ChatMessage,
  type WebSearchHit,
} from "./types";

export * from "./types";
export { AI_PROVIDERS, DEFAULT_AI_SETTINGS };

/** Ajustes que salen de las variables de entorno (si están). */
function envSettings(): Partial<AiSettings> {
  const provider = process.env.AI_PROVIDER?.trim();
  const model = process.env.AI_MODEL?.trim();
  const webSearchModel = process.env.AI_WEB_SEARCH_MODEL?.trim();
  const webSearchProvider = process.env.AI_WEB_SEARCH_PROVIDER?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  const baseUrl = process.env.AI_BASE_URL?.trim();

  const settings: Partial<AiSettings> = {};
  if (provider && provider in DEFAULT_BASE_URLS) {
    settings.provider = provider as AiProviderId;
  }
  if (model) settings.model = model;
  if (webSearchModel) settings.webSearchModel = webSearchModel;
  if (webSearchProvider) {
    settings.webSearchProvider = webSearchProvider as AiWebSearchProvider;
  }
  if (apiKey) settings.apiKey = apiKey;
  if (baseUrl) settings.baseUrl = baseUrl;
  return settings;
}

let cachedSettings: { at: number; value: AiSettings } | null = null;

/**
 * Ajustes temporales (sólo para probar una configuración sin guardarla).
 * Se aplican por encima de todo lo demás y se descartan con `null`.
 */
let overrideSettings: Partial<AiSettings> | null = null;

export function setAiSettingsOverride(settings: Partial<AiSettings> | null): void {
  overrideSettings = settings;
  invalidateAiSettings();
}

/**
 * Ajustes activos. Se cachean 5 segundos para no consultar la base en cada
 * llamada durante una búsqueda (que hace decenas de peticiones).
 */
export async function resolveAiSettings(): Promise<AiSettings> {
  if (cachedSettings && Date.now() - cachedSettings.at < 5000) {
    return cachedSettings.value;
  }

  let stored: Partial<AiSettings> = {};
  try {
    const workspace = await getWorkspace();
    const row = await prisma.aiSetting.findUnique({ where: { workspaceId: workspace.id } });
    if (row) {
      stored = {
        provider: row.provider as AiProviderId,
        model: row.model,
        webSearchModel: row.webSearchModel,
        webSearchProvider: row.webSearchProvider as AiWebSearchProvider,
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
      };
    }
  } catch {
    // Sin base de datos (por ejemplo en un script suelto) se sigue con env.
  }

  const value: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...stored,
    ...envSettings(),
    ...(overrideSettings ?? {}),
  };

  cachedSettings = { at: Date.now(), value };
  return value;
}

/** Invalida la caché (tras guardar ajustes nuevos). */
export function invalidateAiSettings(): void {
  cachedSettings = null;
}

function isProviderId(value: string): value is AiProviderId {
  return value in DEFAULT_BASE_URLS;
}

/** Credenciales y endpoint con los que se habla con un proveedor. */
async function clientFor(provider: AiProviderId, settings: AiSettings) {
  if (provider === "minimax") {
    // MiniMax usa la sesión del runtime local: base URL y token salen de
    // ~/.minimax. Si el usuario pone una clave propia, manda sobre el token.
    const { getMiniMaxConfig } = await import("../providers/minimax");
    const local = getMiniMaxConfig();
    return {
      kind: "anthropic" as const,
      baseUrl:
        settings.baseUrl?.trim() || local?.baseURL || DEFAULT_BASE_URLS.minimax,
      apiKey: settings.apiKey ?? local?.accessToken ?? null,
      authMode: "bearer" as const,
    };
  }

  const baseUrl =
    settings.baseUrl?.trim() || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai;

  if (provider === "anthropic") {
    return {
      kind: "anthropic" as const,
      baseUrl,
      apiKey: settings.apiKey,
      authMode: "x-api-key" as const,
    };
  }
  if (provider === "openrouter") {
    return {
      kind: "openai" as const,
      baseUrl,
      apiKey: settings.apiKey,
      supportsWebPlugin: true,
    };
  }
  return {
    kind: "openai" as const,
    baseUrl,
    apiKey: settings.apiKey,
    supportsWebPlugin: false,
  };
}

export type CompleteOptions = {
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

/**
 * Pide JSON al modelo activo y lo parsea de forma tolerante (fences, texto
 * alrededor, arrays).
 */
export async function completeJson<T>(
  prompt: string,
  opts: CompleteOptions = {},
): Promise<T | null> {
  const settings = await resolveAiSettings();
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const model = opts.model ?? settings.model;
  const maxTokens = opts.maxTokens ?? 8000;
  const temperature = opts.temperature ?? 0.1;
  const timeoutMs = opts.timeoutMs ?? 240_000;

  const raw = await completeText(messages, {
    model,
    maxTokens,
    temperature,
    timeoutMs,
    json: true,
  });
  return parseJsonLoose<T>(raw);
}

/** Pide texto plano al modelo activo. */
export async function completeText(
  messages: ChatMessage[],
  opts: CompleteOptions & { json?: boolean } = {},
): Promise<string> {
  const settings = await resolveAiSettings();
  const model = opts.model ?? settings.model;
  const client = await clientFor(settings.provider, settings);

  if (client.kind === "anthropic") {
    const response = await callAnthropic(
      { baseUrl: client.baseUrl, apiKey: client.apiKey, authMode: client.authMode },
      {
        model,
        messages,
        maxTokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature,
        timeoutMs: opts.timeoutMs ?? 240_000,
      },
    );
    const text = extractAnthropicText(response);
    if (!text) throw new Error("El modelo no devolvió texto (respuesta vacía).");
    return text;
  }

  const response = await callOpenAi(
    {
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      supportsWebPlugin: client.supportsWebPlugin,
    },
    {
      model,
      messages,
      maxTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature,
      json: opts.json,
      timeoutMs: opts.timeoutMs ?? 240_000,
    },
  );
  const text = extractOpenAiText(response);
  if (!text) throw new Error("El modelo no devolvió texto (respuesta vacía).");
  return text;
}

/**
 * Proveedor con el que se hace la búsqueda web.
 * "auto" usa el del modelo si trae búsqueda propia; si no, MiniMax (que
 * ya está autenticado en el sistema); si no hay ninguno, se desactiva.
 */
export async function resolveWebSearchProvider(): Promise<{
  provider: Exclude<AiWebSearchProvider, "auto" | "none"> | null;
  warning?: string;
}> {
  const settings = await resolveAiSettings();
  const configured = settings.webSearchProvider;

  if (configured === "none") return { provider: null };

  if (configured !== "auto") {
    return { provider: configured as Exclude<AiWebSearchProvider, "auto" | "none"> };
  }

  if (settings.provider === "anthropic") return { provider: "anthropic" };
  if (settings.provider === "openrouter") return { provider: "openrouter" };
  if (settings.provider === "minimax") return { provider: "minimax" };

  // Proveedor sin búsqueda propia: se usa MiniMax si está disponible.
  const { getMiniMaxConfig } = await import("../providers/minimax");
  if (getMiniMaxConfig()) return { provider: "minimax" };
  return {
    provider: null,
    warning:
      "El proveedor de IA elegido no tiene búsqueda web y no hay ninguna alternativa configurada. El AI Finder no podrá descubrir prospectos.",
  };
}

export type WebSearchOptions = {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRounds?: number;
};

/**
 * Búsqueda web real con el proveedor de búsqueda activo.
 * Devuelve siempre el mismo formato, sea cual sea el proveedor.
 */
export async function webSearch(
  prompt: string,
  opts: WebSearchOptions = {},
): Promise<{ hits: WebSearchHit[]; text: string; rounds: number }> {
  const settings = await resolveAiSettings();
  const { provider, warning } = await resolveWebSearchProvider();
  if (!provider) {
    throw new Error(warning ?? "No hay ningún motor de búsqueda web configurado.");
  }

  const model = opts.model ?? settings.webSearchModel;

  if (provider === "minimax") {
    const { webSearch: minimaxSearch } = await import("../providers/minimax");
    return minimaxSearch(prompt, {
      model,
      maxTokens: opts.maxTokens ?? 2048,
      timeoutMs: opts.timeoutMs ?? 180_000,
      maxRounds: opts.maxRounds ?? 3,
    });
  }

  if (provider === "anthropic") {
    const response = await callAnthropic(
      {
        baseUrl: settings.baseUrl ?? DEFAULT_BASE_URLS.anthropic,
        apiKey: settings.apiKey,
        authMode: "x-api-key",
      },
      {
        model,
        messages: [{ role: "user", content: prompt }],
        webSearch: true,
        maxTokens: opts.maxTokens ?? 2048,
        timeoutMs: opts.timeoutMs ?? 180_000,
      },
    );
    return {
      hits: extractAnthropicHits(response),
      text: extractAnthropicText(response),
      rounds: 1,
    };
  }

  // OpenRouter: plugin de búsqueda web (siempre activo en la petición).
  const response = await callOpenAi(
    {
      baseUrl: settings.baseUrl ?? DEFAULT_BASE_URLS.openrouter,
      apiKey: settings.apiKey,
      supportsWebPlugin: true,
    },
    {
      model,
      messages: [{ role: "user", content: prompt }],
      webSearch: true,
      maxTokens: opts.maxTokens ?? 2048,
      timeoutMs: opts.timeoutMs ?? 180_000,
    },
  );
  return {
    hits: extractOpenAiHits(response),
    text: extractOpenAiText(response),
    rounds: 1,
  };
}

/** Extrae JSON de una respuesta con texto alrededor o fences. */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Se busca el primer objeto o array balanceado.
  }

  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;

  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Prueba rápida de conexión: pide un JSON mínimo al modelo activo. */
export async function testAiConnection(): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  detail: string;
}> {
  const settings = await resolveAiSettings();
  try {
    const result = await completeJson<{ ok: boolean; pong: string }>(
      'Responde sólo con este JSON: {"ok": true, "pong": "hola"}',
      { maxTokens: 200, temperature: 0, timeoutMs: 60_000 },
    );
    if (!result) {
      return {
        ok: false,
        provider: settings.provider,
        model: settings.model,
        detail: "El modelo respondió pero el JSON no se pudo leer.",
      };
    }
    return {
      ok: true,
      provider: settings.provider,
      model: settings.model,
      detail: "El modelo responde correctamente.",
    };
  } catch (err) {
    return {
      ok: false,
      provider: settings.provider,
      model: settings.model,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Prueba de la búsqueda web con el motor activo. */
export async function testWebSearch(): Promise<{
  ok: boolean;
  provider: string | null;
  hits: number;
  detail: string;
}> {
  const { provider, warning } = await resolveWebSearchProvider();
  if (!provider) {
    return { ok: false, provider: null, hits: 0, detail: warning ?? "Sin motor de búsqueda." };
  }
  try {
    const result = await webSearch("fisioterapia en Madrid", {
      maxTokens: 1200,
      timeoutMs: 120_000,
    });
    return {
      ok: result.hits.length > 0,
      provider,
      hits: result.hits.length,
      detail:
        result.hits.length > 0
          ? `${result.hits.length} resultados de búsqueda.`
          : "La búsqueda no devolvió resultados.",
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      hits: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export { isProviderId };
