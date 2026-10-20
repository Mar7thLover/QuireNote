import { cn, Dialog, DialogContent } from "@quirenote/ui";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Markdown } from "@/components/Markdown";
import { usePlugins } from "@/features/plugins/catalog";
import { currentLang, useTranslation } from "@/i18n";
import { isMac } from "@/lib/hotkeys";
import { useUi } from "@/stores/ui";
import { manualSections } from "./content";

/** 内置使用手册：左侧目录，右侧正文（衬线字体，适合阅读）。useUi.manual 为当前章节。 */
export function ManualDialog() {
  const { t } = useTranslation();
  const section = useUi((s) => s.manual);
  const plugins = usePlugins();
  const lang = currentLang();
  const sections = useMemo(
    () => manualSections(lang, (id) => !!plugins.data?.find((p) => p.id === id)?.enabled),
    [lang, plugins.data],
  );
  const current = sections.find((s) => s.id === section) ?? sections[0]!;
  const body = useRef<HTMLDivElement>(null);
  const close = () => useUi.getState().set({ manual: null });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 换章节时回到顶部
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [current.id]);

  return (
    <Dialog open={section !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent
        hideClose
        aria-label={t("manual.title")}
        className="top-[7vh] flex h-[86vh] max-h-[86vh] max-w-[960px] overflow-hidden rounded-2xl p-0"
      >
        <nav
          aria-label={t("manual.contents")}
          className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-bg-subtle p-3 sm:flex"
        >
          <p className="px-2.5 pt-1.5 pb-3 font-serif text-[17px]">{t("manual.title")}</p>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => useUi.getState().set({ manual: s.id })}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring",
                s.id === current.id && "bg-surface-hover font-medium text-fg",
              )}
            >
              <s.icon className="size-4 shrink-0" strokeWidth={1.6} />
              <span className="truncate">{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
            <select
              aria-label={t("manual.contents")}
              value={current.id}
              onChange={(e) => useUi.getState().set({ manual: e.target.value })}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-[13.5px] sm:hidden"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <span className="hidden truncate text-[13px] text-fg-subtle sm:block">{t("manual.title")}</span>
            <button
              type="button"
              onClick={close}
              aria-label={t("common.close")}
              className="ml-auto grid size-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
            >
              <X className="size-[18px]" strokeWidth={1.6} />
            </button>
          </div>
          <div ref={body} className="min-h-0 flex-1 overflow-y-auto">
            <article className="mx-auto max-w-[640px] px-6 pt-8 pb-16 sm:px-10">
              <h1 className="font-serif text-[28px] leading-tight">{current.title}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{current.summary}</p>
              <Markdown
                text={isMac ? current.body.replace(/\bCtrl /g, "⌘ ") : current.body}
                serif
                className="mt-6"
              />
              <SectionNav current={current.id} ids={sections.map((s) => s.id)} titles={sections} />
            </article>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionNav({
  current,
  ids,
  titles,
}: {
  current: string;
  ids: string[];
  titles: { id: string; title: string }[];
}) {
  const { t } = useTranslation();
  const i = ids.indexOf(current);
  const prev = titles[i - 1];
  const next = titles[i + 1];
  return (
    <div className="mt-12 flex gap-3 border-t border-border pt-5">
      {prev ? (
        <button
          type="button"
          onClick={() => useUi.getState().set({ manual: prev.id })}
          className="flex flex-1 flex-col items-start gap-0.5 rounded-xl border border-border px-4 py-3 text-left hover:border-border-strong focus-ring"
        >
          <span className="text-[12px] text-fg-subtle">{t("manual.prev")}</span>
          <span className="text-[14px]">{prev.title}</span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => useUi.getState().set({ manual: next.id })}
          className="flex flex-1 flex-col items-end gap-0.5 rounded-xl border border-border px-4 py-3 text-right hover:border-border-strong focus-ring"
        >
          <span className="text-[12px] text-fg-subtle">{t("manual.next")}</span>
          <span className="text-[14px]">{next.title}</span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  );
}
