import { newId } from "@quirenote/core";
import { Button } from "@quirenote/ui";
import { Plus, Trash2 } from "lucide-react";
import type { ArtifactViewProps } from "../ArtifactPanel";

export function TimelineView({ data, onChange }: ArtifactViewProps<"timeline">) {
  const events = data.events;
  const set = (id: string, patch: Partial<(typeof events)[number]>) =>
    onChange({ kind: "timeline", events: events.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const insertAfter = (idx: number) => {
    const next = events.slice();
    next.splice(idx + 1, 0, { id: newId("ev"), date: "", title: "新事件", detail: "" });
    onChange({ kind: "timeline", events: next });
  };
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <ol className="relative">
        <span aria-hidden className="absolute top-2 bottom-2 left-[7.25rem] w-px bg-border-strong" />
        {events.map((e, i) => (
          <li key={e.id} className="group relative grid grid-cols-[6.5rem_1.5rem_1fr] gap-x-2 pb-7">
            <input
              defaultValue={e.date}
              onBlur={(x) => x.target.value !== e.date && set(e.id, { date: x.target.value })}
              placeholder="日期"
              className="h-7 bg-transparent text-right font-mono text-[13px] font-semibold text-accent outline-none"
            />
            <span className="relative mt-2 grid size-3.5 place-items-center justify-self-center rounded-full border-2 border-accent bg-surface shadow-[0_0_0_4px_var(--surface)]" />
            <div className="min-w-0 rounded-lg border border-transparent p-1 transition-colors group-hover:border-border group-hover:bg-surface-hover/40">
              <input
                defaultValue={e.title}
                onBlur={(x) => x.target.value !== e.title && set(e.id, { title: x.target.value })}
                className="block w-full bg-transparent text-[15px] font-semibold outline-none"
              />
              <textarea
                defaultValue={e.detail}
                onBlur={(x) => x.target.value !== e.detail && set(e.id, { detail: x.target.value })}
                rows={Math.max(1, Math.ceil(e.detail.length / 42))}
                placeholder="细节…"
                className="mt-0.5 block w-full resize-none bg-transparent font-serif text-[14px] leading-relaxed text-fg-muted outline-none"
              />
              <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="xs" variant="ghost" onClick={() => insertAfter(i)}>
                  <Plus />
                  在后面插入
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onChange({ kind: "timeline", events: events.filter((x) => x.id !== e.id) })}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {events.length === 0 ? (
        <Button variant="secondary" onClick={() => insertAfter(-1)}>
          <Plus />
          添加事件
        </Button>
      ) : null}
    </div>
  );
}
