import { Dialog, DialogContent, Shortcut } from "@quirenote/ui";
import { useTranslation } from "@/i18n";
import { SHORTCUTS } from "@/lib/hotkeys";
import { useUi } from "@/stores/ui";

const EXTRA: [string, string][] = [
  ["Mod+Enter", "发送消息 / 确认"],
  ["Mod+B", "加粗"],
  ["Mod+I", "斜体"],
  ["/", "斜杠命令（编辑器内）"],
  ["Mod+J", "对选中文字调用 AI（编辑器内）"],
  ["Esc", "关闭弹层"],
];

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
            <Row key={keys} label={label} keys={keys} />
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
