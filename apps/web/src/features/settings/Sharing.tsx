/** 设置 → 分享链接：公开访问地址，已分享的链接（复制、打开、撤销）。 */
import { Button, Input, Skeleton, toast } from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  defaultShareBase,
  normalizeShareBase,
  SHARE_BASE_KEY,
  shareUrl,
  useShareBase,
} from "@/features/share/links";
import { useTranslation } from "@/i18n";
import { api, type ShareLink } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { SettingsSection } from "@/routes/settings";

export function SharingSettings() {
  const { t } = useTranslation();
  const { base, custom, loading } = useShareBase();
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (!loading) setDraft(custom ? base : "");
  }, [loading, custom, base]);
  const saveBase = useMutation({
    mutationFn: (value: string) => api.settings.put(SHARE_BASE_KEY, value),
    onSuccess: (value) => {
      queryClient.setQueryData(qk.settings(SHARE_BASE_KEY), value);
      toast.success(t("share.baseSaved"));
    },
  });
  const commit = () => {
    const v = normalizeShareBase(draft);
    if (v === null) {
      toast.error(t("share.baseInvalid"));
      return;
    }
    setDraft(v);
    if (v !== (custom ? base : "")) saveBase.mutate(v);
  };

  const shares = useQuery({ queryKey: qk.shares, queryFn: api.shares.list });

  return (
    <>
      <SettingsSection title={t("share.baseTitle")} description={t("share.baseDesc")}>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder={defaultShareBase() || t("share.basePlaceholder")}
            aria-label={t("share.baseTitle")}
            className="max-w-[420px]"
          />
        </div>
        <div className="mt-4 rounded-xl border-[0.5px] border-border bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-fg-muted">
          <p className="font-medium text-fg">{t("share.exposeTitle")}</p>
          <p className="mt-1">{t("share.exposeDesc")}</p>
          <p className="mt-1 font-mono text-[12.5px] text-fg-subtle">{t("share.exposePaths")}</p>
        </div>
      </SettingsSection>

      <SettingsSection title={t("share.listTitle")} description={t("share.listDesc")}>
        {shares.isPending ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : !shares.data?.length ? (
          <p className="text-[13.5px] text-fg-subtle">{t("share.empty")}</p>
        ) : (
          <ul className="divide-y-[0.5px] divide-border overflow-hidden rounded-xl border-[0.5px] border-border bg-surface">
            {shares.data.map((s) => (
              <ShareRow key={s.token} share={s} base={base} />
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  );
}

function ShareRow({ share, base }: { share: ShareLink; base: string }) {
  const { t, i18n } = useTranslation();
  const url = shareUrl(base, share.path);
  const [copied, setCopied] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api.shares.revoke(share.token),
    onSuccess: () => {
      queryClient.setQueryData<ShareLink[]>(qk.shares, (old) => old?.filter((x) => x.token !== share.token));
      toast.success(t("share.revoked"));
    },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const date = new Date(share.createdAt).toLocaleDateString(i18n.language === "en" ? "en-US" : "zh-CN");
  const kind =
    share.kind === "note" ? t("share.noteIn", { title: share.notebookTitle ?? "" }) : t("share.kindNotebook");
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">
          {share.title ?? <span className="text-fg-subtle">{t("share.deleted")}</span>}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-fg-subtle">
          {kind} · {t("share.createdAt", { date })}
        </p>
        <p className="mt-0.5 truncate font-mono text-[12px] text-fg-subtle" title={url}>
          {url}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" onClick={copy}>
          {copied ? t("cards.copied") : t("cards.copy")}
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={url} target="_blank" rel="noreferrer noopener">
            {t("cards.openLink")}
          </a>
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={revoke.isPending}
          onClick={() => confirm(t("share.revokeConfirm")) && revoke.mutate()}
        >
          {t("share.revoke")}
        </Button>
      </div>
    </li>
  );
}
