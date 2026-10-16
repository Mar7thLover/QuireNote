import type { Notebook } from "@quirenote/core";
import { cn, Kbd, Tooltip } from "@quirenote/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Brain,
  ChevronDown,
  Database,
  House,
  Info,
  Keyboard,
  Languages,
  LayoutTemplate,
  type LucideIcon,
  Moon,
  NotebookText,
  Palette,
  PanelLeft,
  Regex,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { currentLang, setLang, useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import { resolvedMode, useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";

export const SETTINGS_SECTIONS: { id: string; icon: LucideIcon }[] = [
  { id: "models", icon: Brain },
  { id: "appearance", icon: Palette },
  { id: "templates", icon: LayoutTemplate },
  { id: "rules", icon: Regex },
  { id: "data", icon: Database },
  { id: "shortcuts", icon: Keyboard },
  { id: "about", icon: Info },
];

const row =
  "relative flex h-9 w-full items-center gap-2.5 rounded-lg text-[14px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring";
const active = "bg-surface-hover font-medium text-fg";
const subRow =
  "flex h-8 w-full items-center rounded-lg pr-2.5 pl-[38px] text-[13.5px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring";

/** 侧栏一行：展开时图标 + 名称；收起时只有图标，悬停显示名称。 */
function Item({
  collapsed,
  icon: Icon,
  label,
  isActive,
  to,
  params,
  onClick,
  trailing,
}: {
  collapsed: boolean;
  icon: LucideIcon;
  label: string;
  isActive?: boolean;
  to?: string;
  params?: Record<string, string>;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const cls = cn(row, collapsed ? "w-10 justify-center" : "px-2.5", isActive && active);
  const body = (
    <>
      <Icon className="size-[18px] shrink-0" strokeWidth={1.6} />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {collapsed ? null : trailing}
    </>
  );
  const el = to ? (
    // biome-ignore lint/suspicious/noExplicitAny: 路由参数由调用方保证
    <Link to={to as any} params={params as any} className={cls} aria-label={collapsed ? label : undefined}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-label={collapsed ? label : undefined}>
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

/** 可展开的分组（Notebook、设置）。收起侧栏时只剩图标，点击直达。 */
function Group({
  collapsed,
  icon,
  label,
  isActive,
  to,
  params,
  defaultOpen,
  children,
}: {
  collapsed: boolean;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  to: string;
  params?: Record<string, string>;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (collapsed)
    return <Item collapsed icon={icon} label={label} isActive={isActive} to={to} params={params} />;
  return (
    <div className="flex flex-col gap-0.5">
      <Item
        collapsed={false}
        icon={icon}
        label={label}
        onClick={() => setOpen((o) => !o)}
        trailing={
          <ChevronDown
            className={cn("size-4 shrink-0 text-fg-subtle transition-transform", !open && "-rotate-90")}
            strokeWidth={1.6}
          />
        }
      />
      {open ? <div className="flex flex-col gap-0.5">{children}</div> : null}
    </div>
  );
}

/**
 * 应用常驻侧栏（首页、设置、工作区共用）：字标与收起、搜索、首页、Notebook 列表、
 * 当前工作区的面板（由 panels 传入）、设置分组；底部是深浅色、语言。
 */
export function AppSidebar({
  notebookId,
  panels,
  className,
}: {
  notebookId?: string;
  panels?: (collapsed: boolean) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list });
  const mode = useTheme((s) => s.mode);
  const setTheme = useTheme((s) => s.set);
  const dark = resolvedMode(mode) === "dark";
  const inSettings = path.startsWith("/settings");
  const settingsSection = inSettings ? (path.split("/")[2] ?? "models") : null;
  const list: Notebook[] = [...(notebooks.data ?? [])].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-bg-subtle",
        collapsed ? "w-14 items-center px-2" : "w-[248px] px-3",
        className,
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "gap-2 pl-1.5")}>
        {collapsed ? null : (
          <Link to="/" className="flex-1 truncate rounded-md font-serif text-[19px] font-medium focus-ring">
            QuireNote
          </Link>
        )}
        <Tooltip content={collapsed ? t("nav.expand") : t("nav.collapse")} side="right">
          <button
            type="button"
            onClick={() => useUi.getState().toggleSidebar()}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="grid size-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
          >
            <PanelLeft className="size-[18px]" strokeWidth={1.6} />
          </button>
        </Tooltip>
      </div>

      {collapsed ? (
        <Item
          collapsed
          icon={Search}
          label={t("nav.searchCommand")}
          onClick={() => useUi.getState().openPalette()}
        />
      ) : (
        <button
          type="button"
          onClick={() => useUi.getState().openPalette()}
          className="mb-2 flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13.5px] text-fg-subtle hover:border-border-strong focus-ring"
        >
          <Search className="size-4 shrink-0" strokeWidth={1.6} />
          <span className="flex-1 truncate text-left">{t("nav.searchCommand")}</span>
          <span className="flex gap-0.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      )}

      <nav
        aria-label={t("nav.main")}
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col gap-0.5 overflow-y-auto",
          collapsed && "items-center",
        )}
      >
        <Item collapsed={collapsed} icon={House} label={t("nav.home")} to="/" isActive={path === "/"} />
        <Group
          collapsed={collapsed}
          icon={NotebookText}
          label={t("nav.notebooks")}
          to="/"
          isActive={!!notebookId}
          defaultOpen
        >
          {list.slice(0, 12).map((nb) => (
            <Link
              key={nb.id}
              to="/n/$notebookId"
              params={{ notebookId: nb.id }}
              className={cn(subRow, nb.id === notebookId && active)}
            >
              <span className="truncate">{nb.title}</span>
            </Link>
          ))}
        </Group>

        {panels ? (
          <>
            {collapsed ? (
              <div className="my-2 h-px w-6 bg-border" />
            ) : (
              <p className="px-2.5 pt-4 pb-1 text-[12px] text-fg-subtle">{t("nav.panels")}</p>
            )}
            {panels(collapsed)}
          </>
        ) : null}
      </nav>

      <div
        className={cn(
          "flex w-full shrink-0 flex-col gap-0.5 border-t border-border py-3",
          collapsed && "items-center",
        )}
      >
        <Group
          collapsed={collapsed}
          icon={Settings}
          label={t("nav.settings")}
          to="/settings"
          isActive={inSettings}
          defaultOpen={inSettings}
        >
          {SETTINGS_SECTIONS.map((s) => (
            <Link
              key={s.id}
              to="/settings/$section"
              params={{ section: s.id }}
              className={cn(subRow, settingsSection === s.id && active)}
            >
              <span className="truncate">{t(`settings.${s.id}`)}</span>
            </Link>
          ))}
        </Group>
        <Item
          collapsed={collapsed}
          icon={dark ? Sun : Moon}
          label={dark ? t("nav.lightMode") : t("nav.darkMode")}
          onClick={() => setTheme({ mode: dark ? "light" : "dark" })}
        />
        <Item
          collapsed={collapsed}
          icon={Languages}
          label={currentLang() === "zh" ? "English" : "中文"}
          onClick={() => setLang(currentLang() === "zh" ? "en" : "zh")}
        />
      </div>
    </aside>
  );
}

/** 页面骨架：左侧常驻侧栏（桌面），右侧内容。 */
export function AppShell({
  children,
  notebookId,
  panels,
  hideSidebar,
}: {
  children: ReactNode;
  notebookId?: string;
  panels?: (collapsed: boolean) => ReactNode;
  hideSidebar?: boolean;
}) {
  return (
    <div className="flex h-full">
      {hideSidebar ? null : <AppSidebar notebookId={notebookId} panels={panels} className="hidden md:flex" />}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
