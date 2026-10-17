import type { Notebook } from "@quirenote/core";
import { Button, cn, Sheet } from "@quirenote/ui";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Boxes,
  ChevronLeft,
  Database,
  Ellipsis,
  Globe,
  LibraryBig,
  type LucideIcon,
  MessagesSquare,
  NotebookPen,
  PenLine,
  Repeat,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useState } from "react";
import { ThemeToggle } from "@/components/AppHeader";
import { useTranslation } from "@/i18n";
import { useUi } from "@/stores/ui";
import { type PanelKind, type PanelSpec, registerMobileOpen } from "@/stores/workspace";
import { PANEL_BODIES, PanelFallback } from "../panels";

const TABS: { kind: PanelKind; icon: LucideIcon }[] = [
  { kind: "sources", icon: BookOpen },
  { kind: "chat", icon: MessagesSquare },
  { kind: "notes", icon: NotebookPen },
  { kind: "studio", icon: Sparkles },
];

const MORE: { kind: PanelKind; icon: LucideIcon }[] = [
  { kind: "writing", icon: PenLine },
  { kind: "elements", icon: Boxes },
  { kind: "review", icon: Repeat },
  { kind: "database", icon: Database },
  { kind: "lorebook", icon: LibraryBig },
  { kind: "search", icon: Globe },
];

/** 移动端：底部导航 + 详情页推入栈，手感接近原生应用。 */
export function MobileWorkspace({ notebookId, notebook }: { notebookId: string; notebook?: Notebook }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PanelKind>("chat");
  const [stack, setStack] = useState<PanelSpec[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    registerMobileOpen((spec) => {
      if (TABS.some((x) => x.kind === spec.kind) || MORE.some((x) => x.kind === spec.kind)) {
        setStack([]);
        setTab(spec.kind);
      } else setStack((s) => [...s.filter((x) => !(x.kind === spec.kind && x.id === spec.id)), spec]);
    });
    return () => registerMobileOpen(null);
  }, []);

  const Body = PANEL_BODIES[tab];
  const top = stack.at(-1);
  const TopBody = top ? PANEL_BODIES[top.kind] : null;

  return (
    <div className="flex h-full flex-col bg-surface" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t("nav.home")}>
            <ChevronLeft />
          </Link>
        </Button>
        <span className="text-lg">{notebook?.icon}</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{notebook?.title}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useUi.getState().openPalette()}
          aria-label={t("common.search")}
        >
          <Search />
        </Button>
        <ThemeToggle />
      </header>
      <main className="relative min-h-0 flex-1">
        <Suspense fallback={<PanelFallback />}>
          <Body notebookId={notebookId} />
        </Suspense>
        <AnimatePresence>
          {top && TopBody ? (
            <motion.div
              key={`${top.kind}:${top.id}`}
              className="absolute inset-0 z-10 flex flex-col bg-surface"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-1.5">
                <Button variant="ghost" size="sm" onClick={() => setStack((s) => s.slice(0, -1))}>
                  <ChevronLeft />
                  {t("common.back")}
                </Button>
                <span className="truncate text-[13px] font-medium text-fg-muted">{top.title}</span>
              </div>
              <div className="min-h-0 flex-1">
                <Suspense fallback={<PanelFallback />}>
                  <TopBody notebookId={notebookId} id={top.id} extra={top.extra} />
                </Suspense>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
      <nav
        className="grid shrink-0 grid-cols-5 border-t border-border bg-surface/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((x) => (
          <NavButton
            key={x.kind}
            icon={x.icon}
            label={t(`nav.${x.kind}`)}
            active={tab === x.kind && !top}
            onClick={() => {
              setStack([]);
              setTab(x.kind);
            }}
          />
        ))}
        <NavButton
          icon={Ellipsis}
          label={t("nav.more")}
          active={MORE.some((m) => m.kind === tab) && !top}
          onClick={() => setMoreOpen(true)}
        />
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title={t("nav.more")}>
        <div className="grid grid-cols-3 gap-2 p-4 pb-8">
          {MORE.map((m) => (
            <button
              key={m.kind}
              type="button"
              className="flex flex-col items-center gap-2 rounded-xl bg-surface-sunken py-4 text-[13px] active:scale-95"
              onClick={() => {
                setMoreOpen(false);
                setStack([]);
                setTab(m.kind);
              }}
            >
              <m.icon className="size-5 text-fg-muted" />
              {t(`nav.${m.kind}`)}
            </button>
          ))}
          <Link
            to="/settings/$section"
            params={{ section: "appearance" }}
            className="flex flex-col items-center gap-2 rounded-xl bg-surface-sunken py-4 text-[13px] active:scale-95"
          >
            <Settings className="size-5 text-fg-muted" />
            {t("nav.settings")}
          </Link>
        </div>
      </Sheet>
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors",
        active ? "text-accent" : "text-fg-subtle",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </button>
  );
}
