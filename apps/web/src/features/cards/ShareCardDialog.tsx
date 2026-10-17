/**
 * 分享为卡片：单条笔记或整本 Notebook → PNG（发图即分享）/ JSON / .quire 压缩包，
 * 或者在自己的服务器上生成只读页链接（/share/<token>）。
 * PNG 由前端画封面，再把服务端给的卡片 JSON 写进 tEXt 块。
 */
import { cardToPng } from "@quirenote/card";
import type { QuireCard } from "@quirenote/core";
import { Button, Checkbox, cn, Dialog, DialogContent, Input, toast } from "@quirenote/ui";
import { Link } from "@tanstack/react-router";
import { FileArchive, FileJson, Image as ImageIcon, Link2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { isPrivateAddress, shareUrl, useShareBase } from "@/features/share/links";
import { useTranslation } from "@/i18n";
import { api, type CardExportOptions } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { downloadBytes, renderCover, safeFilename } from "./cover";

const CREATOR_KEY = "quirenote.cardCreator";

type Format = "png" | "json" | "quire" | "link";

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
  /** 生成的链接路径；改了选项就作废，需要重新生成。 */
  const [link, setLink] = useState<string | null>(null);
  const { base } = useShareBase(!!open);
  const notebook = target?.kind === "notebook";
  // biome-ignore lint/correctness/useExhaustiveDependencies: 任何选项变化都让已生成的链接作废
  useEffect(() => setLink(null), [open, format, render, lorebook, instructions, sources, creator]);

  const createLink = async () => {
    if (!target) return;
    setBusy(true);
    try {
      try {
        localStorage.setItem(CREATOR_KEY, creator);
      } catch {}
      const share = await api.shares.create({
        kind: target.kind,
        id: target.id,
        render,
        creator,
        ...(notebook ? { lorebook, instructions, sources } : {}),
      });
      setLink(share.path);
      queryClient.invalidateQueries({ queryKey: qk.shares });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
        downloadBytes(bytes, `${safeFilename(target.name)}.quire.json`, "application/json");
      } else {
        const card = JSON.parse(new TextDecoder().decode(bytes)) as QuireCard;
        const kind = t(notebook ? "cards.coverNotebook" : "cards.coverNote");
        const cover = await renderCover(card, { kind, brand: "QuireNote" });
        downloadBytes(cardToPng(cover, card), `${safeFilename(target.name)}.png`, "image/png");
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
          <fieldset className="grid grid-cols-2 gap-2">
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
            <FormatOption
              active={format === "link"}
              onClick={() => setFormat("link")}
              icon={<Link2 />}
              title={t("cards.link")}
              hint={t("cards.linkHint")}
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
          {format === "link" && link ? (
            <LinkResult url={shareUrl(base, link)} onNavigate={onClose} />
          ) : format === "link" ? (
            <p className="text-[12.5px] leading-relaxed text-fg-subtle">{t("cards.linkPublicHint")}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {format === "link" && link ? t("common.close") : t("common.cancel")}
            </Button>
            {format === "link" ? (
              link ? null : (
                <Button variant="primary" onClick={createLink} loading={busy}>
                  {t("cards.createLink")}
                </Button>
              )
            ) : (
              <Button variant="primary" onClick={run} loading={busy}>
                {t("cards.download")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 生成好的链接：可复制、可打开；只能在本机打开的地址给出提示。 */
function LinkResult({ url, onNavigate }: { url: string; onNavigate: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const local = isPrivateAddress(url);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-fg-muted">{t("cards.linkLabel")}</span>
      <div className="flex gap-2">
        <Input
          readOnly
          value={url}
          aria-label={t("cards.linkLabel")}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-[12.5px]"
        />
        <Button onClick={copy}>{copied ? t("cards.copied") : t("cards.copy")}</Button>
        <Button asChild variant="ghost">
          <a href={url} target="_blank" rel="noreferrer noopener">
            {t("cards.openLink")}
          </a>
        </Button>
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-subtle">
        {local ? t("cards.linkLocalHint") : t("cards.linkPublicHint")}{" "}
        {local ? (
          <Link
            to="/settings/$section"
            params={{ section: "sharing" }}
            onClick={onNavigate}
            className="text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg"
          >
            {t("cards.linkSettings")}
          </Link>
        ) : null}
      </p>
    </div>
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
