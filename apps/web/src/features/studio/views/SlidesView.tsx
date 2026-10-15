import { newId, type Slide } from "@folio/core";
import { Button, cn } from "@folio/ui";
import { ChevronLeft, ChevronRight, Maximize, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArtifactViewProps } from "../ArtifactPanel";

export function SlidesView({ data, onChange }: ArtifactViewProps<"slides">) {
  const slides = data.slides;
  const [i, setI] = useState(0);
  const [present, setPresent] = useState(false);
  const cur = slides[Math.min(i, slides.length - 1)];
  const set = (id: string, patch: Partial<Slide>) =>
    onChange({ kind: "slides", slides: slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setI((x) => Math.min(x + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
      if (e.key === "Escape") setPresent(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present, slides.length]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-44 shrink-0 space-y-2 overflow-y-auto border-r border-border p-2.5">
        {slides.map((s, j) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setI(j)}
            className={cn(
              "block aspect-video w-full overflow-hidden rounded-md border bg-surface p-2 text-left shadow-sm transition-[border-color,box-shadow] focus-ring",
              j === i ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong",
            )}
          >
            <span className="text-[9px] text-fg-subtle">{j + 1}</span>
            <p className="line-clamp-2 text-[10px] font-semibold leading-tight">{s.title}</p>
          </button>
        ))}
        <Button
          size="xs"
          variant="ghost"
          className="w-full"
          onClick={() => {
            onChange({
              kind: "slides",
              slides: [
                ...slides,
                { id: newId("sl"), title: "新幻灯片", bullets: ["要点"], notes: "", image: null },
              ],
            });
            setI(slides.length);
          }}
        >
          <Plus />
          添加
        </Button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col items-center overflow-y-auto bg-surface-sunken/50 p-6">
        <div className="mb-3 flex w-full max-w-3xl items-center gap-2">
          <span className="text-xs text-fg-subtle tabular-nums">
            {i + 1} / {slides.length}
          </span>
          <span className="flex-1" />
          {cur ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                onChange({ kind: "slides", slides: slides.filter((s) => s.id !== cur.id) });
                setI(Math.max(0, i - 1));
              }}
            >
              <Trash2 />
            </Button>
          ) : null}
          <Button size="xs" variant="secondary" onClick={() => setPresent(true)}>
            <Maximize />
            演示
          </Button>
        </div>
        {cur ? (
          <>
            <SlideCanvas slide={cur} editable onChange={(p) => set(cur.id, p)} />
            <textarea
              key={`${cur.id}-notes`}
              defaultValue={cur.notes}
              onBlur={(e) => set(cur.id, { notes: e.target.value })}
              placeholder="演讲备注 / 旁白…"
              rows={3}
              className="mt-4 w-full max-w-3xl resize-none rounded-lg border border-border bg-surface p-3 text-[13px] text-fg-muted outline-none focus:border-accent/60"
            />
          </>
        ) : null}
      </div>
      {present && cur ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black p-8">
          <SlideCanvas slide={cur} className="max-w-[min(92vw,160vh)]" />
          <div className="absolute right-6 bottom-6 flex items-center gap-2 text-white/70">
            <Button
              size="icon"
              variant="ghost"
              className="text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setI(Math.max(0, i - 1))}
              aria-label="prev"
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm tabular-nums">
              {i + 1} / {slides.length}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setI(Math.min(slides.length - 1, i + 1))}
              aria-label="next"
            >
              <ChevronRight />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setPresent(false)}
              aria-label="close"
            >
              <X />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SlideCanvas({
  slide,
  editable,
  onChange,
  className,
}: {
  slide: Slide;
  editable?: boolean;
  onChange?: (p: Partial<Slide>) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-video w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-surface shadow-lg [container-type:inline-size]",
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-accent to-[oklch(0.65_0.18_calc(var(--accent-h)+50))]" />
      <div className="flex h-full gap-[4cqw] p-[6cqw]">
        <div className="min-w-0 flex-1">
          {editable ? (
            <input
              key={`${slide.id}-t`}
              defaultValue={slide.title}
              onBlur={(e) => onChange?.({ title: e.target.value })}
              className="w-full bg-transparent text-[4.2cqw] leading-tight font-bold tracking-tight outline-none"
            />
          ) : (
            <h2 className="text-[4.2cqw] leading-tight font-bold tracking-tight">{slide.title}</h2>
          )}
          <ul className="mt-[3cqw] space-y-[1.4cqw]">
            {slide.bullets.map((b, j) => (
              <li key={j} className="flex gap-[1.4cqw] text-[2.3cqw] leading-snug text-fg-muted">
                <span className="mt-[0.9cqw] size-[0.9cqw] shrink-0 rounded-full bg-accent" />
                {editable ? (
                  <input
                    key={`${slide.id}-${j}-${b}`}
                    defaultValue={b}
                    onBlur={(e) => {
                      const v = e.target.value;
                      onChange?.({
                        bullets: v.trim()
                          ? slide.bullets.map((x, k) => (k === j ? v : x))
                          : slide.bullets.filter((_, k) => k !== j),
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const next = slide.bullets.slice();
                        next.splice(j + 1, 0, "");
                        onChange?.({ bullets: next.map((x, k) => (k === j ? e.currentTarget.value : x)) });
                      }
                    }}
                    className="w-full bg-transparent outline-none"
                  />
                ) : (
                  b
                )}
              </li>
            ))}
          </ul>
        </div>
        {slide.image ? (
          <img src={slide.image} alt="" className="h-full w-[38%] rounded-lg object-cover" />
        ) : null}
      </div>
    </div>
  );
}
