import type { Notebook } from "@quirenote/core";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Shortcut,
  Tooltip,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
  themeLightSpaced,
} from "dockview-react";
import {
  BookOpen,
  Boxes,
  ChevronLeft,
  Database,
  Globe,
  LayoutTemplate,
  Loader2,
  type LucideIcon,
  Maximize2,
  MessagesSquare,
  Minimize2,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
} from "lucide-react";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PaletteTrigger, ThemeToggle } from "@/components/AppHeader";
import { MobileWorkspace } from "@/features/mobile/MobileWorkspace";
import { createNote } from "@/features/notes/actions";
import { PANEL_COMPONENTS } from "@/features/panels";
import { AddSourceDialog } from "@/features/sources/AddSourceDialog";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { SHORTCUTS, useHotkeys } from "@/lib/hotkeys";
import { qk, upsertInList } from "@/lib/query";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useUi } from "@/stores/ui";
import {
  applyPreset,
  loadCustomPresets,
  loadLayout,
  type PanelKind,
  type PanelParams,
  type PresetId,
  retargetLayout,
  saveCustomPresets,
  saveLayout,
  useWorkspace,
} from "@/stores/workspace";

const quirenoteTheme = { ...themeLightSpaced, name: "quirenote", gap: 6 };
const GROUP_MIN_WIDTH = 300;
const GROUP_MIN_HEIGHT = 180;

const ACTIVITY: { kind: PanelKind; icon: LucideIcon; shortcut?: string }[] = [
  { kind: "sources", icon: BookOpen, shortcut: SHORTCUTS.openSources },
  { kind: "chat", icon: MessagesSquare, shortcut: SHORTCUTS.focusChat },
  { kind: "notes", icon: NotebookPen, shortcut: SHORTCUTS.openNotes },
  { kind: "studio", icon: Sparkles, shortcut: SHORTCUTS.openStudio },
  { kind: "elements", icon: Boxes },
  { kind: "database", icon: Database },
  { kind: "review", icon: Repeat },
  { kind: "search", icon: Globe, shortcut: SHORTCUTS.search },
];

export function WorkspacePage({ notebookId }: { notebookId: string }) {
  const notebook = useQuery({
    queryKey: qk.notebook(notebookId),
    queryFn: () => api.notebooks.get(notebookId),
  });
  const mobile = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    useWorkspace.setState({ notebookId });
  }, [notebookId]);

  return (
    <>
      {mobile ? (
        <MobileWorkspace notebookId={notebookId} notebook={notebook.data} />
      ) : (
        <DesktopWorkspace notebookId={notebookId} notebook={notebook.data} />
      )}
      <AddSourceDialog notebookId={notebookId} />
    </>
  );
}

function DesktopWorkspace({ notebookId, notebook }: { notebookId: string; notebook?: Notebook }) {
  const { t } = useTranslation();
  const focusMode = useUi((s) => s.focusMode);
  const dockApi = useWorkspace((s) => s.api);
  const open = useWorkspace((s) => s.open);

  const openKind = (kind: PanelKind) => open({ kind, title: t(`nav.${kind}`) });

  // dockview 只回调一次 onReady；StrictMode 重新挂载时要从 ref 恢复 api
  const apiRef = useRef<DockviewApi | null>(null);
  useEffect(() => {
    if (apiRef.current) useWorkspace.getState().setApi(apiRef.current, notebookId);
    return () => useWorkspace.getState().setApi(null, null);
  }, [notebookId]);

  useHotkeys({
    [SHORTCUTS.openSources]: () => openKind("sources"),
    [SHORTCUTS.openNotes]: () => openKind("notes"),
    [SHORTCUTS.openStudio]: () => openKind("studio"),
    [SHORTCUTS.search]: () => openKind("search"),
    [SHORTCUTS.focusChat]: () => {
      openKind("chat");
      setTimeout(() => document.querySelector<HTMLTextAreaElement>("[data-chat-input]")?.focus(), 50);
    },
    [SHORTCUTS.newNote]: () => createNote(notebookId),
    [SHORTCUTS.addSource]: () => useUi.getState().openAddSource(),
    [SHORTCUTS.toggleFocus]: () => useUi.getState().toggleFocus(),
    Escape: () => useUi.getState().focusMode && useUi.getState().set({ focusMode: false }),
  });

  // 专注模式：隐藏外框，最大化当前面板组
  useEffect(() => {
    if (!dockApi) return;
    if (focusMode && dockApi.activePanel) dockApi.maximizeGroup(dockApi.activePanel);
    else if (!focusMode && dockApi.hasMaximizedGroup()) dockApi.exitMaximizedGroup();
  }, [focusMode, dockApi]);

  const onReady = useCallback(
    (e: DockviewReadyEvent) => {
      const saved = loadLayout(notebookId);
      let restored = false;
      if (saved) {
        try {
          e.api.fromJSON(saved);
          restored = e.api.panels.length > 0;
        } catch {
          restored = false;
        }
      }
      if (!restored) applyPreset(e.api, notebookId, "research", t);
      // 面板组设最小尺寸：拖拽或恢复旧布局时不会被挤成一条（对话输入框等会变形）。
      const constrain = (g: {
        api: { setConstraints: (c: { minimumWidth: number; minimumHeight: number }) => void };
      }) => g.api.setConstraints({ minimumWidth: GROUP_MIN_WIDTH, minimumHeight: GROUP_MIN_HEIGHT });
      for (const g of e.api.groups) constrain(g);
      e.api.onDidAddGroup(constrain);
      e.api.onDidLayoutChange(() => saveLayout(notebookId, e.api.toJSON()));
      apiRef.current = e.api;
      useWorkspace.getState().setApi(e.api, notebookId);
    },
    [notebookId, t],
  );

  const components = useMemo(
    () => PANEL_COMPONENTS as Record<string, FC<IDockviewPanelProps<PanelParams>>>,
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {focusMode ? null : <WorkspaceHeader notebook={notebook} notebookId={notebookId} />}
      <div className="flex min-h-0 flex-1">
        {focusMode ? null : <WorkspaceSidebar onOpen={openKind} />}
        <div
          className={cn(
            "quirenote-dock relative min-w-0 flex-1 overflow-hidden",
            focusMode ? "p-3.5" : "pt-1.5 pr-3 pb-3 pl-1.5",
          )}
        >
          <DockviewReact
            className="dockview-theme-light-spaced"
            theme={quirenoteTheme}
            components={components}
            onReady={onReady}
            watermarkComponent={Watermark}
          />
          {focusMode ? (
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-4 right-5 z-10 shadow-md"
              onClick={() => useUi.getState().set({ focusMode: false })}
            >
              <Minimize2 />
              {t("workspace.exitFocus")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 工作区侧栏：展开时图标 + 名称，收起时只有图标（悬停显示名称）。底部是设置与收起按钮。 */
function WorkspaceSidebar({ onOpen }: { onOpen: (kind: PanelKind) => void }) {
  const { t } = useTranslation();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  return (
    <nav
      aria-label={t("nav.panels")}
      className={cn(
        "flex shrink-0 flex-col gap-0.5 pt-1.5 pb-3 transition-[width] duration-200",
        collapsed ? "w-14 items-center px-1.5" : "w-48 px-2",
      )}
    >
      {collapsed ? null : (
        <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-fg-subtle">
          {t("nav.panels")}
        </p>
      )}
      {ACTIVITY.map((a) => (
        <ActivityButton
          key={a.kind}
          kind={a.kind}
          icon={a.icon}
          shortcut={a.shortcut}
          collapsed={collapsed}
          onClick={() => onOpen(a.kind)}
        />
      ))}
      <div className="flex-1" />
      <SidebarItem collapsed={collapsed} icon={Settings} label={t("nav.settings")} asLink />
      <SidebarItem
        collapsed={collapsed}
        icon={collapsed ? PanelLeftOpen : PanelLeftClose}
        label={collapsed ? t("nav.expand") : t("nav.collapse")}
        onClick={() => useUi.getState().toggleSidebar()}
      />
    </nav>
  );
}

const sidebarRow =
  "relative flex h-9 items-center gap-2.5 rounded-lg text-[13.5px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring";

function SidebarItem({
  collapsed,
  icon: Icon,
  label,
  onClick,
  asLink,
}: {
  collapsed: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  asLink?: boolean;
}) {
  const cls = cn(sidebarRow, collapsed ? "w-10 justify-center" : "w-full px-2.5");
  const body = (
    <>
      <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </>
  );
  const el = asLink ? (
    <Link to="/settings" className={cls} aria-label={label}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-label={label}>
      {body}
    </button>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {el}
    </Tooltip>
  ) : (
    el
  );
}

function ActivityButton({
  kind,
  icon: Icon,
  shortcut,
  collapsed,
  onClick,
}: {
  kind: PanelKind;
  icon: LucideIcon;
  shortcut?: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const api = useWorkspace((s) => s.api);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!api) return;
    const check = () => setActive(!!api.getPanel(kind));
    check();
    const d1 = api.onDidAddPanel(check);
    const d2 = api.onDidRemovePanel(check);
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [api, kind]);
  const label = t(`nav.${kind}`);
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={cn(
        sidebarRow,
        "group",
        collapsed ? "w-10 justify-center" : "w-full px-2.5",
        active && "bg-surface-hover/70 font-medium text-fg",
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.1 : 1.8} />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          {shortcut ? (
            // 只在悬停时占位，平时把宽度留给名称。
            <Shortcut
              keys={shortcut}
              className="hidden group-hover:inline-flex [&_kbd]:border-0 [&_kbd]:bg-transparent"
            />
          ) : null}
        </>
      )}
      {active ? <span className="absolute top-2.5 -left-2 h-4 w-[3px] rounded-full bg-accent" /> : null}
    </button>
  );
  return collapsed ? (
    <Tooltip content={label} shortcut={shortcut} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function Watermark(_: IWatermarkPanelProps) {
  const { t } = useTranslation();
  const api = useWorkspace((s) => s.api);
  const nb = useWorkspace((s) => s.notebookId);
  return (
    <div className="grid h-full place-items-center bg-surface">
      <div className="text-center">
        <p className="text-sm text-fg-muted">从左侧活动栏打开面板，或选择一个布局预设</p>
        <div className="mt-3 flex justify-center gap-2">
          {(["research", "write", "study"] as const).map((p) => (
            <Button key={p} size="sm" onClick={() => api && nb && applyPreset(api, nb, p, t)}>
              {t(`workspace.preset_${p}`)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceHeader({ notebook, notebookId }: { notebook?: Notebook; notebookId: string }) {
  const { t } = useTranslation();
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 pr-3 pl-1.5">
      <Tooltip content={t("nav.home")} side="bottom">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t("nav.home")}>
            <ChevronLeft />
          </Link>
        </Button>
      </Tooltip>
      <NotebookTitle notebook={notebook} notebookId={notebookId} />
      <div className="flex-1" />
      <PaletteTrigger className="w-72 lg:w-96" />
      <div className="flex-1" />
      <JobsIndicator notebookId={notebookId} />
      <LayoutMenu notebookId={notebookId} />
      <Tooltip content={t("workspace.focusMode")} shortcut={SHORTCUTS.toggleFocus} side="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useUi.getState().toggleFocus()}
          aria-label={t("workspace.focusMode")}
        >
          <Maximize2 />
        </Button>
      </Tooltip>
      <Separator vertical className="mx-1" />
      <ThemeToggle />
    </header>
  );
}

function NotebookTitle({ notebook, notebookId }: { notebook?: Notebook; notebookId: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const rename = useMutation({
    mutationFn: (title: string) => api.notebooks.update(notebookId, { title }),
    onSuccess: (nb) => {
      upsertInList(qk.notebooks, nb);
      useWorkspace.getState();
    },
  });
  if (!notebook) return <div className="skeleton h-5 w-40" />;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-lg leading-none">{notebook.icon}</span>
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value.trim() && value !== notebook.title) rename.mutate(value.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 w-64 rounded-md border border-accent bg-surface px-2 text-[14px] font-semibold outline-none ring-3 ring-ring/30"
        />
      ) : (
        <button
          type="button"
          className="truncate rounded-md px-1.5 py-0.5 text-[14px] font-semibold tracking-tight hover:bg-surface-hover focus-ring"
          onClick={() => {
            setValue(rename.variables ?? notebook.title);
            setEditing(true);
          }}
        >
          {rename.isPending ? rename.variables : notebook.title}
        </button>
      )}
    </div>
  );
}

function JobsIndicator({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const jobs = useQuery({ queryKey: qk.jobs, queryFn: () => api.jobs(notebookId), refetchInterval: 15_000 });
  const active = (jobs.data ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const recent = (jobs.data ?? []).slice(0, 8);
  return (
    <Popover>
      <Tooltip content={t("workspace.jobs")} side="bottom">
        <PopoverTrigger asChild>
          <Button variant="ghost" size={active.length ? "sm" : "icon-sm"} aria-label={t("workspace.jobs")}>
            <Loader2 className={cn(active.length ? "animate-spin text-accent" : "text-fg-subtle")} />
            {active.length ? <span className="tabular-nums">{active.length}</span> : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-1.5">
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle">{t("workspace.jobs")}</p>
        {recent.length === 0 ? (
          <p className="px-2 py-4 text-center text-[13px] text-fg-subtle">{t("workspace.noJobs")}</p>
        ) : (
          recent.map((j) => (
            <div key={j.id} className="rounded-md px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate">{j.message || j.type}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    j.status === "error"
                      ? "text-danger"
                      : j.status === "done"
                        ? "text-success"
                        : "text-fg-subtle",
                  )}
                >
                  {j.status === "running" ? `${Math.round(j.progress * 100)}%` : j.status}
                </span>
              </div>
              {j.status === "running" || j.status === "queued" ? (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${j.progress * 100}%` }}
                  />
                </div>
              ) : null}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

function LayoutMenu({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const api = useWorkspace((s) => s.api);
  const [custom, setCustom] = useState(loadCustomPresets);
  const apply = (p: PresetId) => {
    if (!api) return;
    if (p === "focus") {
      useUi.getState().set({ focusMode: true });
      return;
    }
    applyPreset(api, notebookId, p, t);
  };
  return (
    <DropdownMenu>
      <Tooltip content={t("workspace.presets")} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("workspace.presets")}>
            <LayoutTemplate />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("workspace.presets")}</DropdownMenuLabel>
        {(["research", "write", "study", "focus"] as const).map((p) => (
          <DropdownMenuItem key={p} onSelect={() => apply(p)}>
            <PresetGlyph preset={p} />
            {t(`workspace.preset_${p}`)}
          </DropdownMenuItem>
        ))}
        {custom.length ? <DropdownMenuSeparator /> : null}
        {custom.map((c) => (
          <DropdownMenuItem key={c.name} onSelect={() => api?.fromJSON(retargetLayout(c.layout, notebookId))}>
            <LayoutTemplate />
            {c.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            if (!api) return;
            const name = prompt(t("workspace.layoutName"))?.trim();
            if (!name) return;
            const next = [...custom.filter((c) => c.name !== name), { name, layout: api.toJSON() }];
            saveCustomPresets(next);
            setCustom(next);
            toast.success(name);
          }}
        >
          <Save />
          {t("workspace.saveLayout")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => apply("research")}>
          <RotateCcw />
          {t("workspace.resetLayout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 预设的迷你示意图。 */
function PresetGlyph({ preset }: { preset: PresetId }) {
  const cols = { research: [3, 5, 4], write: [3, 6, 3], study: [3, 5, 4], focus: [12] }[preset];
  return (
    <span className="flex h-3.5 w-5 gap-px overflow-hidden rounded-[3px] border border-fg-subtle/60 p-px">
      {cols.map((c, i) => (
        <span key={i} className="rounded-[1px] bg-fg-subtle/50" style={{ flex: c }} />
      ))}
    </span>
  );
}
