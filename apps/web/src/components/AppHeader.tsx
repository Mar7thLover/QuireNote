import { Button, cn, Shortcut, Tooltip } from "@folio/ui";
import { Link } from "@tanstack/react-router";
import { Languages, Moon, Search, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { currentLang, setLang, useTranslation } from "@/i18n";
import { SHORTCUTS } from "@/lib/hotkeys";
import { resolvedMode, useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2 rounded-md focus-ring", className)}
      aria-label="Folio"
    >
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="oklch(0.6 0.19 var(--accent-h))" />
            <stop offset="1" stopColor="oklch(0.55 0.2 calc(var(--accent-h) + 30))" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
        <path
          d="M10 8h9.5a2.5 2.5 0 0 1 0 5H14v3h4.5a2 2 0 0 1 0 4H14v4.5a1.5 1.5 0 0 1-3 0V9a1 1 0 0 1 1-1z"
          fill="#fff"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Folio</span>
    </Link>
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const mode = useTheme((s) => s.mode);
  const set = useTheme((s) => s.set);
  const dark = resolvedMode(mode) === "dark";
  return (
    <Tooltip content={t("command.toggleTheme")} shortcut={SHORTCUTS.toggleTheme}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => set({ mode: dark ? "light" : "dark" })}
        aria-label={t("command.toggleTheme")}
      >
        {dark ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}

export function PaletteTrigger({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => useUi.getState().openPalette()}
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg border border-border bg-surface/70 pr-1.5 pl-2.5 text-[13px] text-fg-subtle",
        "transition-colors hover:border-border-strong hover:text-fg-muted focus-ring",
        className,
      )}
    >
      <Search className="size-3.5" />
      <span className="flex-1 truncate text-left">{t("command.placeholder")}</span>
      <Shortcut keys={SHORTCUTS.palette} />
    </button>
  );
}

export function AppHeader({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3 sm:px-4">
      <Logo />
      {left}
      <div className="flex-1" />
      <PaletteTrigger className="hidden w-80 md:flex" />
      <div className="flex-1" />
      {right}
      <Tooltip content={currentLang() === "zh" ? "English" : "中文"}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setLang(currentLang() === "zh" ? "en" : "zh")}
          aria-label="language"
        >
          <Languages />
        </Button>
      </Tooltip>
      <ThemeToggle />
      <Tooltip content={t("common.settings")}>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/settings/$section" params={{ section: "appearance" }} aria-label={t("common.settings")}>
            <Settings />
          </Link>
        </Button>
      </Tooltip>
    </header>
  );
}
