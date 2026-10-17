/**
 * 分享为卡片：单条笔记或整本 Notebook → PNG（发图即分享）/ JSON / .quire 压缩包。
 * PNG 由前端画封面，再把服务端给的卡片 JSON 写进 tEXt 块。
 */
import { cardToPng } from "@quirenote/card";
import type { QuireCard } from "@quirenote/core";
import { Button, Checkbox, cn, Dialog, DialogContent, Input, toast } from "@quirenote/ui";
import { FileArchive, FileJson, Image as ImageIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { api, type CardExportOptions } from "@/lib/api";
import { downloadBytes, renderCover } from "./cover";

const CREATOR_KEY = "quirenote.cardCreator";

type Format = "png" | "json" | "quire";

export interface ShareTarget {
  kind: "note" | "notebook";
  id: string;
  name: string;
}

function readCreator(): string {
  try {
    return localStorage.getItem(CREATOR_KEY) ?? "";
  } catch {
    return "";
  }
}

const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .trim()
    .slice(0, 80) || "card";

export function ShareCardDialog({
  target: open,
  onClose,
}: {
  target: ShareTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // 关闭动画期间保持原来的内容，标题不跳
  const [target, setTarget] = useState(open);
  useEffect(() => {
    if (open) setTarget(open);
  }, [open]);
  const [format, setFormat] = useState<Format>("png");
  const [render, setRender] = useState(true);
  const [lorebook, setLorebook] = useState(true);
  const [instructions, setInstructions] = useState(true);
  const [sources, setSources] = useState(false);
  const [creator, setCreator] = useState(readCreator);
  const [busy, setBusy] = useState(false);
  const notebook = target?.kind === "notebook";

  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      try {
        localStorage.setItem(CREATOR_KEY, creator);
      } catch {}
      const opts: CardExportOptions = {
        format: format === "quire" ? "quire" : "json",
        render,
        creator,
        ...(notebook ? { lorebook, instructions, sources } : {}),
      };
      const url = notebook ? api.cards.notebookUrl(target.id, opts) : api.cards.noteUrl(target.id, opts);
      if (format === "quire") {
        // 压缩包：直接让浏览器下载
        window.open(url);
        onClose();
        return;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (format === "json") {
        downloadBytes(bytes, `${safe(target.name)}.quire.json`, "application/json");
      } else {
        const card = JSON.parse(new TextDecoder().decode(bytes)) as QuireCard;
        const kind = t(notebook ? "cards.coverNotebook" : "cards.coverNote");
        const cover = await renderCover(card, { kind, brand: "QuireNote" });
        downloadBytes(cardToPng(cover, card), `${safe(target.name)}.png`, "image/png");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t(notebook ? "cards.shareNotebook" : "cards.shareNote")}
        className="max-w-[520px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <div className="flex flex-col gap-5 px-5 pb-5">
          <p className="text-[13.5px] leading-relaxed text-fg-subtle">{t("cards.shareDesc")}</p>
          <fieldset className="grid grid-cols-3 gap-2">
            <legend className="sr-only">{t("cards.format")}</legend>
            <FormatOption
              active={format === "png"}
              onClick={() => setFormat("png")}
              icon={<ImageIcon />}
              title={t("cards.png")}
              hint={t("cards.pngHint")}
            />
            <FormatOption
              active={format === "json"}
              onClick={() => setFormat("json")}
              icon={<FileJson />}
              title="JSON"
              hint={t("cards.jsonHint")}
            />
            <FormatOption
              active={format === "quire"}
              onClick={() => setFormat("quire")}
              icon={<FileArchive />}
              title=".quire"
              hint={t("cards.quireHint")}
            />
          </fieldset>
          <div className="flex flex-col gap-2.5">
            <Check checked={render} onChange={setRender} label={t("cards.includeRender")} />
            {notebook ? (
              <>
                <Check checked={lorebook} onChange={setLorebook} label={t("cards.includeLorebook")} />
                <Check
                  checked={instructions}
                  onChange={setInstructions}
                  label={t("cards.includeInstructions")}
                />
                <Check
                  checked={sources}
                  onChange={setSources}
                  label={t("cards.includeSources")}
                  hint={t("cards.includeSourcesHint")}
                />
              </>
            ) : null}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-fg-muted">{t("cards.creator")}</span>
            <Input
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              placeholder={t("cards.creatorPlaceholder")}
            />
          </label>
          {format === "png" ? (
            <p className="text-[12.5px] leading-relaxed text-fg-subtle">{t("cards.pngWarning")}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={run} loading={busy}>
              {t("cards.download")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormatOption({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors focus-ring [&_svg]:size-[18px] [&_svg]:text-fg-muted",
        active ? "border-fg bg-surface" : "border-border hover:border-border-strong",
      )}
    >
      {icon}
      <span className="text-[13.5px] font-medium">{title}</span>
      <span className="text-[11.5px] leading-snug text-fg-subtle">{hint}</span>
    </button>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="text-[13.5px]">{label}</span>
        {hint ? <span className="text-[12px] text-fg-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}
