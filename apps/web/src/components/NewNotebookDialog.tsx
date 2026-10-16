import {
  Button,
  cn,
  Dialog,
  DialogContent,
  Field,
  Input,
  TAG_COLOR_NAMES,
  Textarea,
  tagColor,
} from "@quirenote/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";

const EMOJIS = [
  "📓",
  "🧠",
  "🔬",
  "📚",
  "🧪",
  "🌍",
  "💡",
  "🎯",
  "🏛️",
  "🧬",
  "📈",
  "🎨",
  "⚖️",
  "🛰️",
  "🌱",
  "🎼",
  "🧭",
  "🗂️",
];

export function NewNotebookDialog() {
  const { t } = useTranslation();
  const open = useUi((s) => s.newNotebookOpen);
  const set = useUi((s) => s.set);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📓");
  const [color, setColor] = useState("indigo");

  const create = useMutation({
    mutationFn: () =>
      api.notebooks.create({ title: title.trim() || t("common.untitled"), description, icon, color }),
    onSuccess: (nb) => {
      upsertInList(qk.notebooks, nb);
      set({ newNotebookOpen: false });
      setTitle("");
      setDescription("");
      navigate({ to: "/n/$notebookId", params: { notebookId: nb.id } });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => set({ newNotebookOpen: o })}>
      <DialogContent title={t("home.newNotebook")}>
        <form
          className="space-y-4 px-5 pt-2 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="grid size-12 shrink-0 place-items-center rounded-xl text-2xl transition-colors"
              style={{ background: `color-mix(in srgb, ${tagColor(color)} 16%, transparent)` }}
            >
              {icon}
            </div>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("home.titlePlaceholder")}
              className="h-10 text-[15px] font-medium"
              aria-label={t("home.titlePlaceholder")}
            />
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("home.descPlaceholder")}
            rows={2}
            className="min-h-16"
          />
          <Field label="图标">
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setIcon(e)}
                  className={cn(
                    "grid size-8 place-items-center rounded-md text-lg transition-colors hover:bg-surface-hover focus-ring",
                    icon === e && "bg-accent-soft ring-1 ring-accent/40",
                  )}
                  aria-label={e}
                  aria-pressed={icon === e}
                >
                  {e}
                </button>
              ))}
            </div>
          </Field>
          <Field label="颜色">
            <div className="flex gap-2">
              {TAG_COLOR_NAMES.filter((c) => c !== "gray").map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-6 rounded-full ring-offset-2 ring-offset-surface-raised transition-transform hover:scale-110 focus-ring",
                    color === c && "ring-2 ring-fg/60",
                  )}
                  style={{ background: tagColor(c) }}
                  aria-label={c}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => set({ newNotebookOpen: false })}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t("common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
