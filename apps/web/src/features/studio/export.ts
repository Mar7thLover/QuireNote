import type { Artifact, MindmapNode } from "@quirenote/core";

function mindmapToMarkdown(nodes: MindmapNode[]): string {
  const kids = new Map<string | null, MindmapNode[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      lines.push(
        depth === 0 ? `# ${n.label}` : `${"  ".repeat(depth - 1)}- ${n.label}${n.note ? `：${n.note}` : ""}`,
      );
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

/** 任意生成物导出为 Markdown（也用于存为笔记、Notebook 导出）。 */
export function artifactToMarkdown(a: Artifact): string {
  const d = a.data;
  const head = `# ${a.title}\n\n`;
  if (!d) return head;
  switch (d.kind) {
    case "markdown":
      return d.markdown.startsWith("#") ? d.markdown : head + d.markdown;
    case "mindmap":
      return mindmapToMarkdown(d.nodes);
    case "flashcards":
      return head + d.cards.map((c, i) => `**${i + 1}. ${c.front}**\n\n${c.back}`).join("\n\n");
    case "quiz":
      return (
        head +
        d.questions
          .map(
            (q, i) =>
              `**${i + 1}. ${q.question}**\n\n${q.options.map((o, j) => `${j === q.answer ? "- [x]" : "- [ ]"} ${o}`).join("\n")}${q.explanation ? `\n\n> ${q.explanation}` : ""}`,
          )
          .join("\n\n")
      );
    case "timeline":
      return (
        head + d.events.map((e) => `- **${e.date}** ${e.title}${e.detail ? `：${e.detail}` : ""}`).join("\n")
      );
    case "table": {
      const cols = d.table.columns;
      const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|");
      return `${head}| ${cols.map((c) => esc(c.name)).join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n${d.table.rows
        .map((r) => `| ${cols.map((c) => esc(r[c.id])).join(" | ")} |`)
        .join("\n")}`;
    }
    case "slides":
    case "video":
      return (
        head +
        d.slides
          .map((s, i) => `## ${i + 1}. ${s.title}\n\n${s.bullets.map((b) => `- ${b}`).join("\n")}`)
          .join("\n\n")
      );
    case "audio":
      return (
        head + d.script.map((l) => `**${l.speaker === "A" ? "主持人" : "嘉宾"}**：${l.text}`).join("\n\n")
      );
    case "image":
      return `${head}${d.imageUrl ? `![${d.prompt}](${d.imageUrl})` : d.prompt}`;
  }
}
