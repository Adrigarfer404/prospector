/**
 * Prueba de la compatibilidad con APIs tipo OpenAI (OpenAI, Groq, Together,
 * Ollama, LM Studio, OpenRouter…).
 *
 * Levanta un servidor local que imita `POST /v1/chat/completions` y comprueba
 * que la app:
 *   1) extrae el JSON de la respuesta,
 *   2) aplica `response_format: json_object`,
 *   3) envía el plugin de búsqueda web y lee las citas que devuelve.
 *
 *   npx tsx scripts/test-ai-compat.ts
 */

import { createServer } from "node:http";
import { setAiSettingsOverride } from "../src/lib/ai";

const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}/v1`;

let lastRequest: Record<string, unknown> | null = null;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    lastRequest = JSON.parse(body || "{}") as Record<string, unknown>;

    const wantsSearch = Array.isArray(lastRequest?.plugins);
    const wantsJson = Boolean(lastRequest?.response_format);

    const content = wantsJson
      ? '{"ok":true,"pong":"hola"}'
      : "Texto plano de prueba.";

    const message: Record<string, unknown> = { role: "assistant", content };
    if (wantsSearch) {
      message.citations = [
        {
          url: "https://clinica-ejemplo.es",
          title: "Clínica Ejemplo · Madrid",
          content: "Fisioterapia en Madrid. Teléfono 911 22 33 44.",
          type: "web",
        },
        {
          url: "https://centro-ejemplo.es",
          title: "Centro Ejemplo",
          content: "Osteopatía y podología clínica.",
          type: "web",
        },
      ];
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        model: "modelo-de-prueba",
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
});

function check(label: string, condition: boolean, detail = "") {
  console.log(`  ${condition ? "OK  " : "FALLO"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`Servidor de prueba escuchando en ${BASE_URL}\n`);

  setAiSettingsOverride({
    provider: "openai",
    model: "modelo-de-prueba",
    webSearchModel: "modelo-de-prueba",
    webSearchProvider: "openai",
    apiKey: "clave-de-prueba",
    baseUrl: BASE_URL,
  });

  try {
    console.log("1) JSON con response_format");
    const { completeJson } = await import("../src/lib/ai");
    const json = await completeJson<{ ok: boolean; pong: string }>(
      'Responde con {"ok": true, "pong": "hola"}',
      { maxTokens: 200 },
    );
    check("devuelve el JSON parseado", json?.pong === "hola", JSON.stringify(json));
    check(
      "envía response_format json_object",
      (lastRequest?.response_format as { type?: string } | undefined)?.type === "json_object",
    );
    check("usa el modelo configurado", lastRequest?.model === "modelo-de-prueba");

    console.log("\n2) Búsqueda web con plugin");
    const { webSearch } = await import("../src/lib/ai");
    const search = await webSearch("fisioterapia en Madrid", { maxTokens: 500 });
    check("recibe las citas del plugin", search.hits.length === 2, `${search.hits.length} hits`);
    check(
      "la primera cita tiene url, título y texto",
      Boolean(search.hits[0]?.url && search.hits[0]?.title && search.hits[0]?.content),
      search.hits[0]?.url ?? "",
    );
    check("envía el plugin web", Array.isArray(lastRequest?.plugins));
  } finally {
    setAiSettingsOverride(null);
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
