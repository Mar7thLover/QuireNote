import { Button, cn, Field, Input, Select, Slider } from "@quirenote/ui";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { currentLang, setLang, useTranslation } from "@/i18n";
import { SettingsSection } from "@/routes/settings";
import { ACCENTS, BACKGROUNDS, FONT_PRESETS, useTheme } from "@/stores/theme";

export function AppearanceSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <>
      <SettingsSection
        title={t("settings.theme")}
        action={
          <Button size="sm" variant="ghost" onClick={theme.reset}>
            {t("settings.resetTheme")}
          </Button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["light", Sun],
              ["dark", Moon],
              ["system", Monitor],
            ] as const
          ).map(([m, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => theme.set({ mode: m })}
              className={cn(
                "group overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow] focus-ring",
                theme.mode === m
                  ? "border-accent ring-3 ring-ring/30"
                  : "border-border hover:border-border-strong",
              )}
            >
              <ThemePreview mode={m} />
              <span className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium">
                <Icon className="size-4 text-fg-subtle" />
                {t(`settings.mode_${m}`)}
              </span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.accent")}>
        <div className="flex flex-wrap gap-3">
          {Object.entries(ACCENTS).map(([id, a]) => (
            <button
              key={id}
              type="button"
              onClick={() => theme.set({ accent: id })}
              className="flex flex-col items-center gap-1.5 focus-ring rounded-lg p-1"
              aria-label={a.label}
              aria-pressed={theme.accent === id}
            >
              <span
                className="grid size-9 place-items-center rounded-full shadow-sm ring-offset-2 ring-offset-bg transition-transform hover:scale-105"
                style={{
                  background: `oklch(0.55 ${a.c} ${a.h})`,
                  boxShadow:
                    theme.accent === id
                      ? `0 0 0 2px var(--bg), 0 0 0 4px oklch(0.55 ${a.c} ${a.h})`
                      : undefined,
                }}
              >
                {theme.accent === id ? <Check className="size-4 text-white" /> : null}
              </span>
              <span className="text-[11px] text-fg-muted">{a.label}</span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.font")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.fontSans")}>
            <Select
              value={theme.fontSans}
              onValueChange={(v) => theme.set({ fontSans: v })}
              options={FONT_PRESETS.sans.map((f) => ({ value: f.value, label: f.label }))}
            />
          </Field>
          <Field label={t("settings.fontSerif")}>
            <Select
              value={theme.fontSerif}
              onValueChange={(v) => theme.set({ fontSerif: v })}
              options={FONT_PRESETS.serif.map((f) => ({ value: f.value, label: f.label }))}
            />
          </Field>
        </div>
        <p className="mt-4 rounded-lg border border-border bg-surface p-4 font-serif text-[16px] leading-relaxed">
          阅读字体预览：知识就是力量。The quick brown fox jumps over the lazy dog.
        </p>
      </SettingsSection>

      <SettingsSection title={`${t("settings.radius")} · ${t("settings.density")}`}>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label={`${t("settings.radius")} ${theme.radius}px`}>
            <Slider
              min={0}
              max={18}
              step={1}
              value={[theme.radius]}
              onValueChange={([v]) => theme.set({ radius: v! })}
            />
          </Field>
          <Field label={t("settings.density")}>
            <div className="inline-flex rounded-lg bg-surface-sunken p-0.5">
              {(["compact", "comfortable", "spacious"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => theme.set({ density: d })}
                  className={cn(
                    "h-7 rounded-md px-3 text-[13px] text-fg-muted",
                    theme.density === d && "bg-surface font-medium text-fg shadow-sm",
                  )}
                >
                  {t(`settings.density_${d}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.background")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => theme.set({ background: { ...theme.background, type: b.type, value: b.value } })}
              className={cn(
                "h-20 overflow-hidden rounded-xl border text-left focus-ring",
                theme.background.type === b.type &&
                  (b.type !== "gradient" || theme.background.value === b.value)
                  ? "border-accent ring-3 ring-ring/30"
                  : "border-border",
              )}
              style={{
                background:
                  b.type === "aurora"
                    ? "radial-gradient(60% 80% at 20% 20%, oklch(0.8 0.1 272 / .6), transparent), radial-gradient(60% 80% at 80% 60%, oklch(0.82 0.1 330 / .5), transparent), var(--surface)"
                    : b.value || "var(--surface)",
              }}
            >
              <span className="m-2 inline-block rounded-md bg-surface/80 px-2 py-0.5 text-xs font-medium backdrop-blur">
                {b.label}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="自定义背景图片 URL">
            <Input
              placeholder="https://… 或 data:image/…"
              defaultValue={theme.background.type === "image" ? theme.background.value : ""}
              onBlur={(e) =>
                e.target.value.trim() &&
                theme.set({
                  background: { ...theme.background, type: "image", value: e.target.value.trim() },
                })
              }
            />
          </Field>
          <Field label={`${t("settings.bgOpacity")} ${Math.round(theme.background.opacity * 100)}%`}>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[theme.background.opacity]}
              onValueChange={([v]) => theme.set({ background: { ...theme.background, opacity: v! } })}
            />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.language")}>
        <div className="inline-flex rounded-lg bg-surface-sunken p-0.5">
          {(
            [
              ["zh", "简体中文"],
              ["en", "English"],
            ] as const
          ).map(([l, label]) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={cn(
                "h-8 rounded-md px-4 text-[13px] text-fg-muted",
                currentLang() === l && "bg-surface font-medium text-fg shadow-sm",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

/** 迷你界面预览，直观展示深浅色。 */
function ThemePreview({ mode }: { mode: "light" | "dark" | "system" }) {
  const half = (m: "light" | "dark") => (
    <div data-theme={m} className="flex h-full flex-1 gap-1.5 bg-bg p-2">
      <div className="w-1/4 space-y-1 rounded-md bg-surface p-1.5 shadow-sm">
        <div className="h-1.5 w-3/4 rounded bg-border-strong" />
        <div className="h-1.5 w-1/2 rounded bg-border" />
      </div>
      <div className="flex-1 space-y-1.5 rounded-md bg-surface p-1.5 shadow-sm">
        <div className="h-1.5 w-2/3 rounded bg-fg/70" />
        <div className="h-1.5 w-full rounded bg-border" />
        <div className="h-3 w-1/3 rounded bg-accent" />
      </div>
    </div>
  );
  return (
    <div className="flex h-24">
      {mode === "system"
        ? [half("light"), half("dark")].map((x, i) => (
            <div key={i} className="flex flex-1">
              {x}
            </div>
          ))
        : half(mode)}
    </div>
  );
}
