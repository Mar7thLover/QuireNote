/**
 * 编辑器里的正则渲染：对每个段落跑渲染规则，匹配到的文字在原位置显示成卡片（或替换后的文字）。
 * 存储的始终是原文；光标进入匹配范围时显示原文，方便修改，移开后重新渲染（与 Obsidian 的实时预览同理）。
 * 规则在 Web Worker 中执行，结果按「规则版本 + Notebook + 文本」缓存。
 */
import type { RuleScope } from "@quirenote/core";
import { buildSrcdoc, renderInlineHtml, SANDBOX_ATTR, type Segment } from "@quirenote/render";
import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { autoHeight, readCardThemeVars } from "@/features/render/RenderedSegments";
import {
  allRules,
  allTemplates,
  getRuleRunner,
  hasCustomRules,
  useRenderStore,
} from "@/features/render/store";
import { resolvedMode, useTheme } from "@/stores/theme";
import { useWorkspace } from "@/stores/workspace";

/** 行内原子节点（引用徽标、元素标签、换行）在文本里占一个位置。 */
const OBJ = "￼";

interface Span {
  from: number;
  to: number;
  seg: Segment;
}

const cache = new Map<string, Span[]>();
const queued = new Set<string>();
const views = new Set<EditorView>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function tag(scope: RuleScope): string {
  const t = useTheme.getState();
  return [
    scope,
    useRenderStore.getState().version,
    useWorkspace.getState().notebookId ?? "",
    resolvedMode(t.mode),
    t.accent,
    t.radius,
  ].join("|");
}

const cacheKey = (scope: RuleScope, text: string) => `${tag(scope)}\u0000${text}`;

function spansOf(segments: Segment[]): Span[] {
  const out: Span[] = [];
  for (const s of segments) {
    if (s.from === undefined || s.to === undefined || s.to <= s.from) continue;
    if (s.type === "card" || s.replaced) out.push({ from: s.from, to: s.to, seg: s });
  }
  return out;
}

function refreshAll(): void {
  for (const v of views) if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta(key, "refresh"));
}

function request(scope: RuleScope, text: string): void {
  const k = cacheKey(scope, text);
  if (cache.has(k) || queued.has(k)) return;
  // 内置规则都以【开头；没有自定义规则时，其他段落不必进 worker。
  if (!text.includes("【") && !hasCustomRules()) {
    cache.set(k, []);
    return;
  }
  queued.add(k);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 60);
}

async function flush(): Promise<void> {
  const jobs = [...queued];
  queued.clear();
  const runner = getRuleRunner();
  const rules = allRules();
  for (const k of jobs) {
    const [prefix, text] = [k.slice(0, k.indexOf("\u0000")), k.slice(k.indexOf("\u0000") + 1)];
    const scope = prefix.split("|")[0] as RuleScope;
    try {
      const r = await runner.run(text, rules, { scope, offsets: true });
      cache.set(k, spansOf(r.segments));
    } catch {
      cache.set(k, []);
    }
  }
  if (cache.size > 2000) {
    const keep = [...cache.entries()].slice(-1000);
    cache.clear();
    for (const [kk, v] of keep) cache.set(kk, v);
  }
  refreshAll();
}

/** 卡片或替换文字的显示节点；点一下把光标放进原文。 */
function widget(span: Span, rawLength: number) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("span");
    el.contentEditable = "false";
    const template = span.seg.type === "card" ? allTemplates().get(span.seg.templateId) : undefined;
    const inlineHtml =
      template && span.seg.type === "card" ? renderInlineHtml(template, span.seg.vars) : null;
    if (inlineHtml !== null) {
      // 简单的行内模板（给文字上色之类）直接渲染，跟着段落换行
      el.className = "qn-rule-inline";
      el.innerHTML = inlineHtml;
    } else if (template && span.seg.type === "card") {
      el.className = "qn-rule-card";
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", SANDBOX_ATTR);
      iframe.setAttribute("title", span.seg.raw.slice(0, 60));
      iframe.loading = "lazy";
      iframe.style.height = "80px";
      iframe.srcdoc = buildSrcdoc(template, span.seg.vars, { themeVars: readCardThemeVars() });
      const stop = autoHeight(iframe, (h) => {
        iframe.style.height = `${h}px`;
      });
      (el as HTMLElement & { _stop?: () => void })._stop = stop;
      el.append(iframe);
    } else {
      el.className = "qn-rule-text";
      el.textContent = span.seg.type === "text" ? span.seg.text : span.seg.raw;
    }
    el.addEventListener("mousedown", (e) => {
      if (!view.editable) return;
      e.preventDefault();
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + rawLength)));
      view.focus();
    });
    return el;
  };
}

function build(state: EditorState, scope: RuleScope, editable: boolean): DecorationSet {
  const decos: Decoration[] = [];
  const { from: sf, to: st } = state.selection;
  const templates = allTemplates();
  const t = tag(scope);
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    const text = node.textBetween(0, node.content.size, undefined, OBJ);
    if (!text.trim()) return false;
    const spans = cache.get(`${t}\u0000${text}`);
    if (!spans) {
      request(scope, text);
      return false;
    }
    for (const sp of spans) {
      if (sp.seg.type === "card" && !templates.has(sp.seg.templateId)) continue;
      const start = pos + 1 + sp.from;
      const end = pos + 1 + sp.to;
      // 光标或选区碰到这段：显示原文，方便修改
      if (editable && sf <= end && st >= start) continue;
      decos.push(Decoration.inline(start, end, { class: "qn-rule-raw" }));
      decos.push(
        Decoration.widget(start, widget(sp, end - start), {
          side: -1,
          ignoreSelection: true,
          key: `${t}:${sp.seg.type === "card" ? sp.seg.raw : sp.seg.text}`,
          destroy: (dom) => (dom as HTMLElement & { _stop?: () => void })._stop?.(),
        }),
      );
    }
    return false;
  });
  return DecorationSet.create(state.doc, decos);
}

const key = new PluginKey<DecorationSet>("quirenoteRuleDecorations");

export interface RuleDecorationsOptions {
  scope: RuleScope;
}

export const RuleDecorations = Extension.create<RuleDecorationsOptions>({
  name: "ruleDecorations",
  addOptions() {
    return { scope: "note" };
  },
  addProseMirrorPlugins() {
    const scope = this.options.scope;
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => build(state, scope, editor.isEditable),
          apply: (tr, old, _oldState, state) =>
            tr.docChanged || tr.selectionSet || tr.getMeta(key)
              ? build(state, scope, editor.isEditable)
              : old,
        },
        props: {
          decorations: (state) => key.getState(state),
        },
        view: (view) => {
          views.add(view);
          // 规则、Notebook、主题变化时重新渲染
          const unsubs = [
            useRenderStore.subscribe((s, p) => s.version !== p.version && refreshAll()),
            useTheme.subscribe(() => refreshAll()),
            useWorkspace.subscribe((s, p) => s.notebookId !== p.notebookId && refreshAll()),
          ];
          return {
            destroy: () => {
              views.delete(view);
              for (const u of unsubs) u();
            },
          };
        },
      }),
    ];
  },
});
