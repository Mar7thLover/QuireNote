import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  Kbd,
  Spinner,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Boxes,
  Brain,
  Database,
  FileInput,
  FilePlus2,
  FileText,
  Globe,
  Home,
  Keyboard,
  Languages,
  LayoutPanelLeft,
  LibraryBig,
  MessagesSquare,
  NotebookPen,
  PenLine,
  Plus,
  Repeat,
  Settings,
  Sparkles,
  SunMoon,
  Target,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { pickCardFile } from "@/features/cards/CardDialogs";
import { createNote } from "@/features/notes/actions";
import { currentLang, setLang, useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { SHORTCUTS } from "@/lib/hotkeys";
import { qk } from "@/lib/query";
import { resolvedMode, useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { type PanelKind, useWorkspace } from "@/stores/workspace";

const PANELS: { kind: PanelKind; icon: typeof BookOpen; shortcut?: string }[] = [
  { kind: "sources", icon: BookOpen, shortcut: SHORTCUTS.openSources },
  { kind: "chat", icon: MessagesSquare, shortcut: SHORTCUTS.focusChat },
  { kind: "notes", icon: NotebookPen, shortcut: SHORTCUTS.openNotes },
  { kind: "writing", icon: PenLine },
  { kind: "studio", icon: Sparkles, shortcut: SHORTCUTS.openStudio },
  { kind: "elements", icon: Boxes },
  { kind: "database", icon: Database },
  { kind: "review", icon: Repeat },
  { kind: "lorebook", icon: LibraryBig },
  { kind: "search", icon: Globe, shortcut: SHORTCUTS.search },
];

export function CommandPalette() {
  const { t } = useTranslation();
  const open = useUi((s) => s.paletteOpen);
  const seed = useUi((s) => s.paletteSeed);
  const close = useUi((s) => s.closePalette);
  const navigate = useNavigate();
  const notebookId = useWorkspace((s) => s.notebookId);
  const [value, setValue] = useState("");
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list, enabled: open });
  const overview = useQuery({ queryKey: qk.overview, queryFn: api.overview, enabled: open });
  const recent = (overview.data?.recent ?? []).filter((n) => n.openedAt).slice(0, 5);

  useEffect(() => {
    if (open) setValue(seed);
  }, [open, seed]);

  const ai = useMutation({
    mutationFn: (instruction: string) => api.ai.command(notebookId!, instruction),
    onSuccess: (proposal) => {
      close();
      if (!proposal.ops.length) toast(proposal.summary || "AI 没有提出改动");
      else useUi.getState().set({ proposal: { notebookId: notebookId!, proposal } });
    },
  });

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const theme = useTheme();
  const text = value.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent hideClose className="top-[16vh] max-w-[640px] overflow-hidden rounded-2xl p-0">
        <Command
          loop
          filter={(itemValue, search, keywords) => {
            if (itemValue.startsWith("__ai")) return 1;
            const hay = `${itemValue} ${keywords?.join(" ") ?? ""}`.toLowerCase();
            return search
              .toLowerCase()
              .split(/\s+/)
              .every((w) => hay.includes(w))
              ? 1
              : 0;
          }}
        >
          <CommandInput
            value={value}
            onValueChange={setValue}
            placeholder={t("command.placeholder")}
            disabled={ai.isPending}
            trailing={ai.isPending ? <Spinner className="text-accent" /> : null}
          />
          <CommandList>
            <CommandEmpty>{notebookId ? t("command.aiHint") : "—"}</CommandEmpty>
            {notebookId && text.length > 1 ? (
              <CommandGroup heading="AI">
                <CommandItem
                  value="__ai"
                  icon={<Wand2 />}
                  hint={t("command.aiHint")}
                  onSelect={() => ai.mutate(text)}
                >
                  {ai.isPending ? t("agent.thinking") : t("command.aiAction", { text })}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {recent.length ? (
              <CommandGroup heading={t("command.recent")}>
                {recent.map((n) => (
                  <CommandItem
                    key={n.id}
                    value={`note ${n.title} ${n.notebookTitle} ${n.id}`}
                    icon={<FileText />}
                    hint={n.notebookTitle}
                    onSelect={run(() =>
                      navigate({
                        to: "/n/$notebookId",
                        params: { notebookId: n.notebookId },
                        search: { note: n.id },
                      }),
                    )}
                  >
                    {n.title || t("common.untitled")}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {notebookId ? (
              <CommandGroup heading={t("command.panels")}>
                {PANELS.map((p) => (
                  <CommandItem
                    key={p.kind}
                    value={`panel ${p.kind} ${t(`nav.${p.kind}`)}`}
                    icon={<p.icon />}
                    shortcut={p.shortcut}
                    onSelect={run(() =>
                      useWorkspace.getState().open({ kind: p.kind, title: t(`nav.${p.kind}`) }),
                    )}
                  >
                    {t(`nav.${p.kind}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading={t("command.actions")}>
              {notebookId ? (
                <>
                  <CommandItem
                    value={`new note ${t("command.newNote")}`}
                    icon={<FilePlus2 />}
                    shortcut={SHORTCUTS.newNote}
                    onSelect={run(() => createNote(notebookId))}
                  >
                    {t("command.newNote")}
                  </CommandItem>
                  <CommandItem
                    value={`add source ${t("command.addSource")}`}
                    icon={<Plus />}
                    shortcut={SHORTCUTS.addSource}
                    onSelect={run(() => useUi.getState().openAddSource())}
                  >
                    {t("command.addSource")}
                  </CommandItem>
                  <CommandItem
                    value={`focus ${t("command.toggleFocus")}`}
                    icon={<Target />}
                    shortcut={SHORTCUTS.toggleFocus}
                    onSelect={run(() => useUi.getState().toggleFocus())}
                  >
                    {t("command.toggleFocus")}
                  </CommandItem>
                </>
              ) : (
                <CommandItem
                  value={`new notebook ${t("home.newNotebook")}`}
                  icon={<Plus />}
                  onSelect={run(() => useUi.getState().set({ newNotebookOpen: true }))}
                >
                  {t("home.newNotebook")}
                </CommandItem>
              )}
              <CommandItem
                value={`import card sillytavern quire ${t("cards.menuImport")}`}
                icon={<FileInput />}
                onSelect={run(() => pickCardFile(notebookId))}
              >
                {t("cards.menuImport")}
              </CommandItem>
              <CommandItem
                value={`theme dark light ${t("command.toggleTheme")}`}
                icon={<SunMoon />}
                shortcut={SHORTCUTS.toggleTheme}
                onSelect={run(() =>
                  theme.set({ mode: resolvedMode(theme.mode) === "dark" ? "light" : "dark" }),
                )}
              >
                {t("command.toggleTheme")}
              </CommandItem>
              <CommandItem
                value="language 语言 english 中文"
                icon={<Languages />}
                onSelect={run(() => setLang(currentLang() === "zh" ? "en" : "zh"))}
              >
                {currentLang() === "zh" ? "Switch to English" : "切换到中文"}
              </CommandItem>
              <CommandItem
                value={`shortcuts keyboard ${t("command.shortcuts")}`}
                icon={<Keyboard />}
                shortcut={SHORTCUTS.help}
                onSelect={run(() => useUi.getState().set({ shortcutsOpen: true }))}
              >
                {t("command.shortcuts")}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t("command.navigate")}>
              <CommandItem
                value={`home ${t("nav.home")}`}
                icon={<Home />}
                onSelect={run(() => navigate({ to: "/" }))}
              >
                {t("nav.home")}
              </CommandItem>
              {(["appearance", "models", "templates", "data"] as const).map((s) => (
                <CommandItem
                  key={s}
                  value={`settings ${s} ${t(`settings.${s}`)}`}
                  icon={s === "models" ? <Brain /> : s === "templates" ? <LayoutPanelLeft /> : <Settings />}
                  onSelect={run(() => navigate({ to: "/settings/$section", params: { section: s } }))}
                >
                  {t("common.settings")} · {t(`settings.${s}`)}
                </CommandItem>
              ))}
            </CommandGroup>
            {notebooks.data?.length ? (
              <CommandGroup heading={t("command.notebooks")}>
                {notebooks.data.map((n) => (
                  <CommandItem
                    key={n.id}
                    value={`notebook ${n.title} ${n.id}`}
                    icon={<span className="w-4 text-center text-[15px] leading-none">{n.icon}</span>}
                    onSelect={run(() => navigate({ to: "/n/$notebookId", params: { notebookId: n.id } }))}
                  >
                    {n.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-[12px] text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {t("command.footSelect")}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              {t("command.footRun")}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              {t("command.footClose")}
            </span>
            {notebookId ? <span className="ml-auto truncate">{t("command.footAi")}</span> : null}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
