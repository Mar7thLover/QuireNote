/** 对话输入框里的回答风格切换：内置与自定义预设，可设为这本 Notebook 的默认。 */
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quirenote/ui";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Feather, Settings2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { DEFAULT_PRESET_ID, usePresets } from "./usePresets";

export function PresetPicker({
  value,
  notebookDefault,
  onChange,
  onMakeDefault,
}: {
  /** 对话自己选的预设；null 表示跟随 Notebook 默认。 */
  value: string | null;
  notebookDefault: string | null;
  onChange: (id: string | null) => void;
  onMakeDefault: (id: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const presets = usePresets();
  const list = presets.data ?? [];
  const find = (id: string | null) => (id ? list.find((p) => p.id === id) : undefined);
  const effective = find(value) ?? find(notebookDefault) ?? find(DEFAULT_PRESET_ID);
  const builtin = list.filter((p) => p.builtin);
  const custom = list.filter((p) => !p.builtin);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 max-w-40 shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-ring",
          )}
          aria-label={t("presets.style")}
          title={t("presets.style")}
        >
          <Feather className="size-3.5 shrink-0" />
          <span className="truncate">{effective?.name ?? t("presets.style")}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>{t("presets.style")}</DropdownMenuLabel>
        {[...builtin, ...(custom.length ? [null] : []), ...custom].map((p, i) =>
          p === null ? (
            <DropdownMenuSeparator key={`sep${i}`} />
          ) : (
            <DropdownMenuCheckboxItem
              key={p.id}
              checked={effective?.id === p.id}
              onSelect={() => onChange(p.id === (notebookDefault ?? DEFAULT_PRESET_ID) ? null : p.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {p.name}
                  {p.id === (notebookDefault ?? DEFAULT_PRESET_ID) ? (
                    <span className="ml-1.5 text-[11px] text-fg-subtle">{t("presets.isDefault")}</span>
                  ) : null}
                </span>
                {p.description ? (
                  <span className="block truncate text-[11px] text-fg-subtle">{p.description}</span>
                ) : null}
              </span>
            </DropdownMenuCheckboxItem>
          ),
        )}
        <DropdownMenuSeparator />
        {effective && effective.id !== (notebookDefault ?? DEFAULT_PRESET_ID) ? (
          <DropdownMenuItem onSelect={() => onMakeDefault(effective.id)}>
            {t("presets.makeDefault")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => navigate({ to: "/settings/$section", params: { section: "presets" } })}
        >
          <Settings2 />
          {t("presets.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
