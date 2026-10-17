/**
 * 导入卡片：先让服务端解析出预览（封面、作者、包含什么、常驻条目、会被停用的规则），
 * 用户看过再决定导入到新 Notebook 还是已有的 Notebook。
 */
import { Button, cn, Dialog, DialogContent, Select, Skeleton, toast } from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { setPluginEnabled } from "@/features/plugins/catalog";
import { currentLang, useTranslation } from "@/i18n";
import { ApiError, api, type CardPreview } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { TINTS, tintFor } from "@/lib/tints";

const NEW = "__new__";

export interface ImportRequest {
  file: File;
  /** 从某个 Notebook 里发起时默认导入到这里。 */
  notebookId?: string | null;
}

export function ImportCardDialog({
  request,
  onClose,
}: {
  request: ImportRequest | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lang = currentLang();
  const file = request?.file ?? null;
  const preview = useQuery({
    queryKey: ["card-preview", file?.name, file?.size, file?.lastModified, lang],
    queryFn: () => api.cards.preview(file!, lang),
    enabled: !!file,
    retry: false,
    gcTime: 0,
  });
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list, enabled: !!file });
  const [target, setTarget] = useState(NEW);
  const [as, setAs] = useState<"notebook" | "preset">("notebook");

  useEffect(() => {
    if (!request) return;
    setTarget(request.notebookId ?? NEW);
    setAs("notebook");
  }, [request]);

  const asPreset = useMutation({
    mutationFn: () => api.cards.importAsPreset(file!, lang),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["presets"] });
      toast.success(t("presets.addedStyle", { name: r.preset.name }));
      for (const w of r.warnings) toast.warning(w);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const run = useMutation({
    mutationFn: () => api.cards.import(file!, lang, target === NEW ? null : target),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: qk.notebooks });
      queryClient.invalidateQueries({ queryKey: qk.overview });
      if (!r.created) {
        // 合并进已打开的 Notebook：笔记、知识书和规则都要刷新
        queryClient.invalidateQueries({
          predicate: (q) => JSON.stringify(q.queryKey).includes(r.notebookId),
        });
      }
      toast.success(t("cards.imported"));
      for (const w of r.warnings) toast.warning(w);
      onClose();
      navigate({ to: "/n/$notebookId", params: { notebookId: r.notebookId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const p = preview.data;
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("cards.importTitle")}
        className="flex max-w-[560px] flex-col overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {preview.isLoading ? (
            <div className="flex gap-4">
              <Skeleton className="h-[150px] w-[100px] shrink-0 rounded-lg" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ) : preview.error instanceof ApiError && preview.error.code === "plugin_disabled" ? (
            <PluginNeeded
              plugin={String(preview.error.details.plugin ?? "")}
              onEnabled={() => preview.refetch()}
            />
          ) : preview.isError ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-[13.5px] text-danger">
              {preview.error instanceof Error ? preview.error.message : t("cards.unreadable")}
            </p>
          ) : p ? (
            <PreviewBody p={p} />
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-4 border-t border-border px-5 pt-4 pb-5">
          {p?.format.startsWith("st-card") ? (
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t("presets.importAs")}>
              <span className="text-[13px] font-medium text-fg-muted">{t("presets.importAs")}</span>
              <div className="grid grid-cols-2 gap-2">
                {(["notebook", "preset"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={as === k}
                    onClick={() => setAs(k)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors focus-ring",
                      as === k ? "border-fg bg-surface" : "border-border hover:border-border-strong",
                    )}
                  >
                    <span className="text-[13.5px] font-medium">
                      {t(k === "notebook" ? "presets.importAsNotebook" : "presets.importAsPreset")}
                    </span>
                    <span className="text-[11.5px] leading-snug text-fg-subtle">
                      {t(k === "notebook" ? "presets.importAsNotebookHint" : "presets.importAsPresetHint")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {p && as === "notebook" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-muted">{t("cards.importTo")}</span>
              <Select
                value={target}
                onValueChange={setTarget}
                ariaLabel={t("cards.importTo")}
                options={[
                  { value: NEW, label: t("cards.newNotebook") },
                  ...(notebooks.data ?? []).map((n) => ({ value: n.id, label: n.title })),
                ]}
              />
              {target !== NEW && (p.lore.total || p.rules.total || p.aiInstructions) ? (
                <span className="text-[12.5px] leading-relaxed text-fg-subtle">{t("cards.mergeHint")}</span>
              ) : null}
            </label>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => (as === "preset" ? asPreset.mutate() : run.mutate())}
              loading={run.isPending || asPreset.isPending}
              disabled={!p}
            >
              {t("cards.import")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 文件属于一个没启用的插件：说明一下，给一个启用按钮，启用后重新预览。 */
function PluginNeeded({ plugin, onEnabled }: { plugin: string; onEnabled: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-sunken px-4 py-3.5">
      <p className="text-[13.5px] leading-relaxed text-fg-muted">
        {t("cards.pluginNeeded", { name: t(`plugins.${plugin}.name`) })}
      </p>
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await setPluginEnabled(plugin, true);
            onEnabled();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("cards.enablePlugin", { name: t(`plugins.${plugin}.name`) })}
      </Button>
    </div>
  );
}

function PreviewBody({ p }: { p: CardPreview }) {
  const { t } = useTranslation();
  const counts = [
    p.notes.length ? t("cards.countNotes", { count: p.notes.length }) : null,
    p.lore.total ? t("cards.countLore", { count: p.lore.total }) : null,
    p.rules.total ? t("cards.countRules", { count: p.rules.total }) : null,
    p.templates ? t("cards.countTemplates", { count: p.templates }) : null,
    p.assets ? t("cards.countAssets", { count: p.assets }) : null,
    p.sources ? t("cards.countSources", { count: p.sources }) : null,
  ].filter(Boolean);
  const meta = [
    p.creator ? t("cards.by", { name: p.creator }) : null,
    p.version ? `v${p.version}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        {p.cover ? (
          <img src={p.cover} alt="" className="h-[150px] w-[100px] shrink-0 rounded-lg object-cover" />
        ) : (
          <div
            aria-hidden
            className="grid h-[150px] w-[100px] shrink-0 place-items-center rounded-lg font-serif text-[44px] text-fg/80"
            style={{ background: TINTS[tintFor(p.name)] }}
          >
            {[...p.name.trim()][0] ?? "Q"}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12px] text-fg-subtle">{t(`cards.format_${p.format}`)}</span>
          <h3 className="font-serif text-[21px] leading-snug">{p.name || t("common.untitled")}</h3>
          {meta.length ? <span className="text-[13px] text-fg-muted">{meta.join(" · ")}</span> : null}
          {p.summary ? (
            <p className="line-clamp-3 text-[13.5px] leading-relaxed text-fg-muted">{p.summary}</p>
          ) : null}
          {counts.length ? <p className="mt-auto text-[12.5px] text-fg-subtle">{counts.join("、")}</p> : null}
        </div>
      </div>

      {p.creatorNotes ? (
        <Section title={t("cards.creatorNotes")}>
          <p className="whitespace-pre-wrap">{p.creatorNotes}</p>
        </Section>
      ) : null}
      {p.aiInstructions ? (
        <Section title={t("cards.aiInstructions")} hint={t("cards.aiInstructionsHint")}>
          <p className="line-clamp-6 whitespace-pre-wrap">{p.aiInstructions}</p>
        </Section>
      ) : null}
      {p.lore.constant.length ? (
        <Section title={t("cards.constantLore")} hint={t("cards.constantLoreHint")}>
          <ul className="flex flex-col gap-2">
            {p.lore.constant.map((e) => (
              <li key={e.name}>
                <span className="font-medium text-fg">{e.name}</span>
                <span className="line-clamp-2 text-fg-subtle">{e.content}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {p.rules.disabled.length ? (
        <Section title={t("cards.disabledRules")} hint={t("cards.disabledRulesHint")}>
          <p>{p.rules.disabled.join("、")}</p>
        </Section>
      ) : null}
      {p.warnings.length ? (
        <ul className="flex flex-col gap-1 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-3 text-[13px] leading-relaxed text-fg-muted">
      <div className="flex flex-col">
        <h4 className="text-[13px] font-medium text-fg">{title}</h4>
        {hint ? <span className="text-[12px] text-fg-subtle">{hint}</span> : null}
      </div>
      <div className="max-h-40 overflow-y-auto">{children}</div>
    </section>
  );
}
