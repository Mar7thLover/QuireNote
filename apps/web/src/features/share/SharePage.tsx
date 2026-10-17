/**
 * 分享链接的只读页 /share/<token>：不挂应用本体，只请求公开接口（/api/public/shares/<token>…）。
 * 正文用现有的 Markdown 渲染，套用卡片自带的渲染规则（scope note），不混入这台浏览器里的规则；
 * HTML 块和模板卡片放进不执行脚本的沙箱 iframe，资源从公开接口按需加载。
 */
import { cardToPng } from "@quirenote/card";
import { type CardNote, mediaKindOf, type QuireCard } from "@quirenote/core";
import { buildSrcdoc, SANDBOX_ATTR } from "@quirenote/render";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Toaster,
  toast,
} from "@quirenote/ui";
import { useQuery } from "@tanstack/react-query";
import { Download, FileArchive, FileJson, Image as ImageIcon, ImageOff } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import { Markdown } from "@/components/Markdown";
import { downloadBytes, renderCover, safeFilename } from "@/features/cards/cover";
import { autoHeight, useCardThemeVars } from "@/features/render/RenderedSegments";
import { RenderOverrideContext } from "@/features/render/store";
import { useTranslation } from "@/i18n";
import { ApiError, api, type PublicShare } from "@/lib/api";
import { qk } from "@/lib/query";
import { videoEmbedUrl } from "@/lib/video";
import { resolvedMode, useTheme } from "@/stores/theme";

export function SharePage({ token }: { token: string }) {
  const { t } = useTranslation();
  const mode = useTheme((s) => s.mode);
  const q = useQuery({
    queryKey: qk.publicShare(token),
    queryFn: () => api.public.share(token),
    staleTime: 0,
    gcTime: 0,
    retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
  });
  // 撤销之后即使还有旧数据也不再显示
  const gone = q.error instanceof ApiError && q.error.status === 404;
  const share = gone ? undefined : q.data;
  usePageHead(share ? `${share.card.data.name} · QuireNote` : "QuireNote");

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b-[0.5px] border-border bg-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
          <span className="font-serif text-[18px] tracking-tight">QuireNote</span>
          {share ? <DownloadMenu share={share} /> : null}
        </div>
      </header>
      {share ? (
        <ShareBody share={share} />
      ) : q.isPending ? null : (
        <main className="mx-auto w-full max-w-[560px] px-5 pt-24 sm:px-8 sm:pt-32">
          <h1 className="font-serif text-[30px] leading-tight font-normal">
            {gone ? t("share.goneTitle") : t("share.errorTitle")}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            {gone ? t("share.goneDesc") : t("share.errorDesc")}
          </p>
        </main>
      )}
      <Toaster
        theme={resolvedMode(mode)}
        position="bottom-right"
        toastOptions={{
          className: "!rounded-lg !border-border !bg-surface-raised !text-fg !shadow-lg !font-sans",
        }}
      />
    </div>
  );
}

/** 标题跟着分享内容；不进搜索引擎、不带 Referer（服务端托管时 HTML 里已写好，开发服务器下在这里补上）。 */
function usePageHead(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
  useEffect(() => {
    const added = [
      ["robots", "noindex, nofollow"],
      ["referrer", "no-referrer"],
    ]
      .filter(([name]) => !document.head.querySelector(`meta[name="${name}"]`))
      .map(([name, content]) => {
        const m = document.createElement("meta");
        m.name = name!;
        m.content = content!;
        document.head.append(m);
        return m;
      });
    return () => {
      for (const m of added) m.remove();
    };
  }, []);
}

function formatDate(unix: number, lang: string): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ShareBody({ share }: { share: PublicShare }) {
  const { t, i18n } = useTranslation();
  const d = share.card.data;
  const override = useMemo(() => ({ key: share.token, pack: d.render }), [share.token, d.render]);
  const urlTransform = useCallback<UrlTransform>(
    (url) =>
      url.startsWith("asset://") ? api.public.assetUrl(share.token, url.slice(8)) : defaultUrlTransform(url),
    [share.token],
  );
  const updated = formatDate(d.modified_at, i18n.language);
  const meta = [
    t(share.kind === "note" ? "share.kindNote" : "share.kindNotebook"),
    d.creator ? t("share.by", { name: d.creator }) : null,
    updated ? t("share.updated", { date: updated }) : null,
  ].filter(Boolean);
  // 空白笔记（没标题也没正文）不占位置
  const notes = d.notes.filter((n) => n.title.trim() || n.markdown.trim());

  const parts = [
    d.lorebook?.entries.length ? t("share.partLorebook") : null,
    d.ai_instructions.trim() ? t("share.partInstructions") : null,
    d.sources.length ? t("share.partSources") : null,
  ].filter((p): p is string => !!p);

  const header = (
    <>
      <p className="text-[13px] text-fg-subtle">{meta.join(" · ")}</p>
      <h1 className="mt-3 font-serif text-[32px] leading-[1.2] font-normal sm:text-[40px]">
        {d.name || t("share.untitled")}
      </h1>
      {share.kind === "notebook" && d.notebook?.description.trim() ? (
        <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">{d.notebook.description}</p>
      ) : null}
    </>
  );

  return (
    <RenderOverrideContext.Provider value={override}>
      {share.kind === "note" ? (
        <main className="mx-auto w-full max-w-[720px] px-5 pt-10 pb-24 sm:px-8 sm:pt-16">
          {header}
          <article className="mt-10">
            <NoteBody note={notes[0]} urlTransform={urlTransform} />
          </article>
          <Footer />
        </main>
      ) : (
        <div className="mx-auto grid w-full max-w-[1120px] gap-x-14 px-5 pt-10 pb-24 sm:px-8 sm:pt-16 lg:grid-cols-[200px_minmax(0,1fr)]">
          <div className="hidden lg:block">{notes.length > 1 ? <Contents notes={notes} sticky /> : null}</div>
          <main className="w-full max-w-[720px] min-w-0">
            {header}
            {parts.length ? (
              <p className="mt-4 text-[13.5px] leading-relaxed text-fg-subtle">
                {t("share.includes", { parts: parts.join(t("share.partJoin")) })}
              </p>
            ) : null}
            {notes.length > 1 ? (
              <div className="mt-8 lg:hidden">
                <Contents notes={notes} />
              </div>
            ) : null}
            {notes.map((n, i) => (
              <section
                key={n.id || i}
                id={`note-${i}`}
                className="mt-12 scroll-mt-20 border-t-[0.5px] border-border pt-10"
              >
                <h2 className="font-serif text-[26px] leading-snug font-normal">
                  {n.title || t("share.untitled")}
                </h2>
                <div className="mt-6">
                  <NoteBody note={n} urlTransform={urlTransform} />
                </div>
              </section>
            ))}
            <Footer />
          </main>
        </div>
      )}
    </RenderOverrideContext.Provider>
  );
}

/** 整本分享的目录：宽屏在左侧随页面停留，窄屏放在标题下面。 */
function Contents({ notes, sticky }: { notes: CardNote[]; sticky?: boolean }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("share.contents")} className={sticky ? "sticky top-24" : undefined}>
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-fg-subtle">{t("share.contents")}</p>
        <ol className="flex flex-col gap-0.5">
          {notes.map((n, i) => (
            <li key={n.id || i}>
              <a
                href={`#note-${i}`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(`note-${i}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="block truncate rounded-md px-2 py-1 -mx-2 text-[13.5px] text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring"
              >
                {n.title || t("share.untitled")}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="mt-16 border-t-[0.5px] border-border pt-6 text-[13px] leading-relaxed text-fg-subtle">
      <p>{t("share.importHint")}</p>
      <p className="mt-1 font-serif">{t("share.footer")}</p>
    </footer>
  );
}

/** 正文开头和标题重复的一级标题去掉（标题已经单独显示）。 */
function stripTitle(note: CardNote): string {
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(note.markdown);
  return m && m[1]!.trim() === note.title.trim() ? note.markdown.slice(m[0].length) : note.markdown;
}

function NoteBody({ note, urlTransform }: { note: CardNote | undefined; urlTransform: UrlTransform }) {
  const text = useMemo(() => (note ? stripTitle(note) : ""), [note]);
  return (
    <Markdown text={text} scope="note" serif components={SHARE_COMPONENTS} urlTransform={urlTransform} />
  );
}

// ───────────── 嵌入：图片 / 视频 / 音频、HTML 块、视频链接 ─────────────

/** react-markdown 传进来的 hast 节点（只用到这几个字段）。 */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const textOf = (n: HastNode | undefined): string =>
  !n ? "" : n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join("");

const SHARE_COMPONENTS: Components = {
  img: ({ src, alt }) => <ShareMedia src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
  pre: ({ node, children }) => {
    const code = (node as HastNode | undefined)?.children?.[0];
    const cls = code?.tagName === "code" ? code.properties?.className : undefined;
    const lang = Array.isArray(cls) ? cls.join(" ") : String(cls ?? "");
    if (/\blanguage-html\b/.test(lang)) return <HtmlFrame code={textOf(code).replace(/\n$/, "")} />;
    return <pre>{children}</pre>;
  },
  p: ({ node, children }) => {
    // 单独一行的视频网址 → 播放器（与编辑器里一样）
    const kids = (node as HastNode | undefined)?.children ?? [];
    const only = kids.length === 1 ? kids[0] : undefined;
    if (only?.tagName === "a") {
      const href = String(only.properties?.href ?? "");
      const player = textOf(only) === href ? videoEmbedUrl(href) : null;
      if (player) return <VideoFrame url={href} player={player} />;
    }
    return <p>{children}</p>;
  },
};

function ShareMedia({ src, alt }: { src: string; alt: string }) {
  const kind = mediaKindOf(src) ?? "image";
  const [failed, setFailed] = useState(false);
  let media: ReactNode;
  if (failed || !src)
    media = (
      <span className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 font-sans text-[13px] text-fg-subtle">
        <ImageOff className="size-4" />
        {alt}
      </span>
    );
  else if (kind === "video")
    media = (
      // biome-ignore lint/a11y/useMediaCaption: 说明文字在下方
      <video
        src={src}
        controls
        preload="metadata"
        className="w-full rounded-lg"
        onError={() => setFailed(true)}
      />
    );
  else if (kind === "audio")
    media = (
      // biome-ignore lint/a11y/useMediaCaption: 说明文字在下方
      <audio src={src} controls preload="metadata" className="w-full" onError={() => setFailed(true)} />
    );
  else
    media = (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="mx-auto max-h-[80vh] max-w-full rounded-lg"
        onError={() => setFailed(true)}
      />
    );
  return (
    <span className="my-4 block text-center">
      {media}
      {alt && !failed ? (
        <span className="mt-1.5 block text-center font-sans text-[13px] text-fg-subtle">{alt}</span>
      ) : null}
    </span>
  );
}

/** 笔记里的 ```html 块：清洗后放进不执行脚本的沙箱 iframe。 */
function HtmlFrame({ code }: { code: string }) {
  const themeVars = useCardThemeVars();
  const srcdoc = useMemo(() => buildSrcdoc({ html: code, css: "" }, {}, { themeVars }), [code, themeVars]);
  const [height, setHeight] = useState(60);
  const frameRef = useCallback(
    (el: HTMLIFrameElement | null) => (el ? autoHeight(el, setHeight) : undefined),
    [],
  );
  return (
    <iframe
      ref={frameRef}
      title="HTML"
      sandbox={SANDBOX_ATTR}
      srcDoc={srcdoc}
      className="my-3 block w-full border-0"
      style={{ height }}
    />
  );
}

function VideoFrame({ url, player }: { url: string; player: string }) {
  return (
    <div className="my-4">
      <iframe
        title={url}
        src={player}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="fullscreen; picture-in-picture; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-video w-full rounded-lg border-0 bg-surface-sunken"
        loading="lazy"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        style={{ textDecoration: "none" }}
        className="mt-1 block truncate font-sans text-[12.5px] text-fg-subtle hover:text-fg"
      >
        {url}
      </a>
    </div>
  );
}

// ───────────── 下载卡片 ─────────────

function DownloadMenu({ share }: { share: PublicShare }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const name = safeFilename(share.card.data.name);

  const run = async (format: "png" | "json" | "quire") => {
    if (format === "quire") {
      // 压缩包可能很大：让浏览器直接下载
      const a = document.createElement("a");
      a.href = api.public.cardUrl(share.token, "quire");
      a.download = `${name}.quire`;
      document.body.append(a);
      a.click();
      a.remove();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(api.public.cardUrl(share.token, "json"));
      if (!res.ok) throw new Error(res.status === 404 ? t("share.goneTitle") : `HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (format === "json") {
        downloadBytes(bytes, `${name}.quire.json`, "application/json");
      } else {
        const card = JSON.parse(new TextDecoder().decode(bytes)) as QuireCard;
        const kind = t(share.kind === "notebook" ? "cards.coverNotebook" : "cards.coverNote");
        const cover = await renderCover(card, { kind, brand: "QuireNote" });
        downloadBytes(cardToPng(cover, card), `${name}.png`, "image/png");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" loading={busy}>
          <Download />
          {t("share.download")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run("png")}>
          <ImageIcon />
          {t("share.downloadPng")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("json")}>
          <FileJson />
          {t("share.downloadJson")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("quire")}>
          <FileArchive />
          {t("share.downloadQuire")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
