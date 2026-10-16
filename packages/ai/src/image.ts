import { experimental_generateVideo, generateImage } from "ai";
import { request, requestBytes, requestJson } from "./http";
import { baseUrlOf, errorMessage, imageModel, requireKey, videoModel } from "./sdk";
import { AiError, type BinaryResult, type ModelRef, type ProviderRuntime, UnsupportedError } from "./types";

export interface MediaOptions {
  /** 轮询间隔（毫秒），测试时可设为 0。 */
  pollMs?: number;
  /** 最长等待（毫秒）。 */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function download(p: ProviderRuntime, url: string): Promise<BinaryResult> {
  return requestBytes(p, url, {}, 120_000);
}

async function falRun(ref: ModelRef, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = ref.provider;
  return requestJson<Record<string, unknown>>(
    p,
    `${baseUrlOf(p)}/${ref.model.replace(/^\/+/, "")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${requireKey(p)}` },
      body: JSON.stringify(input),
    },
    300_000,
  );
}

interface ReplicatePrediction {
  id?: string;
  status: string;
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
}

async function replicateRun(
  ref: ModelRef,
  input: Record<string, unknown>,
  opts: MediaOptions,
): Promise<string> {
  const p = ref.provider;
  const auth = { authorization: `Bearer ${requireKey(p)}` };
  let pred = await requestJson<ReplicatePrediction>(
    p,
    `${baseUrlOf(p)}/models/${ref.model}/predictions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "wait", ...auth },
      body: JSON.stringify({ input }),
    },
    120_000,
  );
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  while (pred.status !== "succeeded") {
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new AiError(`Replicate 生成失败：${pred.error ?? pred.status}`);
    }
    if (!pred.urls?.get || Date.now() > deadline) throw new AiError("Replicate 生成超时");
    await sleep(opts.pollMs ?? 1500);
    pred = await requestJson<ReplicatePrediction>(p, pred.urls.get, { headers: auth });
  }
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof out !== "string") throw new AiError("Replicate 返回中没有输出文件地址");
  return out;
}

/** ComfyUI 最小文生图工作流（CheckpointLoaderSimple → KSampler → SaveImage）。 */
export function comfyWorkflow(checkpoint: string, prompt: string, seed: number): Record<string, unknown> {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 20,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 576, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark, blurry", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "quirenote", images: ["8", 0] } },
  };
}

async function comfyRun(ref: ModelRef, prompt: string, opts: MediaOptions): Promise<BinaryResult> {
  const p = ref.provider;
  const base = baseUrlOf(p);
  const seed = Math.floor(Math.random() * 2 ** 31);
  const queued = await requestJson<{ prompt_id: string }>(p, `${base}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: comfyWorkflow(ref.model, prompt, seed), client_id: "quirenote" }),
  });
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  for (;;) {
    const hist = await requestJson<
      Record<
        string,
        { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }
      >
    >(p, `${base}/history/${queued.prompt_id}`);
    const entry = hist[queued.prompt_id];
    const img = entry?.outputs && Object.values(entry.outputs).find((o) => o.images?.length)?.images?.[0];
    if (img) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
      return download(p, `${base}/view?${q}`);
    }
    if (Date.now() > deadline) throw new AiError("ComfyUI 生成超时");
    await sleep(opts.pollMs ?? 1000);
  }
}

/** 文生图，返回一张图片。 */
export async function generateImageFile(
  ref: ModelRef,
  prompt: string,
  opts: MediaOptions = {},
): Promise<BinaryResult> {
  const p = ref.provider;
  switch (p.kind) {
    case "openai":
    case "google":
    case "openai-compatible": {
      try {
        const res = await generateImage({
          model: imageModel(p, ref.model),
          prompt,
          ...(p.kind === "google" ? { aspectRatio: "16:9" as const } : { size: "1536x1024" as const }),
          maxRetries: 1,
        });
        return { data: res.image.uint8Array, mediaType: res.image.mediaType };
      } catch (err) {
        throw new AiError(`图像生成失败：${errorMessage(err)}`);
      }
    }
    case "fal": {
      const out = await falRun(ref, { prompt, image_size: "landscape_16_9", num_images: 1 });
      const url = (out.images as { url?: string }[] | undefined)?.[0]?.url;
      if (!url) throw new AiError("fal 返回中没有图片地址");
      return download(p, url);
    }
    case "replicate":
      return download(p, await replicateRun(ref, { prompt, aspect_ratio: "16:9" }, opts));
    case "comfyui":
      return comfyRun(ref, prompt, opts);
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不支持图像生成`);
  }
}

/** 文生视频（Veo / fal / Replicate）。 */
export async function generateVideoFile(
  ref: ModelRef,
  prompt: string,
  opts: MediaOptions = {},
): Promise<BinaryResult> {
  const p = ref.provider;
  switch (p.kind) {
    case "google": {
      try {
        const res = await experimental_generateVideo({
          model: videoModel(p, ref.model),
          prompt,
          maxRetries: 1,
        });
        return { data: res.video.uint8Array, mediaType: res.video.mediaType };
      } catch (err) {
        throw new AiError(`视频生成失败：${errorMessage(err)}`);
      }
    }
    case "fal": {
      const out = await falRun(ref, { prompt });
      const url = (out.video as { url?: string } | undefined)?.url;
      if (!url) throw new AiError("fal 返回中没有视频地址");
      return download(p, url);
    }
    case "replicate":
      return download(p, await replicateRun(ref, { prompt }, opts));
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不支持视频生成`);
  }
}

/** 保留给连通性测试：探测 URL 是否可达。 */
export async function ping(
  p: ProviderRuntime,
  url: string,
  headers: Record<string, string> = {},
): Promise<void> {
  await request(p, url, { headers }, 15_000);
}
