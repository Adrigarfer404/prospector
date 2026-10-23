/**
 * Bridge al LLM ya configurado en el sistema.
 *
 * Delega en el script Python `llm_call.py` (skill `llm-call`) mediante
 * `child_process.execFile`, de forma que se usan exactamente los modelos y las
 * credenciales que el sistema ya tiene.
 *
 * Nota sobre credenciales: el `config.yaml` del data dir puede tener una key
 * de relleno (`sk-xxx`). En ese caso se usa el token real del runtime local
 * (`local-runtime.auth.json`) generando una config temporal (0600) que se
 * borra al terminar el proceso.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmClient, LlmMessage } from "./contract";

const LLM_SCRIPT = "/Users/mj/.minimax/.builtin-skills/llm-call/scripts/llm_call.py";

export const DEFAULT_MODEL = "minimax/MiniMax-M3.1-Flash";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TIMEOUT_S = 120;

const DEFAULT_BASE_URL = "https://agent.minimax.io/mavis/api/v1/llm/v1";
const DEFAULT_NPM = "@ai-sdk/anthropic";
const FALLBACK_MODELS = ["MiniMax-M3", "MiniMax-M3.1-Flash"];

export type LlmOptions = {
  maxTokens?: number;
  temperature?: number;
  /** Modelo alternativo (p.ej. "minimax/MiniMax-M3"). */
  model?: string;
  /** Timeout en segundos. */
  timeout?: number;
};

export class LlmError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr = "") {
    super(message);
    this.name = "LlmError";
    this.stderr = stderr;
  }
}

/** Convierte los mensajes del contrato en los argumentos del script. */
function splitMessages(messages: LlmMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const prompt = messages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n\n");
  return { system, prompt };
}

/** Data dir activo del runtime. */
function dataDir(): string {
  const configured = process.env.MINIMAX_DATA_DIR?.trim();
  if (configured && existsSync(configured)) return configured;
  return join(homedir(), ".minimax");
}

function extractScalar(text: string, key: string): string | null {
  const match = text.match(new RegExp(`${key}:\\s*["']?([^"'\\n]+)["']?`));
  return match?.[1]?.trim() ?? null;
}

/** Extrae los ids de modelo del bloque `models:` de la config. */
function extractModelIds(text: string): string[] {
  const marker = text.indexOf("models:");
  if (marker === -1) return [];
  const lines = text.slice(marker).split("\n").slice(1);
  const ids: string[] = [];
  let baseIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (baseIndent === null) {
      if (indent === 0) break;
      baseIndent = indent;
    }
    if (indent < baseIndent) break;
    if (indent !== baseIndent) continue;
    const key = line.trim().match(/^([A-Za-z][\w.-]*):/);
    if (key?.[1]) ids.push(key[1]);
  }
  return ids;
}

/** ¿La key parece un placeholder (`sk-xxx`) en vez de una credencial real? */
function isPlaceholderKey(key: string | null): boolean {
  if (!key) return true;
  const value = key.trim().toLowerCase();
  if (value.length < 12) return true;
  if (value.startsWith("sk-xxx")) return true;
  if (value.includes("placeholder") || value.includes("changeme")) return true;
  return false;
}

/** Token real del runtime local. */
function readRuntimeToken(dir: string): string | null {
  const authPath = join(dir, "local-runtime.auth.json");
  try {
    if (!existsSync(authPath)) return null;
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as {
      auth?: { accessToken?: string };
    };
    const token = parsed.auth?.accessToken?.trim();
    return token && token.length > 20 ? token : null;
  } catch {
    return null;
  }
}

/** Escapa un valor para YAML de una línea. */
function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

export type ScriptConfig = {
  path: string;
  /** true si es una config temporal generada por nosotros. */
  temporary: boolean;
};

let cachedConfig: ScriptConfig | null = null;
let tempDir: string | null = null;

/**
 * Devuelve la config que debe usar el script.
 * Si la config del sistema tiene una key real, se usa tal cual; si no, se
 * genera una config temporal con el token del runtime local.
 */
export function resolveScriptConfig(): ScriptConfig {
  if (cachedConfig) return cachedConfig;

  const dir = dataDir();
  const systemConfigPath = join(dir, "config.yaml");
  const systemConfigText = existsSync(systemConfigPath)
    ? readFileSync(systemConfigPath, "utf8")
    : null;

  const apiKey = systemConfigText ? extractScalar(systemConfigText, "apiKey") : null;

  if (systemConfigText && !isPlaceholderKey(apiKey)) {
    cachedConfig = { path: systemConfigPath, temporary: false };
    return cachedConfig;
  }

  const token = readRuntimeToken(dir);
  if (!token) {
    throw new LlmError(
      "No hay credenciales de LLM utilizables: config.yaml no define una apiKey válida y no hay token en local-runtime.auth.json.",
    );
  }

  const baseUrl = systemConfigText
    ? (extractScalar(systemConfigText, "baseURL") ?? DEFAULT_BASE_URL)
    : DEFAULT_BASE_URL;
  const npm = systemConfigText
    ? (extractScalar(systemConfigText, "npm") ?? DEFAULT_NPM)
    : DEFAULT_NPM;
  const modelIds = (systemConfigText ? extractModelIds(systemConfigText) : []).filter((id) =>
    FALLBACK_MODELS.includes(id),
  );
  const models = modelIds.length > 0 ? modelIds : FALLBACK_MODELS;

  tempDir = join(tmpdir(), `enginy-llm-${process.pid}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });

  const modelBlock = models
    .map((id) => `      ${id}:\n        name: ${yamlQuote(id)}`)
    .join("\n");

  const yaml = [
    "defaultModel: minimax/MiniMax-M3.1-Flash",
    "provider:",
    "  minimax:",
    "    name: MiniMax",
    `    npm: ${yamlQuote(npm)}`,
    "    options:",
    `      apiKey: ${yamlQuote(token)}`,
    `      baseURL: ${yamlQuote(baseUrl)}`,
    "      headers:",
    `        Authorization: ${yamlQuote(`Bearer ${token}`)}`,
    "    models:",
    modelBlock,
    "",
  ].join("\n");

  const configPath = join(tempDir, "config.yaml");
  writeFileSync(configPath, yaml, { mode: 0o600 });

  process.once("exit", () => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  cachedConfig = { path: configPath, temporary: true };
  return cachedConfig;
}

/**
 * Cliente LLM respaldado por el script Python del sistema.
 */
export class SystemLlmClient implements LlmClient {
  readonly name = "system-llm";

  async complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<string> {
    if (messages.length === 0) throw new LlmError("No hay mensajes para completar.");

    const { system, prompt } = splitMessages(messages);
    const model = opts.model ?? DEFAULT_MODEL;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT_S;

    const config = resolveScriptConfig();

    const run = async (maxTokens: number, temperature: number): Promise<string> => {
      const args = [
        LLM_SCRIPT,
        "--config",
        config.path,
        "--model",
        model,
        "--prompt",
        prompt,
        "--max-tokens",
        String(maxTokens),
        "--temperature",
        String(temperature),
        "--timeout",
        String(timeout),
      ];
      if (system.trim().length > 0) args.push("--system", system);

      const { stdout, stderr } = await runPython(args, timeout);
      const output = stdout.trim();
      if (!output) {
        throw new LlmError(`El LLM (${model}) devolvió una respuesta vacía.`, stderr.trim());
      }
      return output;
    };

    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;

    try {
      return await run(maxTokens, temperature);
    } catch (error) {
      // Los modelos con "thinking" forzado consumen tokens antes de emitir
      // texto: si no queda texto, se reintenta con más presupuesto.
      if (error instanceof LlmError && error.message.includes("respuesta vacía")) {
        const retryTokens = Math.max(maxTokens * 4, 2048);
        return run(retryTokens, temperature);
      }
      throw error;
    }
  }
}

/** Ejecuta el script Python y captura stdout/stderr. */
function runPython(
  args: string[],
  timeoutSeconds: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      args,
      { timeout: (timeoutSeconds + 15) * 1000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const details = stderr.trim() || error.message;
          reject(new LlmError(`Fallo al llamar al LLM: ${details}`, stderr));
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

export const llmClient: LlmClient = new SystemLlmClient();

/**
 * Pide JSON puro al LLM y lo parsea de forma tolerante:
 * limpia fences ```json, busca el primer objeto balanceado.
 */
export async function completeJson<T = unknown>(
  messages: LlmMessage[],
  schemaHint?: string,
  opts: LlmOptions = {},
): Promise<T> {
  const hint = schemaHint
    ? `\n\nResponde EXCLUSIVAMENTE con un JSON válido que cumpla este esquema:\n${schemaHint}`
    : "\n\nResponde EXCLUSIVAMENTE con un JSON válido (sin markdown, sin ```json, sin texto adicional).";

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (!last) throw new LlmError("No hay mensajes para completar.");

  const withHint: LlmMessage[] = [
    ...messages.slice(0, lastIndex),
    { ...last, content: `${last.content}${hint}` },
  ];

  const raw = await llmClient.complete(withHint, opts);
  const parsed = parseJsonLoose<T>(raw);
  if (parsed === null) {
    throw new LlmError(`El LLM no devolvió JSON parseable. Respuesta: ${raw.slice(0, 400)}`);
  }
  return parsed;
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
    // Sigue buscando el primer objeto/array balanceado.
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

/** Lista los modelos disponibles en el LLM del sistema. */
export async function listModels(): Promise<string[]> {
  const config = resolveScriptConfig();
  const { stdout } = await runPython([LLM_SCRIPT, "--config", config.path, "--list"], 30);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
