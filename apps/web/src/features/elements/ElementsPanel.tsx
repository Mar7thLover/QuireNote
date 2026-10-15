import { ELEMENT_TYPE_META, type Element, type ElementType } from "@folio/core";
import {
  Button,
  Checkbox,
  cn,
  EmptyState,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tag,
  Tooltip,
  toast,
} from "@folio/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Boxes, Combine, GitFork, Layers, List, Search, Sparkles, Table2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { DataGrid } from "@/components/DataGrid";
import { PanelShell, PanelTitle } from "@/components/Panel";
import { VirtualList } from "@/components/VirtualList";
import { useSelectedSourceIds } from "@/features/sources/hooks";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { ElementDetail } from "./ElementDetail";

const ElementGraph = lazy(() => import("./ElementGraph").then((m) => ({ default: m.ElementGraph })));

type View = "list" | "table" | "graph";

export function ElementsPanel({ notebookId, focus }: { notebookId: string; focus?: string }) {
  const { t } = useTranslation();
  const elements = useQuery({
    queryKey: qk.elements(notebookId),
    queryFn: () => api.elements.list(notebookId),
  });
  const sourceIds = useSelectedSourceIds(notebookId);
  const [view, setView] = useState<View>("list");
  const [types, setTypes] = useState<Set<ElementType>>(new Set());
  const [q, setQ] = useState(focus ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (focus) setQ(focus);
  }, [focus]);

  const all = elements.data ?? [];
  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return all
      .filter((e) => !types.size || types.has(e.type))
      .filter((e) => !ql || `${e.name} ${e.aliases.join(" ")} ${e.definition}`.toLowerCase().includes(ql))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }, [all, types, q]);
  const counts = useMemo(() => {
    const m = new Map<ElementType, number>();
    for (const e of all) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [all]);

  const extract = useMutation({
    mutationFn: () => api.elements.extract(notebookId, { sourceIds }),
    onSuccess: () => toast(t("elements.extract"), { description: "后台任务已开始，完成后自动刷新" }),
  });
  const merge = useMutation({
    mutationFn: () => {
      const ids = [...selected];
      return api.elements.merge(notebookId, ids, ids[0]!);
    },
    onSuccess: (el) => {
      setSelected(new Set());
      setOpenId(el.id);
      queryClient.invalidateQueries({ queryKey: qk.elements(notebookId) });
    },
  });
  const cards = useMutation({
    mutationFn: () => api.elements.cards(notebookId, [...selected]),
    onSuccess: (r) => {
      toast.success(t("studio.addedToReview", { count: r.length }));
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: qk.review(notebookId) });
    },
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const open = all.find((e) => e.id === openId);

  return (
    <PanelShell
      toolbar={
        <>
          <PanelTitle count={all.length}>{t("elements.title")}</PanelTitle>
          <div className="flex-1" />
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList className="h-7">
              <TabsTrigger value="list" className="h-6 px-1.5" aria-label={t("elements.list")}>
                <List />
              </TabsTrigger>
              <TabsTrigger value="table" className="h-6 px-1.5" aria-label={t("elements.table")}>
                <Table2 />
              </TabsTrigger>
              <TabsTrigger value="graph" className="h-6 px-1.5" aria-label={t("elements.graph")}>
                <GitFork />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tooltip content={t("elements.extractFrom")}>
            <Button
              variant="soft"
              size="sm"
              onClick={() => extract.mutate()}
              loading={extract.isPending}
              disabled={!sourceIds.length}
            >
              {extract.isPending ? null : <Sparkles />}
              {t("elements.extract")}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 px-2.5 pt-2 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("common.search")}
                className="h-7 pl-7 text-[13px]"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(ELEMENT_TYPE_META) as ElementType[])
                .filter((ty) => counts.get(ty))
                .map((ty) => {
                  const on = types.has(ty);
                  return (
                    <button
                      key={ty}
                      type="button"
                      onClick={() => {
                        const next = new Set(types);
                        on ? next.delete(ty) : next.add(ty);
                        setTypes(next);
                      }}
                      className={cn(
                        "rounded-sm transition-opacity focus-ring",
                        types.size && !on && "opacity-40",
                      )}
                    >
                      <Tag color={ELEMENT_TYPE_META[ty].color}>
                        {ELEMENT_TYPE_META[ty].label} {counts.get(ty)}
                      </Tag>
                    </button>
                  );
                })}
            </div>
          </div>
          {selected.size ? (
            <div className="mx-2.5 mb-2 flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs text-accent-soft-fg animate-fade">
              {t("elements.selected", { count: selected.size })}
              <span className="flex-1" />
              <Button
                size="xs"
                variant="ghost"
                disabled={selected.size < 2}
                onClick={() => merge.mutate()}
                loading={merge.isPending}
              >
                <Combine />
                {t("elements.merge")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => cards.mutate()} loading={cards.isPending}>
                <Layers />
                {t("elements.makeCards")}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            {elements.isLoading ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : all.length === 0 ? (
              <EmptyState
                className="h-full"
                icon={<Boxes />}
                title={t("elements.empty")}
                description={t("elements.emptyDesc")}
                action={
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => extract.mutate()}
                    disabled={!sourceIds.length}
                    loading={extract.isPending}
                  >
                    <Sparkles />
                    {t("elements.extractFrom")}
                  </Button>
                }
              />
            ) : view === "list" ? (
              <VirtualList
                className="h-full px-1.5 pb-2"
                items={list}
                estimate={58}
                getKey={(e) => e.id}
                render={(e) => (
                  <ElementRow
                    el={e}
                    checked={selected.has(e.id)}
                    onCheck={() => toggle(e.id)}
                    onOpen={() => setOpenId(e.id)}
                    active={openId === e.id}
                  />
                )}
              />
            ) : view === "table" ? (
              <div className="absolute inset-0">
                <DataGrid
                  rows={list.map((e) => ({ ...e, __id: e.id }) as never)}
                  onRowClick={(r) => setOpenId(r.__id)}
                  columns={[
                    {
                      id: "name",
                      name: "名称",
                      width: 160,
                      render: (r) => <span className="font-medium">{String(r.name)}</span>,
                    },
                    {
                      id: "type",
                      name: "类型",
                      width: 100,
                      render: (r) => (
                        <Tag color={ELEMENT_TYPE_META[r.type as ElementType].color}>
                          {ELEMENT_TYPE_META[r.type as ElementType].label}
                        </Tag>
                      ),
                    },
                    { id: "definition", name: t("elements.definition"), width: 340 },
                    {
                      id: "mastery",
                      name: t("elements.mastery"),
                      width: 110,
                      sortValue: (r) => Number(r.mastery),
                      render: (r) => <MasteryBar value={Number(r.mastery)} />,
                    },
                    {
                      id: "refs",
                      name: t("elements.refs"),
                      width: 80,
                      sortValue: (r) => (r.refs as unknown[]).length,
                      render: (r) => <span className="tabular-nums">{(r.refs as unknown[]).length}</span>,
                    },
                  ]}
                />
              </div>
            ) : (
              <Suspense fallback={<div className="skeleton m-4 h-60" />}>
                <ElementGraph elements={list} onOpen={setOpenId} activeId={openId} />
              </Suspense>
            )}
          </div>
        </div>
        {open ? (
          <ElementDetail
            key={open.id}
            el={open}
            notebookId={notebookId}
            all={all}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </div>
    </PanelShell>
  );
}

function ElementRow({
  el,
  checked,
  onCheck,
  onOpen,
  active,
}: {
  el: Element;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  active: boolean;
}) {
  const meta = ELEMENT_TYPE_META[el.type];
  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-surface-hover",
        active && "bg-surface-hover",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onCheck}
        className={cn("mt-0.5", !checked && "opacity-0 group-hover:opacity-100")}
        aria-label={el.name}
      />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus-ring rounded">
        <div className="flex items-center gap-1.5">
          <Tag color={meta.color}>{meta.label}</Tag>
          <span className="truncate text-[13.5px] font-medium">{el.name}</span>
          <span className="ml-auto shrink-0">
            <MasteryBar value={el.mastery} compact />
          </span>
        </div>
        {el.definition ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-subtle">{el.definition}</p>
        ) : null}
      </button>
    </div>
  );
}

export function MasteryBar({ value, compact }: { value: number; compact?: boolean }) {
  const pct = Math.round(value * 100);
  const hue = 25 + value * 130;
  return (
    <span className="inline-flex items-center gap-1.5" title={`掌握度 ${pct}%`}>
      <span
        className={cn("overflow-hidden rounded-full bg-surface-sunken", compact ? "h-1 w-8" : "h-1.5 w-14")}
      >
        <span
          className="block h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(4, pct)}%`, background: `oklch(0.68 0.15 ${hue})` }}
        />
      </span>
      {compact ? null : <span className="text-[11px] tabular-nums text-fg-subtle">{pct}%</span>}
    </span>
  );
}
