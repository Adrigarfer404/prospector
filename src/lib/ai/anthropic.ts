/**
 * Cliente compatible con la API de Messages de Anthropic.
 *
 * Lo usan dos proveedores:
 *  - Anthropic (api.anthropic.com): autenticación con `x-api-key`.
 *  - El proxy de MiniMax (agent.minimax.io): autenticación con `Authorization:
 *    Bearer` y el token de sesión del runtime local.
 *
 * Los dos comparten el mismo formato de petición y de respuesta, incluida la
 * herramienta de búsqueda web del servidor (`web_search_20250305`), que
 * Anthropic define y el proxy de MiniMax replica.
 */

import type { ChatMessage, WebSearchHit } from "./types";

export type AnthropicAuthMode = "x-api-key" | "bearer";

export type AnthropicClientOptions = {
  baseUrl: string;
  apiKey: string | null;
  authMode: AnthropicAuthMode;
  /** Cabeceras extra (por ejemplo `anthropic-beta`). */
  extraHeaders?: Record<string, string>;
};

export type AnthropicBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  citations?: AnthropicCitation[];
  cited_text?: string;
  url?: string;
  title?: string;
  page_age?: string;
  encrypted_content?: string;
};

export type AnthropicCitation = {
  type?: string;
  url?: string;
  title?: string;
  cited_text?: string;
  encrypted_index?: number;
};

export type AnthropicResponse = {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: AnthropicBlock[];
  usage?: Record<string, unknown>;
};

export type AnthropicCallOptions = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Declara la herramienta de búsqueda web del servidor. */
  webSearch?: boolean;
  timeoutMs?: number;
};

export async function callAnthropic(
  options: AnthropicClientOptions,
  call: AnthropicCallOptions,
): Promise<AnthropicResponse> {
  const system = call.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages = call.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));

  const body: Record<string, unknown> = {
    model: call.model,
    max_tokens: call.maxTokens ?? 2048,
    messages,
  };
  if (system.trim()) body.system = system;
  if (call.temperature !== undefined) body.temperature = call.temperature;
  if (call.webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }];
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(options.extraHeaders ?? {}),
  };
  if (options.apiKey) {
    if (options.authMode === "x-api-key") headers["x-api-key"] = options.apiKey;
    else headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const timeout = call.timeoutMs ?? 180_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
    }
    return (await res.json()) as AnthropicResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Texto plano de la respuesta (bloques `text`). */
export function extractAnthropicText(response: AnthropicResponse): string {
  return (response.content ?? [])
    .filter((block): block is AnthropicBlock & { type: "text"; text: string } =>
      Boolean(block && block.type === "text" && typeof block.text === "string"),
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Resultados de la búsqueda web.
 *
 * Anthropic devuelve los resultados en dos sitios: el bloque
 * `web_search_tool_result` (url, título, fecha) y las citas del texto
 * (`cited_text`, que es el fragmento de texto consultado). Se combinan para
 * tener el mismo formato que devuelve el proxy de MiniMax.
 */
export function extractAnthropicHits(response: AnthropicResponse): WebSearchHit[] {
  const hits = new Map<string, WebSearchHit>();

  for (const block of response.content ?? []) {
    if (block?.type !== "web_search_tool_result") continue;
    const items = Array.isArray(block.content) ? (block.content as AnthropicBlock[]) : [];
    for (const item of items) {
      const url = typeof item?.url === "string" ? item.url : undefined;
      if (!url) continue;
      hits.set(url, {
        title: typeof item.title === "string" ? item.title : undefined,
        url,
        page_age: typeof item.page_age === "string" ? item.page_age : undefined,
      });
    }
  }

  // Las citas llevan el fragmento de texto: sin esto el modelo no ve el
  // contenido de la página, sólo la URL.
  for (const block of response.content ?? []) {
    const citations = block?.citations;
    if (!Array.isArray(citations)) continue;
    for (const citation of citations) {
      const url = typeof citation?.url === "string" ? citation.url : undefined;
      if (!url) continue;
      const existing = hits.get(url) ?? { url };
      existing.title = existing.title ?? citation.title;
      existing.content = existing.content ?? citation.cited_text;
      hits.set(url, existing);
    }
  }

  return [...hits.values()];
}
