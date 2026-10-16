import { Button, cn, EmptyState, Input, Tabs, TabsList, TabsTrigger, toast } from "@quirenote/ui";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Globe, Plus, Search, Telescope } from "lucide-react";
import { useState } from "react";
import { PanelShell, PanelTitle } from "@/components/Panel";
import { useTranslation } from "@/i18n";
import { ApiError, api, type WebResult } from "@/lib/api";
import { qk, upsertInList } from "@/lib/query";

export function SearchPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  const search = useMutation({ mutationFn: (query: string) => api.search.web(query) });
  const research = useMutation({
    mutationFn: (question: string) => api.search.research(notebookId, question, 2),
    onSuccess: () =>
      toast.success("深度研究已开始", { description: "完成后结果会作为资料加入，并生成一份研究报告" }),
  });
  const add = useMutation({
    mutationFn: (r: WebResult) => api.sources.addSearch(notebookId, r),
    onSuccess: (s, r) => {
      upsertInList(qk.sources(notebookId), s);
      setAdded((x) => new Set(x).add(r.url));
    },
  });

  const noProvider = search.error instanceof ApiError && /provider|配置|search/i.test(search.error.message);

  return (
    <PanelShell toolbar={<PanelTitle>{t("search.title")}</PanelTitle>}>
      <div className="flex h-full flex-col">
        <form
          className="shrink-0 space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            mode === "quick" ? search.mutate(q.trim()) : research.mutate(q.trim());
          }}
        >
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="quick" className="flex-1">
                <Search />
                {t("search.quick")}
              </TabsTrigger>
              <TabsTrigger value="deep" className="flex-1">
                <Telescope />
                {t("search.deep")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex gap-1.5">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")}
              className="h-9"
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              className="h-9"
              loading={search.isPending || research.isPending}
            >
              {mode === "quick" ? t("common.search") : t("search.start")}
            </Button>
          </div>
          {mode === "deep" ? (
            <p className="text-xs leading-relaxed text-fg-subtle">{t("search.deepDesc")}</p>
          ) : null}
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {search.isError ? (
            <EmptyState
              icon={<Globe />}
              title={noProvider ? t("search.noProvider") : search.error.message}
              action={
                <Button size="sm" asChild>
                  <Link to="/settings/$section" params={{ section: "models" }}>
                    {t("settings.models")}
                  </Link>
                </Button>
              }
            />
          ) : search.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border border-border p-3">
                  <div className="skeleton h-4 w-2/3" />
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : search.data ? (
            <div className="space-y-2">
              {search.data.results.map((r) => {
                const done = added.has(r.url);
                return (
                  <div
                    key={r.url}
                    className="group rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong"
                  >
                    <div className="flex items-start gap-2">
                      <Globe className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                      <div className="min-w-0 flex-1">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="line-clamp-2 text-[13.5px] font-medium hover:text-accent"
                        >
                          {r.title}
                        </a>
                        <p className="truncate text-[11px] text-fg-subtle">{r.url}</p>
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-fg-muted">{r.snippet}</p>
                      </div>
                      <Button
                        size="xs"
                        variant={done ? "ghost" : "soft"}
                        className={cn(done && "text-success")}
                        disabled={done || (add.isPending && add.variables?.url === r.url)}
                        onClick={() => add.mutate(r)}
                      >
                        {done ? <Check /> : <Plus />}
                        {done ? t("search.added") : t("search.addToSources")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Globe />}
              title={t("search.title")}
              description="搜索结果可一键加入资料；深度研究会多轮检索、汇总后自动导入。"
            />
          )}
        </div>
      </div>
    </PanelShell>
  );
}
