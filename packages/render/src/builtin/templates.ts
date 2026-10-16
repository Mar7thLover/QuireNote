import type { CardTemplate } from "@quirenote/core";

/**
 * 内置卡片模板。所有颜色、圆角、字体都取自宿主注入的主题变量（`--card-*`、`--font-*`），
 * 因此深浅色和强调色会跟随应用主题；`color-mix` 用来从强调色派生出柔和的底色。
 */

/** 每个模板共享的卡片外壳。 */
const SHELL = `
.card{position:relative;background:var(--card-bg);color:var(--card-fg);border:1px solid var(--card-border);
border-radius:var(--card-radius,12px);padding:18px 20px;
box-shadow:0 1px 2px color-mix(in oklab,var(--card-fg) 5%,transparent)}
.eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;line-height:1;
letter-spacing:.08em;text-transform:uppercase;color:var(--card-accent)}
.eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.85}
p{margin:0}
`;

const tpl = (t: Omit<CardTemplate, "builtin">): CardTemplate => ({ ...t, builtin: true });

export const knowledgeTemplate = tpl({
  id: "builtin.knowledge",
  name: "知识卡",
  description: "标题 + 正文 + 可选要点列表，适合概念说明与学习笔记。",
  html: `<article class="card k">
  <div class="eyebrow">{{tag|知识 · Note}}</div>
  <h3 class="k-title">{{title}}</h3>
  {{#if body}}<p class="k-body">{{body}}</p>{{/if}}
  {{#if points}}<ul class="k-points">{{#each points}}<li>{{.}}</li>{{/each}}</ul>{{/if}}
</article>`,
  css: `${SHELL}
.k-title{margin:10px 0 0;font-family:var(--font-serif);font-size:19px;font-weight:600;line-height:1.35;
letter-spacing:-.005em;text-wrap:balance}
.k-body{margin-top:8px;color:color-mix(in oklab,var(--card-fg) 82%,var(--card-bg));text-wrap:pretty}
.k-points{list-style:none;margin:12px 0 0;padding:12px 0 0;border-top:1px dashed var(--card-border);
display:grid;gap:6px}
.k-points li{position:relative;padding-left:16px;text-wrap:pretty}
.k-points li::before{content:"";position:absolute;left:2px;top:.72em;width:6px;height:2px;border-radius:1px;
background:var(--card-accent)}
`,
  slots: [
    { name: "title", sample: "注意力机制 Attention" },
    {
      name: "body",
      sample: "让模型在生成每个词时，按相关度为输入中的每个位置分配权重，从而聚焦于最重要的信息。",
    },
    { name: "points", sample: "Query、Key、Value 三个投影||权重由点积后 softmax 得到||多头并行捕捉不同关系" },
    { name: "tag", sample: "" },
  ],
});

export const termTemplate = tpl({
  id: "builtin.term",
  name: "术语卡",
  description: "一个术语及其定义，可带别名或英文名。",
  html: `<article class="card t">
  <div class="eyebrow">术语 · Term</div>
  <div class="t-head"><dfn class="t-term">{{term}}</dfn>{{#if alias}}<span class="t-alias">{{alias}}</span>{{/if}}</div>
  <p class="t-def">{{definition}}</p>
</article>`,
  css: `${SHELL}
.t-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-top:10px}
.t-term{font-family:var(--font-serif);font-style:normal;font-size:22px;font-weight:600;line-height:1.3;
letter-spacing:-.01em;background:linear-gradient(transparent 62%,color-mix(in oklab,var(--card-accent) 22%,transparent) 0);
padding:0 2px}
.t-alias{font-size:13px;color:var(--card-muted);font-style:italic}
.t-def{margin-top:10px;padding-left:12px;border-left:2px solid color-mix(in oklab,var(--card-accent) 45%,transparent);
color:color-mix(in oklab,var(--card-fg) 85%,var(--card-bg));text-wrap:pretty}
`,
  slots: [
    { name: "term", sample: "熵" },
    { name: "definition", sample: "衡量系统不确定性的量。信息论中，熵越高，单条消息平均携带的信息越多。" },
    { name: "alias", sample: "Entropy" },
  ],
});

export const compareTemplate = tpl({
  id: "builtin.compare",
  name: "对比卡",
  description: "左右两栏对比两个对象的要点，窄屏时自动上下排列。",
  html: `<article class="card c">
  <div class="c-grid">
    <section class="c-col c-a">
      <h4 class="c-name">{{leftTitle}}</h4>
      <ul class="c-list">{{#each leftPoints}}<li>{{.}}</li>{{/each}}</ul>
    </section>
    <div class="c-vs" aria-hidden="true"><span>VS</span></div>
    <section class="c-col c-b">
      <h4 class="c-name">{{rightTitle}}</h4>
      <ul class="c-list">{{#each rightPoints}}<li>{{.}}</li>{{/each}}</ul>
    </section>
  </div>
</article>`,
  css: `${SHELL}
.c{padding:0;overflow:hidden}
.c-grid{display:grid;grid-template-columns:1fr auto 1fr}
.c-col{padding:16px 18px;min-width:0}
.c-a{--tone:var(--card-accent)}
.c-b{--tone:color-mix(in oklab,var(--card-accent) 35%,#e0794a)}
.c-name{margin:0 0 10px;display:flex;align-items:center;gap:8px;font-family:var(--font-serif);font-size:17px;
font-weight:600;line-height:1.35}
.c-name::before{content:"";flex:none;width:8px;height:8px;border-radius:2px;background:var(--tone)}
.c-list{list-style:none;margin:0;padding:0;display:grid;gap:7px;font-size:14px}
.c-list li{position:relative;padding-left:14px;color:color-mix(in oklab,var(--card-fg) 86%,var(--card-bg));
text-wrap:pretty}
.c-list li::before{content:"";position:absolute;left:0;top:.7em;width:5px;height:5px;border-radius:50%;
background:color-mix(in oklab,var(--tone) 70%,transparent)}
.c-vs{position:relative;display:flex;align-items:center;justify-content:center;width:1px;
background:var(--card-border)}
.c-vs span{position:absolute;padding:4px 6px;border-radius:999px;background:var(--card-bg);
border:1px solid var(--card-border);font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--card-muted)}
@media (max-width:440px){
.c-grid{grid-template-columns:1fr}
.c-vs{width:auto;height:1px}
}
`,
  slots: [
    { name: "leftTitle", sample: "TCP" },
    { name: "rightTitle", sample: "UDP" },
    { name: "leftPoints", sample: "面向连接，三次握手||可靠传输、按序到达||有拥塞控制" },
    { name: "rightPoints", sample: "无连接，开销小||不保证可靠与顺序||适合实时音视频" },
  ],
});

export const timelineTemplate = tpl({
  id: "builtin.timeline",
  name: "时间线卡",
  description: "按时间排列的事件。每项写作「时间::事件」，用 || 分隔。",
  html: `<article class="card tl">
  {{#if title}}<h3 class="tl-title">{{title}}</h3>{{/if}}
  <ol class="tl-list">{{#each events}}<li class="tl-item">{{#if .1}}<time class="tl-date">{{.0}}</time><span class="tl-text">{{.1}}</span>{{else}}<span class="tl-text">{{.}}</span>{{/if}}</li>{{/each}}</ol>
</article>`,
  css: `${SHELL}
.tl-title{margin:0 0 14px;font-family:var(--font-serif);font-size:18px;font-weight:600;line-height:1.35}
.tl-list{list-style:none;margin:0;padding:0;position:relative}
.tl-list::before{content:"";position:absolute;left:5px;top:8px;bottom:8px;width:1px;background:var(--card-border)}
.tl-item{position:relative;display:grid;grid-template-columns:auto 1fr;column-gap:12px;row-gap:2px;
padding:0 0 12px 22px}
.tl-item:last-child{padding-bottom:0}
.tl-item::before{content:"";position:absolute;left:1px;top:.5em;width:9px;height:9px;border-radius:50%;
background:var(--card-bg);border:2px solid var(--card-accent)}
.tl-item:first-child::before{background:var(--card-accent)}
.tl-date{font-family:var(--font-mono);font-size:12.5px;font-weight:600;line-height:1.65;color:var(--card-accent);
font-variant-numeric:tabular-nums;white-space:nowrap}
.tl-text{grid-column:2;min-width:0;text-wrap:pretty}
.tl-item:not(:has(.tl-date)) .tl-text{grid-column:1 / -1}
@media (max-width:360px){.tl-item{grid-template-columns:1fr}.tl-text{grid-column:1}}
`,
  slots: [
    { name: "title", sample: "人工智能简史" },
    {
      name: "events",
      sample:
        "1950::图灵提出「模仿游戏」||1956::达特茅斯会议，AI 一词诞生||2012::AlexNet 引爆深度学习||2017::Transformer 发表",
    },
  ],
});

export const quoteTemplate = tpl({
  id: "builtin.quote",
  name: "引用卡",
  description: "一段引文与出处，衬线大字排版。",
  html: `<figure class="card q">
  <blockquote class="q-text"><p>{{quote}}</p></blockquote>
  {{#if source}}<figcaption class="q-src">{{source}}</figcaption>{{/if}}
</figure>`,
  css: `${SHELL}
.q{margin:0;padding:22px 24px 18px 24px;overflow:hidden}
.q::before{content:"\\201C";position:absolute;top:-14px;left:12px;font-family:var(--font-serif);font-size:88px;
line-height:1;color:var(--card-accent);opacity:.16;pointer-events:none}
.q-text{margin:0;position:relative}
.q-text p{font-family:var(--font-serif);font-size:18px;line-height:1.7;letter-spacing:.005em;text-wrap:pretty}
.q-src{margin-top:12px;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--card-muted)}
.q-src::before{content:"";width:18px;height:1px;background:currentColor;opacity:.6}
`,
  slots: [
    { name: "quote", sample: "我们只能看到前方很短的距离，但我们可以看到那里有很多需要去做的事情。" },
    { name: "source", sample: "艾伦·图灵《计算机器与智能》" },
  ],
});

export const calloutTemplate = tpl({
  id: "builtin.callout",
  name: "要点 / 提示卡",
  description: "提示、注意、警告等提示框。kind 取 tip / note / important / warning / caution。",
  html: `<aside class="co" data-kind="{{kind|note}}">
  <div class="co-label">{{#if title}}{{title}}{{/if}}</div>
  <p class="co-text">{{content}}</p>
</aside>`,
  css: `
.co{--tone:var(--card-accent);position:relative;padding:12px 16px 13px 18px;border-radius:var(--card-radius,12px);
background:color-mix(in oklab,var(--tone) 8%,var(--card-bg));color:var(--card-fg);
border:1px solid color-mix(in oklab,var(--tone) 22%,transparent)}
.co::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;
background:var(--tone)}
.co[data-kind="tip" i]{--tone:#2f9e6e}
.co[data-kind="important" i]{--tone:#8e5bd6}
.co[data-kind="warning" i]{--tone:#c98a12}
.co[data-kind="caution" i]{--tone:#d64545}
.co-label{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:650;letter-spacing:.04em;
color:color-mix(in oklab,var(--tone) 80%,var(--card-fg))}
.co-label:empty::before{content:"注 · Note"}
.co[data-kind="tip" i] .co-label:empty::before{content:"提示 · Tip"}
.co[data-kind="important" i] .co-label:empty::before{content:"重要 · Important"}
.co[data-kind="warning" i] .co-label:empty::before{content:"注意 · Warning"}
.co[data-kind="caution" i] .co-label:empty::before{content:"警告 · Caution"}
.co-text{margin:4px 0 0;line-height:1.65;text-wrap:pretty}
`,
  slots: [
    { name: "kind", sample: "tip" },
    { name: "title", sample: "" },
    { name: "content", sample: "复习时先尝试回忆，再看答案——主动提取比重复阅读记得更牢。" },
  ],
});

export const statTemplate = tpl({
  id: "builtin.stat",
  name: "数据卡",
  description: "一个醒目的大数字，配说明与可选备注。",
  html: `<article class="card s">
  <div class="s-value">{{value}}</div>
  <p class="s-label">{{label}}</p>
  {{#if note}}<p class="s-note">{{note}}</p>{{/if}}
</article>`,
  css: `${SHELL}
.s{padding:18px 20px 16px;background:linear-gradient(160deg,color-mix(in oklab,var(--card-accent) 7%,var(--card-bg)),var(--card-bg) 60%)}
.s-value{font-family:var(--font-sans);font-size:40px;font-weight:650;line-height:1.05;letter-spacing:-.025em;
font-variant-numeric:tabular-nums lining-nums;color:var(--card-accent);overflow-wrap:anywhere}
.s-label{margin-top:8px;font-size:14.5px;font-weight:500;line-height:1.5;text-wrap:pretty}
.s-note{margin-top:4px;font-size:12.5px;color:var(--card-muted)}
`,
  slots: [
    { name: "value", sample: "71%" },
    { name: "label", sample: "地球表面被海洋覆盖的比例" },
    { name: "note", sample: "来源：NOAA" },
  ],
});

export const builtinTemplates: readonly CardTemplate[] = [
  knowledgeTemplate,
  termTemplate,
  compareTemplate,
  timelineTemplate,
  quoteTemplate,
  calloutTemplate,
  statTemplate,
];

export const BUILTIN_TEMPLATE_PREFIX = "builtin.";
