import { Button, cn, Shortcut, Tooltip } from "@quirenote/ui";
import { Link } from "@tanstack/react-router";
import { Languages, Moon, Search, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { currentLang, setLang, useTranslation } from "@/i18n";
import { SHORTCUTS } from "@/lib/hotkeys";
import { resolvedMode, useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("rounded-md font-serif text-[19px] font-medium focus-ring", className)}>
      QuireNote
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
      <Button variant="ghost" size="sm" asChild>
        <Link to="/settings">
          <Settings />
          {t("common.settings")}
        </Link>
      </Button>
    </header>
  );
}
