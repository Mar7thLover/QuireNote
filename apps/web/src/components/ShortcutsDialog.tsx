import { Dialog, DialogContent, Shortcut } from "@quirenote/ui";
import { useTranslation } from "@/i18n";
import { SHORTCUTS } from "@/lib/hotkeys";
import { useUi } from "@/stores/ui";

const EXTRA = [
  ["Mod+Enter", "send"],
  ["Mod+B", "bold"],
  ["Mod+I", "italic"],
  ["/", "slash"],
  ["Mod+J", "aiSelection"],
  ["Esc", "closeOverlay"],
  ["Shift+RightClick", "nativeMenu"],
] as const;

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => set({ shortcutsOpen: o })}>
      <DialogContent title={t("shortcuts.title")} className="max-w-md">
        <div className="grid gap-0.5 px-5 pb-5">
          {(Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]).map((k) => (
            <Row key={k} label={t(`shortcuts.${k}`)} keys={SHORTCUTS[k]} />
          ))}
          <div className="my-2 h-px bg-border" />
          {EXTRA.map(([keys, label]) => (
            <Row
              key={keys}
              label={t(`shortcuts.${label}`)}
              keys={keys.replace("RightClick", t("menu.rightClick"))}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex h-8 items-center justify-between text-[13px]">
      <span className="text-fg-muted">{label}</span>
      <Shortcut keys={keys} />
    </div>
  );
}
