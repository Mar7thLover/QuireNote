import type { PodcastLine } from "@quirenote/core";
import { Button, cn, EmptyState } from "@quirenote/ui";
import { ImageOff, Mic2, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { apiBase } from "@/lib/api";
import type { ArtifactViewProps } from "../ArtifactPanel";
import { SlidesView } from "./SlidesView";

/** 文本以中日韩文字为主（用来选朗读语言）。 */
function mostlyCjk(text: string): boolean {
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0;
  return cjk > text.replace(/\s/g, "").length * 0.3;
}

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
        <PromptCaption prompt={data.prompt} />
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
  return <AudioView {...props} data={data} />;
}

/** 配图的提示词：默认只显示三行，可以展开。 */
function PromptCaption({ prompt }: { prompt: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 text-[12.5px] leading-relaxed text-fg-subtle">
      <p className={cn(!open && "line-clamp-3")}>{prompt}</p>
      {prompt.length > 160 ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg"
        >
          {open ? t("studio.collapse") : t("studio.showPrompt")}
        </button>
      ) : null}
    </div>
  );
}

function AudioView(
  props: ArtifactViewProps<"audio"> & {
    data: Extract<ArtifactViewProps<"audio">["data"], { kind: "audio" }>;
  },
) {
  const { t } = useTranslation();
  const { data, onChange } = props;
  const narrator = useNarrator(data.script);
  const setLine = (i: number, patch: Partial<PodcastLine>) =>
    onChange({ ...data, script: data.script.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="mb-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <div
            className="grid size-11 shrink-0 place-items-center rounded-lg"
            style={{
              background: "color-mix(in srgb, oklch(0.68 0.11 42) 30%, var(--surface-sunken))",
              color: "color-mix(in srgb, oklch(0.68 0.11 42) 55%, var(--fg))",
            }}
          >
            <Mic2 className="size-5" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{props.artifact.title}</p>
            <p className="text-xs text-fg-subtle">{t("studio.audioMeta", { count: data.script.length })}</p>
          </div>
          {data.audioUrl ? null : narrator.supported ? (
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="primary" onClick={narrator.toggle}>
                {narrator.state === "playing" ? <Pause /> : <Play />}
                {narrator.state === "playing" ? t("studio.pause") : t("studio.readAloud")}
              </Button>
              {narrator.state !== "idle" ? (
                <Button size="sm" variant="ghost" onClick={narrator.stop}>
                  <Square />
                  {t("studio.stop")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {data.audioUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: 字幕即下方脚本
          <audio src={fileUrl(data.audioUrl)} controls className="mt-4 w-full" />
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-fg-subtle">
            {narrator.supported ? t("studio.systemVoiceHint") : t("studio.noVoice")}
          </p>
        )}
      </div>
      <div className="space-y-3">
        {data.script.map((l, i) => (
          <div key={i} className={cn("flex gap-3", l.speaker === "B" && "flex-row-reverse")}>
            <span
              className={cn(
                "mt-1 grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-medium",
                l.speaker === "A" ? "bg-surface-sunken text-fg-muted" : "bg-accent-soft text-accent-soft-fg",
              )}
            >
              {l.speaker === "A" ? t("studio.hostA") : t("studio.hostB")}
            </span>
            <textarea
              defaultValue={l.text}
              onBlur={(e) => e.target.value !== l.text && setLine(i, { text: e.target.value })}
              rows={2}
              className={cn(
                // 高度随内容变化，窄面板里也不会截断
                "min-w-0 flex-1 resize-none rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed outline-none transition-shadow [field-sizing:content] focus:ring-2 focus:ring-ring/30",
                l.speaker === "A" ? "rounded-tl-md bg-surface-sunken" : "rounded-tr-md bg-surface-hover",
                narrator.line === i && "ring-2 ring-border-strong",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 没有 TTS 时的替代：用浏览器 / 系统自带的语音逐段朗读脚本，两位说话人尽量用两种不同的声音。
 */
function useNarrator(script: PodcastLine[]) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [line, setLine] = useState<number | null>(null);
  const run = useRef(0);

  const pickVoices = () => {
    const zh = mostlyCjk(
      script
        .map((l) => l.text)
        .join("")
        .slice(0, 400),
    );
    const all = window.speechSynthesis.getVoices();
    const lang = all.filter((v) => v.lang.toLowerCase().startsWith(zh ? "zh" : "en"));
    const pool = lang.length ? lang : all;
    return { A: pool[0], B: pool[1] ?? pool[0], lang: zh ? "zh-CN" : "en-US", same: pool.length < 2 };
  };

  const speakFrom = (i: number, id: number) => {
    if (id !== run.current) return;
    const l = script[i];
    if (!l) {
      setState("idle");
      setLine(null);
      return;
    }
    const v = pickVoices();
    const u = new SpeechSynthesisUtterance(l.text);
    u.lang = v.lang;
    const voice = l.speaker === "A" ? v.A : v.B;
    if (voice) u.voice = voice;
    // 只有一种声音时，用音高区分两位说话人。
    if (v.same && l.speaker === "B") u.pitch = 1.25;
    u.onend = () => speakFrom(i + 1, id);
    u.onerror = () => speakFrom(i + 1, id);
    setLine(i);
    window.speechSynthesis.speak(u);
  };

  const stop = () => {
    run.current++;
    if (supported) window.speechSynthesis.cancel();
    setState("idle");
    setLine(null);
  };

  const toggle = () => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (state === "playing") {
      synth.pause();
      setState("paused");
    } else if (state === "paused") {
      synth.resume();
      setState("playing");
    } else {
      synth.cancel();
      const id = ++run.current;
      setState("playing");
      speakFrom(0, id);
    }
  };

  useEffect(() => {
    if (!supported) return;
    // 有的浏览器异步加载语音列表，先触发一次。
    window.speechSynthesis.getVoices();
    return () => {
      run.current++;
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  return { supported, state, line, toggle, stop };
}
