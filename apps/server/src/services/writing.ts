/**
 * 小说写作：给 AI 的写作背景（前文提要、本章大纲、触发的设定），章节摘要，以及整部稿件导出。
 */
import type { NotebookContext } from "@quirenote/ai";
import { summarizeText } from "@quirenote/ai";
import { markdownExcerpt, type Note, type Notebook, nowIso } from "@quirenote/core";
import { strToU8, type Zippable, zipSync } from "fflate";
import type { AppContext } from "../context";
import { notFound } from "../errors";
import { safeName } from "../files";
import { notebookContextFor } from "./lorebook";

/** 前文提要最多带几章。 */
const PREVIOUS_CHAPTERS = 12;

export interface ChapterRef {
  volume: number;
  index: number;
  note: Note;
  synopsis: string;
  beats: string[];
}

/** 按稿件顺序列出所有章节（笔记已删除的跳过）。 */
export async function manuscriptChapters(ctx: AppContext, nb: Notebook): Promise<ChapterRef[]> {
  const notes = new Map((await ctx.store.notes.list({ notebookId: nb.id })).map((n) => [n.id, n]));
  const out: ChapterRef[] = [];
  nb.manuscript?.volumes.forEach((v, vi) => {
    v.chapters.forEach((c, ci) => {
      const note = notes.get(c.noteId);
      if (note) out.push({ volume: vi, index: ci, note, synopsis: c.synopsis, beats: c.beats });
    });
  });
  return out;
}

/** 正文的指纹（FNV-1a）：摘要跟着正文内容走，正文没变就不重新生成。 */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(36)}`;
}

const summaryOf = (n: Note) =>
  typeof n.props.summary === "string" && n.props.summaryOf === fingerprint(n.markdown)
    ? n.props.summary
    : null;

export function outlineText(ch: Pick<ChapterRef, "synopsis" | "beats">): string {
  return [
    ch.synopsis.trim() ? `梗概：${ch.synopsis.trim()}` : "",
    ch.beats.filter((b) => b.trim()).length
      ? `场景节拍：\n${ch.beats
          .filter((b) => b.trim())
          .map((b, i) => `${i + 1}. ${b.trim()}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 写作背景：这本 Notebook 的 AI 说明、默认风格和按最近文字触发的设定，加上前文提要（有摘要用摘要，
 * 没有时用开头一段）和本章大纲。noteId 不在稿件里时只给 Notebook 背景。
 */
export async function writingContext(
  ctx: AppContext,
  notebookId: string,
  noteId: string | null,
  recentText: string,
): Promise<{ notebook: NotebookContext; background: string; chapter: ChapterRef | null }> {
  const nb = await ctx.store.notebooks.get(notebookId);
  if (!nb) throw notFound("Notebook");
  const notebook = await notebookContextFor(ctx, notebookId, recentText.slice(-4000));
  const chapters = await manuscriptChapters(ctx, nb);
  const at = noteId ? chapters.findIndex((c) => c.note.id === noteId) : -1;
  if (at < 0) return { notebook, background: "", chapter: null };
  const chapter = chapters[at]!;
  const previous = chapters.slice(Math.max(0, at - PREVIOUS_CHAPTERS), at);
  const recap = previous
    .map(
      (c) => `- ${c.note.title || "无标题"}：${summaryOf(c.note) ?? markdownExcerpt(c.note.markdown, 200)}`,
    )
    .join("\n");
  const outline = outlineText(chapter);
  const background = [
    recap ? `# 前文提要\n\n${recap}` : "",
    `# 当前章节：${chapter.note.title || "无标题"}${outline ? `\n\n${outline}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { notebook, background, chapter };
}

/** 章节摘要（2–3 句），存在笔记属性里，笔记改动后重新生成。 */
export async function summarizeChapter(ctx: AppContext, noteId: string): Promise<string> {
  const note = await ctx.store.notes.get(noteId);
  if (!note) throw notFound("笔记");
  const cached = summaryOf(note);
  if (cached) return cached;
  const text = note.markdown.trim();
  const summary = text ? (await summarizeText(await ctx.models.chat(), text, note.title)).trim() : "";
  await ctx.store.notes.update(noteId, {
    props: { ...note.props, summary, summaryOf: fingerprint(note.markdown) },
  });
  return summary;
}

// ───────────── 导出 ─────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行内：去掉图片和资源引用，链接只留文字，粗体斜体和行内代码保留。 */
function inlineHtml(s: string): string {
  return esc(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/【[^】｜|]+[：:]([^】｜|]+)[｜|]?[^】]*】/g, "$1"),
  )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** 够用的 Markdown → XHTML：段落、标题、引用、列表、分隔线；代码块原样。 */
export function markdownToXhtml(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(" "))}</p>`);
    para = [];
    if (list)
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(6, h[1]!.length + 1);
      out.push(`<h${level}>${inlineHtml(h[2]!)}</h${level}>`);
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      out.push("<hr/>");
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      out.push(`<blockquote><p>${inlineHtml(q[1]!.replace(/^\[![a-z]+\]\s*/i, ""))}</p></blockquote>`);
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      const tag = /\d/.test(li[1]!) ? "ol" : "ul";
      if (!list || list.tag !== tag) {
        flush();
        list = { tag, items: [] };
      }
      list.items.push(li[2]!.replace(/^\[[ x]\]\s*/i, ""));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

/** 纯文本段落（DOCX 用）：标题级别、正文。 */
function blocks(md: string): { style: "h1" | "h2" | "h3" | "p" | "quote"; text: string }[] {
  const out: { style: "h1" | "h2" | "h3" | "p" | "quote"; text: string }[] = [];
  const clean = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ style: "p", text: clean(para.join(" ")) });
    para = [];
  };
  for (const line of md
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ style: h[1]!.length <= 1 ? "h2" : "h3", text: clean(h[2]!) });
    } else if (/^>\s?/.test(line)) {
      flush();
      out.push({ style: "quote", text: clean(line.replace(/^>\s?(\[![a-z]+\]\s*)?/i, "")) });
    } else if (!line.trim()) flush();
    else para.push(line.trim().replace(/^([-*+]|\d+[.)])\s+/, "· "));
  }
  flush();
  return out.filter((b) => b.text);
}

export interface ManuscriptBook {
  title: string;
  author: string;
  volumes: { title: string; chapters: { title: string; markdown: string }[] }[];
}

export async function loadBook(ctx: AppContext, notebookId: string): Promise<ManuscriptBook> {
  const nb = await ctx.store.notebooks.get(notebookId);
  if (!nb) throw notFound("Notebook");
  const notes = new Map((await ctx.store.notes.list({ notebookId })).map((n) => [n.id, n]));
  return {
    title: nb.title,
    author: "",
    volumes: (nb.manuscript?.volumes ?? []).map((v) => ({
      title: v.title,
      chapters: v.chapters
        .map((c) => notes.get(c.noteId))
        .filter((n): n is Note => !!n)
        .map((n) => ({ title: n.title || "无标题", markdown: n.markdown })),
    })),
  };
}

export function bookToMarkdown(book: ManuscriptBook): string {
  const parts = [`# ${book.title}`];
  const many = book.volumes.length > 1;
  for (const v of book.volumes) {
    if (many && v.title) parts.push(`## ${v.title}`);
    for (const c of v.chapters) parts.push(`${many ? "###" : "##"} ${c.title}`, c.markdown.trim());
  }
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

export function bookToDocx(book: ManuscriptBook): Uint8Array {
  const para = (style: string | null, text: string, pageBreak = false) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${
      pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ""
    }<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const body: string[] = [para("Title", book.title)];
  const many = book.volumes.length > 1;
  for (const v of book.volumes) {
    if (many && v.title) body.push(para("Heading1", v.title, true));
    v.chapters.forEach((c, i) => {
      body.push(para(many ? "Heading2" : "Heading1", c.title, !many || i > 0));
      for (const b of blocks(c.markdown))
        body.push(
          para(
            b.style === "h2"
              ? "Heading2"
              : b.style === "h3"
                ? "Heading3"
                : b.style === "quote"
                  ? "Quote"
                  : null,
            b.text,
          ),
        );
    });
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const style = (id: string, name: string, size: number, extra = "") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="200"/>${extra}</w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const files: Zippable = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/_rels/document.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    "word/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>${style("Title", "Title", 44, '<w:jc w:val="center"/>')}${style("Heading1", "heading 1", 32, '<w:jc w:val="center"/>')}${style("Heading2", "heading 2", 28)}${style("Heading3", "heading 3", 24)}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style></w:styles>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`,
    ),
  };
  return zipSync(files, { level: 6 });
}

export function bookToEpub(book: ManuscriptBook, lang = "zh"): Uint8Array {
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const chapters: { file: string; title: string; volume: string | null }[] = [];
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/style.css": strToU8(
      "body{font-family:serif;line-height:1.8;margin:0 5%}h1,h2{text-align:center;margin:2em 0 1em}p{text-indent:2em;margin:0 0 .6em}blockquote{margin:1em 2em;font-style:italic}",
    ),
  };
  const page = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;
  const many = book.volumes.length > 1;
  let n = 0;
  for (const v of book.volumes) {
    for (const [i, c] of v.chapters.entries()) {
      n++;
      const file = `chapter-${String(n).padStart(4, "0")}.xhtml`;
      const volumeHead = many && i === 0 && v.title ? `<h1>${esc(v.title)}</h1>` : "";
      files[`OEBPS/${file}`] = strToU8(
        page(c.title, `${volumeHead}<h2>${esc(c.title)}</h2>\n${markdownToXhtml(c.markdown)}`),
      );
      chapters.push({ file, title: c.title, volume: many && i === 0 ? v.title : null });
    }
  }
  const navItems = chapters
    .map(
      (c) =>
        `${c.volume ? `<li><span>${esc(c.volume)}</span></li>` : ""}<li><a href="${c.file}">${esc(c.title)}</a></li>`,
    )
    .join("");
  files["OEBPS/nav.xhtml"] = strToU8(
    page(book.title, `<nav epub:type="toc"><h1>${esc(book.title)}</h1><ol>${navItems}</ol></nav>`),
  );
  const modified = nowIso().replace(/\.\d+Z$/, "Z");
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(book.title)}</dc:title><dc:language>${lang}</dc:language>${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ""}<meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${chapters.map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
  );
  return zipSync(files, { level: 6 });
}

export const manuscriptFilename = (title: string, ext: string) =>
  `${safeName(title).replace(/\s+/g, "-") || "manuscript"}${ext}`;
