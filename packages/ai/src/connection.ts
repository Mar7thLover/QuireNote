import { catalogModels, PROVIDER_CATALOG } from "./catalog";
import { requestJson } from "./http";
import { baseUrlOf, errorMessage, requireKey } from "./sdk";
import { webSearch } from "./search";
import { AiError, type ConnectionResult, type ProviderRuntime, UnsupportedError } from "./types";

function exampleModels(p: ProviderRuntime): string[] {
  return catalogModels(p.kind).map((m) => m.id);
}

function bearer(p: ProviderRuntime): Record<string, string> {
  return p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
}

/** 列出 provider 可用的模型。没有列模型接口的 provider 返回目录中的示例模型。 */
export async function listModels(p: ProviderRuntime): Promise<string[]> {
  switch (p.kind) {
    case "openai":
    case "openai-compatible":
    case "ollama": {
      if (p.kind === "openai") requireKey(p);
      const data = await requestJson<{ data?: { id: string }[] }>(
        p,
        `${baseUrlOf(p)}/models`,
        { headers: bearer(p) },
        15_000,
      );
      return (data.data ?? []).map((m) => m.id).sort();
    }
    case "anthropic":
    case "anthropic-compatible": {
      const key = p.kind === "anthropic" ? requireKey(p) : p.apiKey;
      const data = await requestJson<{ data?: { id: string }[] }>(
        p,
        `${baseUrlOf(p)}/models?limit=100`,
        { headers: { ...(key ? { "x-api-key": key } : {}), "anthropic-version": "2023-06-01" } },
        15_000,
      );
      return (data.data ?? []).map((m) => m.id);
    }
    case "google": {
      const data = await requestJson<{ models?: { name: string }[] }>(
        p,
        `${baseUrlOf(p)}/models?pageSize=200`,
        { headers: { "x-goog-api-key": requireKey(p) } },
        15_000,
      );
      return (data.models ?? []).map((m) => m.name.replace(/^models\//, ""));
    }
    case "elevenlabs": {
      const data = await requestJson<{ model_id: string }[]>(
        p,
        `${baseUrlOf(p)}/v1/models`,
        { headers: { "xi-api-key": requireKey(p) } },
        15_000,
      );
      return data.map((m) => m.model_id);
    }
    case "comfyui": {
      const data = await requestJson<Record<string, { input?: { required?: { ckpt_name?: unknown[] } } }>>(
        p,
        `${baseUrlOf(p)}/object_info/CheckpointLoaderSimple`,
        {},
        15_000,
      );
      const names = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      return Array.isArray(names) ? names.map(String) : [];
    }
    default:
      return exampleModels(p);
  }
}

/** 测试连通性：列模型或发一个最小请求，返回延迟。永不抛出。 */
export async function testConnection(p: ProviderRuntime): Promise<ConnectionResult> {
  const t0 = performance.now();
  const done = (extra: Omit<ConnectionResult, "latencyMs">): ConnectionResult => ({
    ...extra,
    latencyMs: Math.round(performance.now() - t0),
  });
  try {
    switch (p.kind) {
      case "edge-tts":
        throw new UnsupportedError(PROVIDER_CATALOG["edge-tts"].notes);
      case "tavily":
      case "brave":
      case "searxng": {
        await webSearch(
          { provider: p, model: PROVIDER_CATALOG[p.kind].models.search?.[0] ?? "" },
          "quirenote",
          {
            maxResults: 1,
          },
        );
        return done({ ok: true, models: exampleModels(p) });
      }
      case "fal": {
        // fal 没有免费的探测接口：只校验 Key 已配置。
        requireKey(p);
        return done({ ok: true, models: exampleModels(p) });
      }
      case "replicate": {
        await requestJson(
          p,
          `${baseUrlOf(p)}/account`,
          { headers: { authorization: `Bearer ${requireKey(p)}` } },
          15_000,
        );
        return done({ ok: true, models: exampleModels(p) });
      }
      case "comfyui": {
        await requestJson(p, `${baseUrlOf(p)}/system_stats`, {}, 15_000);
        const models = await listModels(p).catch(() => exampleModels(p));
        return done({ ok: true, models });
      }
      default: {
        const models = await listModels(p);
        return done({ ok: true, models });
      }
    }
  } catch (err) {
    return done({ ok: false, error: err instanceof AiError ? err.message : errorMessage(err) });
  }
}
