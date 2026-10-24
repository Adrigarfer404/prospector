import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, serverError } from "@/lib/api";
import { getWorkspace } from "@/lib/workspace";
import {
  AI_PROVIDERS,
  DEFAULT_AI_SETTINGS,
  invalidateAiSettings,
  resolveAiSettings,
  setAiSettingsOverride,
  testAiConnection,
  testWebSearch,
} from "@/lib/ai";
import { DEFAULT_BASE_URLS, type AiProviderId, type AiWebSearchProvider } from "@/lib/ai/types";

export const runtime = "nodejs";

const SettingsSchema = z.object({
  provider: z.enum(["minimax", "anthropic", "openrouter", "openai"]),
  model: z.string().min(1).optional(),
  webSearchModel: z.string().min(1).optional(),
  webSearchProvider: z.enum(["auto", "minimax", "anthropic", "openrouter", "none"]),
  /** Si viene vacío se conserva la clave que ya había. */
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  test: z.boolean().optional(),
  testSearch: z.boolean().optional(),
});

export async function GET() {
  try {
    const settings = await resolveAiSettings();
    return ok({
      settings: {
        provider: settings.provider,
        model: settings.model,
        webSearchModel: settings.webSearchModel,
        webSearchProvider: settings.webSearchProvider,
        baseUrl: settings.baseUrl ?? "",
        // La clave nunca se devuelve: sólo si está puesta.
        hasApiKey: Boolean(settings.apiKey),
      },
      providers: AI_PROVIDERS,
      defaults: DEFAULT_AI_SETTINGS,
      defaultBaseUrls: DEFAULT_BASE_URLS,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace();
    const parsed = SettingsSchema.safeParse(await request.json());
    if (!parsed.success) return ok({ error: "Datos inválidos" }, { status: 400 });
    const data = parsed.data;

    // Pruebas con lo que se ha escrito, sin guardar nada: los ajustes se
    // aplican de forma temporal y se descartan al terminar.
    if (data.test || data.testSearch) {
      const previous = await resolveAiSettings();
      const candidate = {
        provider: data.provider as AiProviderId,
        model: data.model?.trim() || previous.model,
        webSearchModel: data.webSearchModel?.trim() || previous.webSearchModel,
        webSearchProvider: data.webSearchProvider as AiWebSearchProvider,
        apiKey: data.apiKey?.trim() ? data.apiKey.trim() : previous.apiKey,
        baseUrl: data.baseUrl?.trim() || previous.baseUrl,
      };

      setAiSettingsOverride(candidate);
      try {
        if (data.testSearch) {
          return ok({ search: await testWebSearch() });
        }
        return ok({ test: await testAiConnection() });
      } finally {
        setAiSettingsOverride(null);
      }
    }

    const existing = await prisma.aiSetting.findUnique({
      where: { workspaceId: workspace.id },
    });

    const apiKey = data.apiKey?.trim()
      ? data.apiKey.trim()
      : existing?.apiKey ?? null;

    const baseUrl = data.baseUrl?.trim() ? data.baseUrl.trim() : existing?.baseUrl ?? null;

    const row = await prisma.aiSetting.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        provider: data.provider,
        model: data.model?.trim() || DEFAULT_AI_SETTINGS.model,
        webSearchModel: data.webSearchModel?.trim() || DEFAULT_AI_SETTINGS.webSearchModel,
        webSearchProvider: data.webSearchProvider,
        apiKey,
        baseUrl,
      },
      update: {
        provider: data.provider,
        model: data.model?.trim() || existing?.model || DEFAULT_AI_SETTINGS.model,
        webSearchModel:
          data.webSearchModel?.trim() || existing?.webSearchModel || DEFAULT_AI_SETTINGS.webSearchModel,
        webSearchProvider: data.webSearchProvider,
        apiKey,
        baseUrl,
      },
    });
    invalidateAiSettings();

    return ok({
      saved: true,
      settings: {
        provider: row.provider,
        model: row.model,
        webSearchModel: row.webSearchModel,
        webSearchProvider: row.webSearchProvider,
        baseUrl: row.baseUrl ?? "",
        hasApiKey: Boolean(row.apiKey),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
