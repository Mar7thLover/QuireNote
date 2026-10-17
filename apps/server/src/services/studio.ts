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
import { type Artifact, type ArtifactData, type ArtifactKind, newId, nowIso } from "@quirenote/core";
import type { AppContext } from "../context";
import { ApiError, badRequest, notFound } from "../errors";
import { extFromMime } from "../files";
import { kindLabel, msg } from "../messages";
import { notebookContextFor } from "./lorebook";
import { concatAudio, detectFfmpeg, renderSlidesVideo } from "./media";
import { activeSources, gatherNotes, gatherPassages } from "./passages";

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
  // 笔记也算资料：没有勾选资料但有笔记时也能生成
  const hasNotes = (await ctx.store.notes.list({ notebookId })).some((n) => n.markdown.trim());
  if (!sources.length && !hasNotes && input.kind !== "image") {
    throw badRequest(msg().noSources);
  }
  const ts = nowIso();
  const art: Artifact = {
    id: newId("art"),
    ownerId: ctx.store.ownerId,
    notebookId,
    kind: input.kind,
    title: input.title?.trim() || kindLabel(input.kind),
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
    { notebookId, refId: art.id, message: msg().job.generate(kindLabel(input.kind)) },
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
  if (!art) throw notFound("artifact");
  try {
    await progress(0.05, msg().job.pickPassages);
    const fromSources = art.sourceIds.length
      ? await gatherPassages(ctx, art.notebookId, {
          sourceIds: art.sourceIds,
          ...(payload.instructions ? { query: payload.instructions } : {}),
        })
      : { passages: [] };
    // 笔记也算资料，接在资料片段后面；没有资料时多给一些
    const fromNotes = await gatherNotes(ctx, art.notebookId, {
      query: `${payload.instructions ?? ""} ${art.title}`,
      maxChars: fromSources.passages.length ? 8000 : 24_000,
      startAt: fromSources.passages.length + 1,
    });
    const passages = [...fromSources.passages, ...fromNotes.passages];
    await progress(0.15, msg().job.generating);
    const chat = await ctx.models.chat();
    const titles = [...new Set(passages.map((p) => p.title ?? ""))].join(" ");
    const notebook = await notebookContextFor(ctx, art.notebookId, `${payload.instructions ?? ""} ${titles}`);
    const data = await generateArtifactData(chat, {
      kind: art.kind,
      passages,
      notebook,
      ...(payload.autoTitle ? {} : { title: art.title }),
      ...(payload.instructions ? { instructions: payload.instructions } : {}),
    });
    const isMedia = art.kind === "audio" || art.kind === "image" || art.kind === "video";
    // 媒体类在合成完成前保持 generating，但先写入脚本 / 幻灯片，前端可以提前展示。
    const patch: Partial<Artifact> = { data, status: isMedia ? "generating" : "ready", error: null };
    if (payload.autoTitle)
      // 标题按资料来取；只有笔记时用笔记标题（不算进「几份资料」）
      patch.title = msg()
        .artifactTitle(
          kindLabel(art.kind),
          topicOf(
            fromSources.passages.length
              ? fromSources.passages
              : fromNotes.passages.map((p) => ({ ...p, title: p.title?.replace(/^笔记：/, "") })),
          ),
        )
        .slice(0, 120);
    await ctx.store.artifacts.update(art.id, patch);
    await emitArtifact(ctx, art.id);
    if (isMedia) {
      await progress(0.4, msg().job.renderMedia);
      return await renderArtifactMedia(ctx, art.id, (p, m) => progress(0.4 + 0.6 * p, m));
    }
    return msg().job.done;
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
  if (!art?.data) throw notFound("artifactData");
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
          // 没有 TTS：脚本照常可用，前端用系统语音朗读；配置 TTS 后可以重新合成为音频文件。
          await ctx.store.artifacts.update(art.id, {
            status: "ready",
            error: null,
            data: { ...data, audioUrl: null },
          });
          await emitArtifact(ctx, art.id);
          return msg().job.scriptSystemVoice;
        }
        const voices = {
          ...defaultVoices(tts),
          ...((await ctx.store.settings.get<{ A?: string; B?: string }>("ttsVoices")) ?? {}),
        };
        const parts: BinaryResult[] = [];
        for (let i = 0; i < data.script.length; i++) {
          const line = data.script[i]!;
          parts.push(await synthesizeSpeech(tts, line.text, line.speaker === "A" ? voices.A : voices.B));
          await progress((i + 1) / data.script.length, msg().job.tts(i + 1, data.script.length));
        }
        const audioUrl = await saveMedia(ctx, `${art.id}-${Date.now().toString(36)}`, concatAudio(parts));
        await ctx.store.artifacts.update(art.id, {
          status: "ready",
          error: null,
          data: { ...data, audioUrl },
        });
        await emitArtifact(ctx, art.id);
        return msg().job.audioDone;
      }
      case "image": {
        const model = await ctx.models.require("image", "illustration");
        await progress(0.2, msg().job.imageGen);
        const img = await generateImageFile(model, data.prompt);
        const imageUrl = await saveMedia(ctx, `${art.id}-${Date.now().toString(36)}`, img);
        await ctx.store.artifacts.update(art.id, {
          status: "ready",
          error: null,
          data: { ...data, imageUrl },
        });
        await emitArtifact(ctx, art.id);
        return msg().job.imageDone;
      }
      case "video": {
        const ffmpeg = detectFfmpeg(ctx);
        if (!ffmpeg) {
          throw new ApiError(400, "ffmpeg_missing", msg().noFfmpeg);
        }
        const tts = await ctx.models.resolve("tts");
        const voices = tts ? defaultVoices(tts) : null;
        const slides = [];
        for (let i = 0; i < data.slides.length; i++) {
          const s = data.slides[i]!;
          const narration = s.notes.trim() || s.bullets.join("。");
          const audio = tts && narration ? await synthesizeSpeech(tts, narration, voices!.A) : null;
          slides.push({ title: s.title, bullets: s.bullets, audio });
          await progress((i + 1) / (data.slides.length + 1), msg().job.slidePrep(i + 1));
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
        return msg().job.videoDone;
      }
      default:
        return msg().job.noMedia;
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
  if (!art) throw notFound("artifact");
  if (!art.data) throw badRequest(msg().artifactEmptyRefine);
  if (!input.instruction?.trim()) throw badRequest(msg().emptyField("instruction"));
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
