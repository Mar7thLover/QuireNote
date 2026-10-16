/** Studio 生成物：生成（后台任务）、再加工、媒体合成（TTS / 图像 / 视频）。 */
import {
  type BinaryResult,
  defaultVoices,
  generateArtifactData,
  generateImageFile,
  refineArtifactData,
  synthesizeSpeech,
  topicOf,
} from "@quirenote/ai";
import {
  ARTIFACT_KIND_META,
  type Artifact,
  type ArtifactData,
  type ArtifactKind,
  newId,
  nowIso,
} from "@quirenote/core";
import type { AppContext } from "../context";
import { ApiError, badRequest, notFound } from "../errors";
import { extFromMime } from "../files";
import { concatAudio, detectFfmpeg, renderSlidesVideo } from "./media";
import { activeSources, gatherPassages } from "./passages";

export const MEDIA_DIR = "media";

export function mediaUrl(name: string): string {
  return `/api/files/${encodeURIComponent(name)}`;
}

export async function saveMedia(ctx: AppContext, baseName: string, media: BinaryResult): Promise<string> {
  const name = `${baseName}.${extFromMime(media.mediaType)}`;
  await ctx.files.put(`${MEDIA_DIR}/${name}`, media.data);
  return mediaUrl(name);
}

async function emitArtifact(ctx: AppContext, id: string): Promise<Artifact | null> {
  const a = await ctx.store.artifacts.get(id);
  if (a) ctx.events.emit("artifact", a);
  return a;
}

export interface CreateArtifactInput {
  kind: ArtifactKind;
  sourceIds?: string[];
  instructions?: string;
  title?: string;
}

export async function createArtifact(
  ctx: AppContext,
  notebookId: string,
  input: CreateArtifactInput,
): Promise<Artifact> {
  const sources = await activeSources(ctx, notebookId, input.sourceIds);
  if (!sources.length && input.kind !== "image") {
    throw badRequest("没有可用的资料：请先导入并勾选资料（且等待解析完成）");
  }
  const ts = nowIso();
  const meta = ARTIFACT_KIND_META[input.kind];
  const art: Artifact = {
    id: newId("art"),
    ownerId: ctx.store.ownerId,
    notebookId,
    kind: input.kind,
    title: input.title?.trim() || meta.label,
    status: "generating",
    error: null,
    sourceIds: sources.map((s) => s.id),
    data: null,
    props: input.instructions?.trim() ? { instructions: input.instructions.trim() } : {},
    createdAt: ts,
    updatedAt: ts,
  };
  await ctx.store.artifacts.insert(art);
  ctx.events.emit("artifact", art);
  await ctx.jobs.enqueue(
    "artifact",
    { artifactId: art.id, instructions: input.instructions ?? "", autoTitle: !input.title?.trim() },
    { notebookId, refId: art.id, message: `生成${meta.label}` },
  );
  return art;
}

/** 任务：生成生成物数据，再按需合成媒体。 */
export async function runArtifactJob(
  ctx: AppContext,
  payload: { artifactId: string; instructions?: string; autoTitle?: boolean },
  progress: (p: number, m?: string) => Promise<void>,
): Promise<string> {
  const art = await ctx.store.artifacts.get(payload.artifactId);
  if (!art) throw notFound("生成物");
  try {
    await progress(0.05, "挑选资料片段");
    const { passages } = await gatherPassages(ctx, art.notebookId, {
      sourceIds: art.sourceIds,
      ...(payload.instructions ? { query: payload.instructions } : {}),
    });
    await progress(0.15, "生成内容");
    const chat = await ctx.models.chat();
    const data = await generateArtifactData(chat, {
      kind: art.kind,
      passages,
      ...(payload.autoTitle ? {} : { title: art.title }),
      ...(payload.instructions ? { instructions: payload.instructions } : {}),
    });
    const isMedia = art.kind === "audio" || art.kind === "image" || art.kind === "video";
    // 媒体类在合成完成前保持 generating，但先写入脚本 / 幻灯片，前端可以提前展示。
    const patch: Partial<Artifact> = { data, status: isMedia ? "generating" : "ready", error: null };
    if (payload.autoTitle)
      patch.title = `${ARTIFACT_KIND_META[art.kind].label}：${topicOf(passages)}`.slice(0, 120);
    await ctx.store.artifacts.update(art.id, patch);
    await emitArtifact(ctx, art.id);
    if (isMedia) {
      await progress(0.4, "合成媒体");
      return await renderArtifactMedia(ctx, art.id, (p, m) => progress(0.4 + 0.6 * p, m));
    }
    return "完成";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.store.artifacts.update(art.id, { status: "error", error: message.slice(0, 500) });
    await emitArtifact(ctx, art.id);
    throw err;
  }
}

/** 根据当前数据合成媒体（音频 / 图片 / 视频）。脚本被编辑后也可单独调用。 */
export async function renderArtifactMedia(
  ctx: AppContext,
  artifactId: string,
  progress: (p: number, m?: string) => Promise<void> = async () => {},
): Promise<string> {
  const art = await ctx.store.artifacts.get(artifactId);
  if (!art?.data) throw notFound("生成物数据");
  const data = art.data;
  const fail = async (
    message: string,
    keepData: ArtifactData = data,
    status: Artifact["status"] = "error",
  ) => {
    await ctx.store.artifacts.update(art.id, { status, error: message, data: keepData });
    await emitArtifact(ctx, art.id);
  };
  try {
    switch (data.kind) {
      case "audio": {
        const tts = await ctx.models.resolve("tts");
        if (!tts) {
          // 没有 TTS：保留可编辑的脚本，提示用户配置后重新合成。
          await fail(
            "已生成播客脚本，但尚未配置 TTS 模型：在「设置 → 模型」为“语音合成”分配模型后，点击重新合成即可生成音频。",
            { ...data, audioUrl: null },
            "ready",
          );
          return "已生成脚本（未配置 TTS）";
        }
        const voices = {
          ...defaultVoices(tts),
          ...((await ctx.store.settings.get<{ A?: string; B?: string }>("ttsVoices")) ?? {}),
        };
        const parts: BinaryResult[] = [];
        for (let i = 0; i < data.script.length; i++) {
          const line = data.script[i]!;
          parts.push(await synthesizeSpeech(tts, line.text, line.speaker === "A" ? voices.A : voices.B));
          await progress((i + 1) / data.script.length, `语音合成 ${i + 1}/${data.script.length}`);
        }
        const audioUrl = await saveMedia(ctx, `${art.id}-${Date.now().toString(36)}`, concatAudio(parts));
        await ctx.store.artifacts.update(art.id, {
          status: "ready",
          error: null,
          data: { ...data, audioUrl },
        });
        await emitArtifact(ctx, art.id);
        return "音频已生成";
      }
      case "image": {
        const model = await ctx.models.require("image", "配图");
        await progress(0.2, "生成图片");
        const img = await generateImageFile(model, data.prompt);
        const imageUrl = await saveMedia(ctx, `${art.id}-${Date.now().toString(36)}`, img);
        await ctx.store.artifacts.update(art.id, {
          status: "ready",
          error: null,
          data: { ...data, imageUrl },
        });
        await emitArtifact(ctx, art.id);
        return "图片已生成";
      }
      case "video": {
        const ffmpeg = detectFfmpeg(ctx);
        if (!ffmpeg) {
          throw new ApiError(
            400,
            "ffmpeg_missing",
            "未检测到 ffmpeg，无法合成视频：已生成幻灯片与旁白，安装 ffmpeg（或设置 FFMPEG_PATH）后重新合成即可。",
          );
        }
        const tts = await ctx.models.resolve("tts");
        const voices = tts ? defaultVoices(tts) : null;
        const slides = [];
        for (let i = 0; i < data.slides.length; i++) {
          const s = data.slides[i]!;
          const narration = s.notes.trim() || s.bullets.join("。");
          const audio = tts && narration ? await synthesizeSpeech(tts, narration, voices!.A) : null;
          slides.push({ title: s.title, bullets: s.bullets, audio });
          await progress((i + 1) / (data.slides.length + 1), `准备第 ${i + 1} 页`);
        }
        const mp4 = await renderSlidesVideo(ffmpeg, slides);
        const videoUrl = await saveMedia(ctx, `${art.id}-${Date.now().toString(36)}`, {
          data: mp4,
          mediaType: "video/mp4",
        });
        await ctx.store.artifacts.update(art.id, {
          status: "ready",
          error: null,
          data: { ...data, videoUrl },
        });
        await emitArtifact(ctx, art.id);
        return "视频已生成";
      }
      default:
        return "无需合成媒体";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(message.slice(0, 500));
    throw err;
  }
}

export async function refineArtifact(
  ctx: AppContext,
  id: string,
  input: { instruction: string; selection?: string },
): Promise<Artifact> {
  const art = await ctx.store.artifacts.get(id);
  if (!art) throw notFound("生成物");
  if (!art.data) throw badRequest("生成物还没有内容，无法再加工");
  if (!input.instruction?.trim()) throw badRequest("instruction 不能为空");
  const { passages } = await gatherPassages(ctx, art.notebookId, {
    sourceIds: art.sourceIds.length ? art.sourceIds : null,
    query: `${input.instruction} ${input.selection ?? ""}`,
    maxChars: 10_000,
  });
  const data = await refineArtifactData(await ctx.models.chat(), {
    kind: art.kind,
    data: art.data,
    instruction: input.instruction,
    ...(input.selection ? { selection: input.selection } : {}),
    passages,
    title: art.title,
  });
  const updated = (await ctx.store.artifacts.update(id, { data, status: "ready", error: null }))!;
  ctx.events.emit("artifact", updated);
  return updated;
}

/** 删除生成物及其媒体文件。 */
export async function deleteArtifact(ctx: AppContext, id: string): Promise<boolean> {
  const art = await ctx.store.artifacts.get(id);
  if (!art) return false;
  for (const f of await ctx.files.list(MEDIA_DIR)) {
    if (f.startsWith(`${MEDIA_DIR}/${id}`)) await ctx.files.delete(f);
  }
  return ctx.store.artifacts.delete(id);
}
