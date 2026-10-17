/** 笔记面板「新建」旁边的下拉：从模板新建笔记。 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@quirenote/ui";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Settings2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { createFromNoteTemplate, useNoteTemplates } from "./useTemplates";

export function NewFromTemplate({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const templates = useNoteTemplates();
  const builtin = templates.filter((x) => x.builtin);
  const custom = templates.filter((x) => !x.builtin);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="soft"
          size="sm"
          className="rounded-l-none border-l border-bg px-1.5"
          aria-label={t("templates.fromTemplate")}
          title={t("templates.fromTemplate")}
        >
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("templates.fromTemplate")}</DropdownMenuLabel>
        {[...builtin, ...(custom.length ? [null] : []), ...custom].map((tpl, i) =>
          tpl === null ? (
            <DropdownMenuSeparator key={`sep${i}`} />
          ) : (
            <DropdownMenuItem
              key={tpl.id}
              className={tpl.description ? "h-auto py-1.5" : undefined}
              onSelect={() =>
                createFromNoteTemplate(notebookId, tpl).catch((e: Error) => toast.error(e.message))
              }
            >
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {tpl.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{tpl.name}</span>
                {tpl.description ? (
                  <span className="block truncate text-[11px] text-fg-subtle">{tpl.description}</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          ),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate({ to: "/settings/$section", params: { section: "presets" } })}
        >
          <Settings2 />
          {t("templates.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
