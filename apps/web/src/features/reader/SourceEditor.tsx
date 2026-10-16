import type { Source } from "@quirenote/core";
import { Button, Shortcut, toast } from "@quirenote/ui";
import { useMutation } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import i18n, { useTranslation } from "@/i18n";
import { api, type SourceEditResult } from "@/lib/api";
import { qk, queryClient, upsertInList } from "@/lib/query";

/** 编辑结果写回缓存，并提示被移除的高亮数量。 */
export function applyEditResult(r: SourceEditResult, message: string) {
  queryClient.setQueryData(qk.source(r.source.id), r.source);
  upsertInList(qk.sources(r.source.notebookId), r.source);
  queryClient.invalidateQueries({ queryKey: qk.content(r.source.id) });
  queryClient.invalidateQueries({ queryKey: qk.jobs });
  toast.success(message, {
    description: r.highlights.removed
      ? i18n.t("reader.highlightsRemoved", { count: r.highlights.removed })
      : undefined,
  });
}

/** 资料全文编辑器：纯文本 / Markdown，Ctrl+S 保存，Esc 取消。 */
export function SourceEditor({
  source,
  text,
  onClose,
}: {
  source: Source;
  text: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = value !== text;

  const save = useMutation({
    mutationFn: () => api.sources.editContent(source.id, value),
    onSuccess: (r) => {
      if (r.job) applyEditResult(r, t("reader.saved"));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = () => {
    if (!dirty || confirm(t("reader.discardConfirm"))) onClose();
  };

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(0, 0);
  }, []);

  // 未保存时离开页面要确认。
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-sunken/60 px-4 py-2">
        <Info className="size-3.5 shrink-0 text-fg-subtle" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-muted">{t("reader.editHint")}</p>
        <span className="hidden text-[11px] text-fg-subtle lg:inline">
          <Shortcut keys="Mod+S" /> {t("reader.save")}
        </span>
        <Button size="sm" variant="ghost" onClick={cancel}>
          {t("reader.cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("reader.save")}
        </Button>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (dirty && !save.isPending) save.mutate();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        spellCheck={false}
        aria-label={t("reader.edit")}
        className="min-h-0 w-full flex-1 resize-none bg-surface px-8 py-6 font-serif text-[15.5px] leading-[1.85] text-fg outline-none"
      />
    </div>
  );
}
