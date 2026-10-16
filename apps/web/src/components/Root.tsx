import { Toaster, TooltipProvider } from "@quirenote/ui";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { initNative } from "@/features/mobile/native";
import { ServerOnboarding, ShareInbox } from "@/features/mobile/ShareInbox";
import { syncRenderSettings } from "@/features/render/store";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { SHORTCUTS, useHotkeys } from "@/lib/hotkeys";
import { subscribeServerEvents } from "@/lib/query";
import { resolvedMode, useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { AgentDiffDialog } from "./AgentDiffDialog";
import { CommandPalette } from "./CommandPalette";
import { NewNotebookDialog } from "./NewNotebookDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function Root({ children }: { children: ReactNode }) {
  const mode = useTheme((s) => s.mode);
  const setTheme = useTheme((s) => s.set);
  const ui = useUi();

  useEffect(() => subscribeServerEvents(), []);
  useEffect(() => {
    syncRenderSettings();
    let dispose: (() => void) | undefined;
    initNative().then((d) => {
      dispose = d;
    });
    return () => dispose?.();
  }, []);

  useHotkeys({
    [SHORTCUTS.palette]: () => (ui.paletteOpen ? ui.closePalette() : ui.openPalette()),
    [SHORTCUTS.toggleTheme]: () => setTheme({ mode: resolvedMode(mode) === "dark" ? "light" : "dark" }),
    [SHORTCUTS.help]: () => ui.set({ shortcutsOpen: !ui.shortcutsOpen }),
  });

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="app-bg" aria-hidden />
      <div className="relative z-[1] flex h-full flex-col">
        <ConnectionBanner />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
      <AgentDiffDialog />
      <NewNotebookDialog />
      <ShareInbox />
      <ServerOnboarding />
      <Toaster
        theme={resolvedMode(mode)}
        position="bottom-right"
        toastOptions={{
          className: "!rounded-lg !border-border !bg-surface-raised !text-fg !shadow-lg !font-sans",
        }}
      />
    </TooltipProvider>
  );
}

function useOnline() {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

/** 浏览器离线或服务器不可达时，顶部给一条细提示。 */
function ConnectionBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: (q) => (q.state.status === "error" ? 5000 : 60_000),
    retry: false,
    networkMode: "always",
  });
  const down = !online || health.isError;
  if (!down) return null;
  return (
    <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-border bg-warning-soft text-xs font-medium text-fg-muted animate-fade">
      <WifiOff className="size-3.5" />
      {online ? t("common.serverDown") : t("common.offline")}
    </div>
  );
}
