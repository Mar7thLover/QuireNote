import { Shortcut } from "@quirenote/ui";
import { useTranslation } from "@/i18n";
import { SHORTCUTS } from "@/lib/hotkeys";
import { SettingsSection } from "@/routes/settings";

export function ShortcutSettings() {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t("shortcuts.title")}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {(Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]).map((k, i) => (
          <div
            key={k}
            className={`flex h-11 items-center justify-between px-4 text-[13.5px] ${i ? "border-t border-border" : ""}`}
          >
            <span>{t(`shortcuts.${k}`)}</span>
            <Shortcut keys={SHORTCUTS[k]} />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
