/**
 * Cliente directo a la API de MiniMax (compatible con Anthropic Messages).
 *
 * Dos usos:
 *  1) Generar texto (mensajes, resúmenes, scoring).
 *  2) Usar el server-side tool `web_search` para DESCUBRIR prospectos reales en
 *     la web. Es lo que convierte el AI Finder en algo que de verdad encuentra
 *     negocios contactables en lugar de datos inventados.
 *
 * La autenticación usa el token de sesión del runtime local, que es lo que
 * acepta el proxy configurado en ~/.minimax/config.yaml.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logRequestEnd, logRequestStart } from "../request-logs";

export type MiniMaxMessage = {
  role: "system" | "user" | "assistant";
  content: string | MiniMaxContentBlock[];
};

export type MiniMaxContentBlock =
  | { type: "text"; text: string }
  | { type: "server_tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "web_search_tool_result"; content: WebSearchHit[] }
  | { type: "thinking"; thinking: string };

export type WebSearchHit = {
  title?: string;
  url?: string;
  content?: string;
  page_age?: string;
};

export type MiniMaxConfig = {
  baseURL: string;
  accessToken: string;
  apiKey?: string;
  models: string[];
};

/**
 * M3 no emite bloques de razonamiento en la API Anthropic, así que devuelve
 * JSON limpio y no gasta el presupuesto de tokens pensando. Flash es más
 * rápido y barato para la búsqueda web.
 */
export const MODEL_FAST = "MiniMax-M3.1-Flash";
export const MODEL_STRUCTURED = "MiniMax-M3";

let cachedConfig: MiniMaxConfig | null | undefined;

function readYamlValue(file: string, key: string): string | undefined {
  try {
    const raw = readFileSync(file, "utf8");
    const match = raw.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)`, "m"));
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

export function getMiniMaxConfig(): MiniMaxConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  cachedConfig = null;

  const dataDir = process.env.MINIMAX_DATA_DIR ?? join(homedir(), ".minimax");
  try {
    const auth = JSON.parse(readFileSync(join(dataDir, "local-runtime.auth.json"), "utf8")) as {
      auth?: { accessToken?: string };
    };
    const accessToken = auth.auth?.accessToken;
    if (!accessToken) return null;

    const baseURL =
      readYamlValue(join(dataDir, "config.yaml"), "baseURL") ??
      "https://agent.minimax.io/mavis/api/v1/llm/v1";
    const apiKey = readYamlValue(join(dataDir, "config.yaml"), "apiKey");

    cachedConfig = {
      baseURL: baseURL.replace(/\/+$/, ""),
      accessToken,
      apiKey,
      models: ["MiniMax-M3.1-Flash", "MiniMax-M3"],
    };
  } catch {
    cachedConfig = null;
  }
  return cachedConfig;
}

export type MiniMaxResponse = {
  id?: string;
  model?: string;
  stop_reason?: string;
  content: MiniMaxContentBlock[];
  usage?: Record<string, unknown>;
};

export type MiniMaxCallOptions = {
  model?: string;
  messages: MiniMaxMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Declara el server-side tool de búsqueda web. */
  webSearch?: boolean;
  timeoutMs?: number;
};

export async function callMiniMax(opts: MiniMaxCallOptions): Promise<MiniMaxResponse> {
  const config = getMiniMaxConfig();
  if (!config) {
    throw new Error(
      "No se ha encontrado la configuración de MiniMax (~/.minimax/config.yaml + local-runtime.auth.json)",
    );
  }

  const model = opts.model ?? config.models[0];
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: opts.messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const timeout = opts.timeoutMs ?? 180_000;
  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const url = `${config.baseURL}/messages`;
    const startedAt = logRequestStart("POST", url, `MiniMax · ${model} · intento ${attempt + 1}/${maxAttempts}${opts.webSearch ? " · web search" : ""}`);
    let status: number | "ERROR" = "ERROR";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          Authorization: `Bearer ${config.accessToken}`,
          ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const error = new Error(`MiniMax ${res.status}: ${text.slice(0, 400)}`);
        // 4xx no se reintenta; 5xx y rate limits sí.
        if (res.status < 500 && res.status !== 429) throw error;
        lastError = error;
      } else {
        return (await res.json()) as MiniMaxResponse;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof Error && err.message.includes("MiniMax 4")) throw lastError;
    } finally {
      clearTimeout(timer);
      logRequestEnd("POST", url, startedAt, status, `MiniMax · ${model}`);
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
    }
  }

  throw lastError ?? new Error("MiniMax: fallo desconocido");
}

export function extractText(response: MiniMaxResponse): string {
  return (response.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function extractWebResults(response: MiniMaxResponse): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const blocks = Array.isArray(response.content) ? response.content : [];

  for (const block of blocks) {
    if (!block || block.type !== "web_search_tool_result") continue;

    // El proveedor devuelve el contenido del tool_result como array, como
    // string JSON o como objeto con `results`, según el turno. Se normaliza.
    const raw = (block as { content?: unknown }).content;
    let items: unknown[] = [];

    if (Array.isArray(raw)) {
      items = raw;
    } else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) items = parsed;
        else if (parsed && typeof parsed === "object") {
          const nested = (parsed as { results?: unknown; content?: unknown }).results ??
            (parsed as { content?: unknown }).content;
          if (Array.isArray(nested)) items = nested;
        }
      } catch {
        items = [];
      }
    } else if (raw && typeof raw === "object") {
      const nested = (raw as { results?: unknown; content?: unknown }).results ??
        (raw as { content?: unknown }).content;
      if (Array.isArray(nested)) items = nested;
      else items = [raw];
    }

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url : undefined;
      if (!url) continue;
      hits.push({
        title: typeof record.title === "string" ? record.title : undefined,
        url,
        content:
          typeof record.content === "string"
            ? record.content
            : typeof record.text === "string"
              ? record.text
              : undefined,
        page_age: typeof record.page_age === "string" ? record.page_age : undefined,
      });
    }
  }

  return hits;
}

/**
 * Ejecuta una búsqueda web real vía MiniMax y devuelve los resultados.
 * Si el modelo agota el límite de búsquedas por turno, reanuda la llamada
 * con el contenido anterior (stop_reason "pause_turn").
 */
export async function webSearch(
  prompt: string,
  opts?: { model?: string; maxRounds?: number; timeoutMs?: number; maxTokens?: number },
): Promise<{ hits: WebSearchHit[]; text: string; rounds: number }> {
  const hits: WebSearchHit[] = [];
  const seen = new Set<string>();
  let text = "";
  const messages: MiniMaxMessage[] = [{ role: "user", content: prompt }];
  const maxRounds = opts?.maxRounds ?? 3;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await callMiniMax({
      model: opts?.model,
      messages,
      webSearch: true,
      maxTokens: opts?.maxTokens ?? 2048,
      timeoutMs: opts?.timeoutMs ?? 180_000,
    });

    for (const hit of extractWebResults(response)) {
      const key = (hit.url ?? hit.title ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
    text = extractText(response) || text;

    // El server-side tool no admite reanudar el turno: el proxy exige que cada
    // tool_result siga a su server_tool_use y rechaza el formato. Nos quedamos
    // con lo ya-recuperado en esta llamada.
    break;
  }

  return { hits, text, rounds: maxRounds };
}

/**
 * Pide JSON al modelo y lo parsea de forma tolerante (fences, texto extra).
 */
export async function completeJson<T>(
  prompt: string,
  opts?: { system?: string; model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<T | null> {
  const messages: MiniMaxMessage[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const response = await callMiniMax({
    model: opts?.model ?? MODEL_STRUCTURED,
    messages,
    maxTokens: opts?.maxTokens ?? 8000,
    temperature: opts?.temperature ?? 0.1,
    timeoutMs: opts?.timeoutMs ?? 240_000,
  });

  const raw = extractText(response);
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
