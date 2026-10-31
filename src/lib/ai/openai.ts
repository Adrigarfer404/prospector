/**
 * Cliente compatible con la API de Chat Completions de OpenAI.
 *
 * Sirve para OpenRouter y para cualquier proveedor con el mismo formato
 * (OpenAI, Groq, Together, Ollama, LM Studio, vLLM…).
 *
 * La búsqueda web depende del proveedor: OpenRouter la tiene como plugin
 * (`plugins: [{ id: "web" }]`) y devuelve citas en el mensaje; en el resto de
 * proveedores compatibles no hay búsqueda, así que la app cae al buscador
 * configurado aparte.
 */

import type { ChatMessage, WebSearchHit } from "./types";
import { logRequestEnd, logRequestStart } from "../request-logs";

export type OpenAiClientOptions = {
  baseUrl: string;
  apiKey: string | null;
  /** Nombre de la cabecera que lleva la clave (por defecto Authorization). */
  authHeader?: string;
  /** Plantilla de la cabecera de autenticación. */
  authScheme?: string;
  extraHeaders?: Record<string, string>;
  /** true si el proveedor admite el plugin de búsqueda web. */
  supportsWebPlugin?: boolean;
};

export type OpenAiCallOptions = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Activa el plugin de búsqueda web del proveedor. */
  webSearch?: boolean;
  /** Pide JSON estricto (response_format). */
  json?: boolean;
  timeoutMs?: number;
};

export type OpenAiResponse = {
  id?: string;
  model?: string;
  choices?: {
    message?: {
      role?: string;
      content?: string | ({ text?: string } | string)[] | null;
      citations?: { url?: string; title?: string; content?: string; type?: string }[];
      annotations?: {
        type?: string;
        url?: string;
        title?: string;
        content?: string;
        start_index?: number;
        end_index?: number;
      }[];
    };
    finish_reason?: string;
  }[];
  usage?: Record<string, unknown>;
};

export async function callOpenAi(
  options: OpenAiClientOptions,
  call: OpenAiCallOptions,
): Promise<OpenAiResponse> {
  const body: Record<string, unknown> = {
    model: call.model,
    messages: call.messages,
  };
  if (call.maxTokens !== undefined) body.max_tokens = call.maxTokens;
  if (call.temperature !== undefined) body.temperature = call.temperature;
  if (call.json) body.response_format = { type: "json_object" };
  if (call.webSearch && options.supportsWebPlugin) {
    body.plugins = [{ id: "web", max_results: 10 }];
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.extraHeaders ?? {}),
  };
  if (options.apiKey) {
    const header = options.authHeader ?? "Authorization";
    const scheme = options.authScheme ?? "Bearer";
    headers[header] = `${scheme} ${options.apiKey}`;
  }

  const timeout = call.timeoutMs ?? 180_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const startedAt = logRequestStart("POST", url, `OpenAI · ${call.model}${call.webSearch ? " · web search" : ""}`);
  let status: number | "ERROR" = "ERROR";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API de OpenAI ${res.status}: ${text.slice(0, 400)}`);
    }
    return (await res.json()) as OpenAiResponse;
  } finally {
    clearTimeout(timer);
    logRequestEnd("POST", url, startedAt, status, `OpenAI · ${call.model}`);
  }
}

/** Texto de la primera elección. */
export function extractOpenAiText(response: OpenAiResponse): string {
  const message = response.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : ((part as { text?: string })?.text ?? ""),
      )
      .join("\n")
      .trim();
  }
  return "";
}

/** Citas que devuelve el plugin de búsqueda web. */
export function extractOpenAiHits(response: OpenAiResponse): WebSearchHit[] {
  const message = response.choices?.[0]?.message;
  const hits = new Map<string, WebSearchHit>();

  for (const citation of message?.citations ?? []) {
    const url = typeof citation?.url === "string" ? citation.url : undefined;
    if (!url) continue;
    hits.set(url, {
      url,
      title: citation.title,
      content: citation.content,
    });
  }

  for (const annotation of message?.annotations ?? []) {
    if (annotation?.type && annotation.type !== "url_citation") continue;
    const url = typeof annotation?.url === "string" ? annotation.url : undefined;
    if (!url) continue;
    const existing = hits.get(url) ?? { url };
    existing.title = existing.title ?? annotation.title;
    existing.content = existing.content ?? annotation.content;
    hits.set(url, existing);
  }

  return [...hits.values()];
}
