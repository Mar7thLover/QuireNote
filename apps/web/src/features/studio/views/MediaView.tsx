import type { PodcastLine } from "@quirenote/core";
import { cn, EmptyState } from "@quirenote/ui";
import { ImageOff, Mic2 } from "lucide-react";
import { apiBase } from "@/lib/api";
import type { ArtifactViewProps } from "../ArtifactPanel";
import { SlidesView } from "./SlidesView";

function fileUrl(u: string): string {
  // 服务端返回 /api/files/xxx 形式；自定义服务器地址时需要改写前缀
  return u.startsWith("/api/") ? apiBase() + u.slice(4) : u;
}

/** 音频概览 / 视频概览 / 配图。 */
export function MediaView(props: ArtifactViewProps<"audio" | "video" | "image">) {
  const { data, onChange } = props;
  if (data.kind === "image") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {data.imageUrl ? (
          <img
            src={fileUrl(data.imageUrl)}
            alt={data.prompt}
            className="w-full rounded-xl border border-border shadow-md"
          />
        ) : (
          <EmptyState
            icon={<ImageOff />}
            title="图像尚未生成"
            description="请在设置中为「图像」能力分配模型。"
          />
        )}
        <p className="mt-3 rounded-lg bg-surface-sunken p-3 text-[13px] text-fg-muted">{data.prompt}</p>
      </div>
    );
  }
  if (data.kind === "video") {
    return (
      <div className="flex h-full flex-col">
        {data.videoUrl ? (
          <div className="bg-black p-4">
            {/* biome-ignore lint/a11y/useMediaCaption: 旁白文本在下方幻灯片备注中 */}
            <video src={fileUrl(data.videoUrl)} controls className="mx-auto max-h-[50vh] rounded-lg" />
          </div>
        ) : (
          <p className="border-b border-border bg-warning-soft px-4 py-2 text-xs text-fg-muted">
            视频尚未合成（需要服务端安装 ffmpeg 并配置 TTS）。下面是可编辑的幻灯片与旁白。
          </p>
        )}
        <div className="min-h-0 flex-1">
          <SlidesView
            {...props}
            data={{ kind: "slides", slides: data.slides }}
            onChange={(d) => d.kind === "slides" && onChange({ ...data, slides: d.slides })}
          />
        </div>
      </div>
    );
  }
  const setLine = (i: number, patch: Partial<PodcastLine>) =>
    onChange({ ...data, script: data.script.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-xl bg-accent text-accent-fg shadow-md">
            <Mic2 className="size-6" />
          </div>
          <div>
            <p className="text-[15px] font-semibold">{props.artifact.title}</p>
            <p className="text-xs text-fg-muted">双人对谈 · {data.script.length} 段</p>
          </div>
        </div>
        {data.audioUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: 字幕即下方脚本
          <audio src={fileUrl(data.audioUrl)} controls className="mt-4 w-full" />
        ) : (
          <p className="mt-3 text-xs text-fg-subtle">
            音频尚未合成：请在设置中为「语音合成」能力分配 TTS 服务。脚本可先编辑。
          </p>
        )}
      </div>
      <div className="space-y-3">
        {data.script.map((l, i) => (
          <div key={i} className={cn("flex gap-3", l.speaker === "B" && "flex-row-reverse")}>
            <span
              className={cn(
                "mt-1 grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                l.speaker === "A" ? "bg-accent text-accent-fg" : "bg-[oklch(0.7_0.14_40)] text-white",
              )}
            >
              {l.speaker === "A" ? "主" : "嘉"}
            </span>
            <textarea
              defaultValue={l.text}
              onBlur={(e) => e.target.value !== l.text && setLine(i, { text: e.target.value })}
              rows={Math.max(2, Math.ceil(l.text.length / 34))}
              className={cn(
                "min-w-0 flex-1 resize-none rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed outline-none focus:ring-2 focus:ring-ring/30",
                l.speaker === "A" ? "rounded-tl-md bg-surface-sunken" : "rounded-tr-md bg-surface-hover",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
