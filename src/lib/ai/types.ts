/**
 * Tipos del módulo de IA. El proveedor es intercambiable: la app no sabe
 * nada del proveedor activo, sólo pide "completa esto" o "busca esto".
 */

export type AiProviderId = "minimax" | "anthropic" | "openrouter" | "openai";

/** De dónde sale la búsqueda web. "auto" usa el del proveedor si puede. */
export type AiWebSearchProvider =
  | "auto"
  | "minimax"
  | "anthropic"
  | "openrouter"
  | "openai"
  | "none";

export type AiSettings = {
  provider: AiProviderId;
  model: string;
  webSearchModel: string;
  webSearchProvider: AiWebSearchProvider;
  apiKey: string | null;
  baseUrl: string | null;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type WebSearchHit = {
  title?: string;
  url?: string;
  content?: string;
  page_age?: string;
};

export type AiProviderInfo = {
  id: AiProviderId;
  label: string;
  /** Modelos de ejemplo que funcionan con ese proveedor. */
  suggestedModels: string[];
  /** Si el proveedor trae búsqueda web propia. */
  nativeWebSearch: boolean;
  /** Dónde se consigue la credencial. */
  docs: string;
  /** Si funciona con una clave de API normal. */
  needsApiKey: boolean;
};

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: "minimax",
    label: "MiniMax (el que ya tienes)",
    suggestedModels: ["MiniMax-M3", "MiniMax-M3.1-Flash"],
    nativeWebSearch: true,
    docs: "Usa la sesión del runtime local: no hace falta clave.",
    needsApiKey: false,
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    suggestedModels: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    nativeWebSearch: true,
    docs: "console.anthropic.com → API Keys. Ojo: la suscripción Pro/Max NO incluye API.",
    needsApiKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter (una clave, muchos modelos)",
    suggestedModels: [
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4.1",
      "google/gemini-2.5-flash",
      "z-ai/glm-4.6",
    ],
    nativeWebSearch: true,
    docs: "openrouter.ai/keys → Create API key.",
    needsApiKey: true,
  },
  {
    id: "openai",
    label: "Cualquiera compatible con OpenAI (OpenAI, Groq, Together, Ollama…)",
    suggestedModels: ["gpt-4.1-mini", "llama-3.3-70b-versatile"],
    nativeWebSearch: false,
    docs: "Endpoint /chat/completions con Authorization: Bearer <clave>.",
    needsApiKey: true,
  },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "minimax",
  model: "MiniMax-M3",
  webSearchModel: "MiniMax-M3.1-Flash",
  webSearchProvider: "auto",
  apiKey: null,
  baseUrl: null,
};

/** Base por defecto de cada proveedor (sustituible desde Ajustes). */
export const DEFAULT_BASE_URLS: Record<AiProviderId, string> = {
  minimax: "https://agent.minimax.io/mavis/api/v1/llm/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};
