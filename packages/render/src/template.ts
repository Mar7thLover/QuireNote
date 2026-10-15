/**
 * Mustache 子集：
 *
 * - `{{var}}`：HTML 转义输出；`{{var|默认值}}` 变量为空时输出默认值（同样转义）。
 * - `{{#if var}}…{{else}}…{{/if}}`：变量去掉首尾空白后非空即为真。
 * - `{{#each list}}…{{/each}}`：list 是用 `||` 分隔的字符串；循环内 `{{.}}` 是当前项。
 *   扩展：当前项可再用 `::` 分成几部分，`{{.0}}`、`{{.1}}` 分别取第 1、2 部分（时间线卡用它区分日期与事件）。
 * - `{{! 注释 }}` 被忽略。不支持三重花括号的非转义输出——所有输出都会转义。
 */

type TplNode =
  | { t: "text"; value: string }
  | { t: "var"; name: string; fallback: string | null }
  | { t: "if"; name: string; yes: TplNode[]; no: TplNode[] }
  | { t: "each"; name: string; body: TplNode[] };

type Frame =
  | { kind: "root"; nodes: TplNode[] }
  | { kind: "if"; node: Extract<TplNode, { t: "if" }>; inElse: boolean }
  | { kind: "each"; node: Extract<TplNode, { t: "each" }> };

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
  "=": "&#61;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`=]/g, (c) => ESCAPES[c] ?? c);
}

/** 把 `a || b || c` 拆成列表（去空白、去空项）。 */
export function splitList(value: string): string[] {
  return value
    .split("||")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const cache = new Map<string, TplNode[]>();

export function parseTemplate(source: string): TplNode[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const root: Frame = { kind: "root", nodes: [] };
  const stack: Frame[] = [root];
  const current = (): TplNode[] => {
    const top = stack[stack.length - 1] ?? root;
    if (top.kind === "root") return top.nodes;
    if (top.kind === "each") return top.node.body;
    return top.inElse ? top.node.no : top.node.yes;
  };
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{{", i);
    if (open === -1) {
      current().push({ t: "text", value: source.slice(i) });
      break;
    }
    const close = source.indexOf("}}", open + 2);
    if (close === -1) {
      current().push({ t: "text", value: source.slice(i) });
      break;
    }
    if (open > i) current().push({ t: "text", value: source.slice(i, open) });
    let end = close + 2;
    let tag = source.slice(open + 2, close);
    if (tag.startsWith("{") && source[end] === "}") {
      // {{{var}}} 也按转义输出
      tag = tag.slice(1);
      end += 1;
    }
    i = end;
    tag = tag.trim();
    if (tag.startsWith("!")) continue;
    const block = /^#(if|each)\s+(.+)$/.exec(tag);
    if (block) {
      const name = (block[2] ?? "").trim();
      if (block[1] === "if") {
        const node: Extract<TplNode, { t: "if" }> = { t: "if", name, yes: [], no: [] };
        current().push(node);
        stack.push({ kind: "if", node, inElse: false });
      } else {
        const node: Extract<TplNode, { t: "each" }> = { t: "each", name, body: [] };
        current().push(node);
        stack.push({ kind: "each", node });
      }
      continue;
    }
    if (tag === "else") {
      const top = stack[stack.length - 1];
      if (top?.kind === "if") top.inElse = true;
      continue;
    }
    const closing = /^\/(if|each)$/.exec(tag);
    if (closing) {
      const top = stack[stack.length - 1];
      if (top && top.kind === closing[1]) stack.pop(); // 不匹配的结束标签直接忽略
      continue;
    }
    if (tag === "") continue;
    const bar = tag.indexOf("|");
    const name = (bar === -1 ? tag : tag.slice(0, bar)).trim();
    const fallback = bar === -1 ? null : tag.slice(bar + 1).trim();
    current().push({ t: "var", name, fallback });
  }
  // 未闭合的块在结尾自动闭合（栈中节点已挂在树上）。
  if (cache.size > 200) cache.clear();
  cache.set(source, root.nodes);
  return root.nodes;
}

interface Scope {
  vars: Readonly<Record<string, string>>;
  item: string | null;
}

function lookup(name: string, scope: Scope): string {
  if (name === "." || name === "this") return scope.item ?? "";
  const part = /^\.(\d+)$/.exec(name);
  if (part) {
    if (scope.item === null) return "";
    return (scope.item.split("::")[Number(part[1])] ?? "").trim();
  }
  return scope.vars[name] ?? "";
}

function renderNodes(nodes: readonly TplNode[], scope: Scope): string {
  let out = "";
  for (const node of nodes) {
    switch (node.t) {
      case "text":
        out += node.value;
        break;
      case "var": {
        const value = lookup(node.name, scope);
        out += escapeHtml(value.trim() === "" && node.fallback !== null ? node.fallback : value);
        break;
      }
      case "if":
        out += renderNodes(lookup(node.name, scope).trim() !== "" ? node.yes : node.no, scope);
        break;
      case "each":
        for (const item of splitList(lookup(node.name, scope))) {
          out += renderNodes(node.body, { vars: scope.vars, item });
        }
        break;
    }
  }
  return out;
}

/** 渲染模板字符串。所有变量输出都经过 HTML 转义；结果仍需经 `sanitizeHtml` 清洗后再展示。 */
export function renderTemplate(source: string, vars: Readonly<Record<string, string>>): string {
  return renderNodes(parseTemplate(source), { vars, item: null });
}

/** 收集模板中引用到的变量名（编辑器用来提示缺失的 slot）。 */
export function templateVariables(source: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly TplNode[]) => {
    for (const n of nodes) {
      if (n.t === "var" && !n.name.startsWith(".") && n.name !== "this") names.add(n.name);
      if (n.t === "if") {
        if (!n.name.startsWith(".")) names.add(n.name);
        walk(n.yes);
        walk(n.no);
      }
      if (n.t === "each") {
        names.add(n.name);
        walk(n.body);
      }
    }
  };
  walk(parseTemplate(source));
  return [...names];
}
