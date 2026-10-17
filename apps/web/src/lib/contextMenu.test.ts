// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  assemble,
  type Contribution,
  contextMenu,
  contributionsOf,
  type MenuItem,
  selectionAt,
  targetContext,
} from "./contextMenu";
import { speakable } from "./speech";

const noop = () => {};
const item = (id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  label: id,
  onSelect: noop,
  ...extra,
});
const ids = (sections: MenuItem[][]) => sections.map((s) => s.map((i) => i.id));

describe("assemble", () => {
  it("通用情境在前，区域菜单由内到外", () => {
    const out = assemble(
      [{ kind: "selection", section: [item("sel.copy")] }],
      [{ sections: [[item("msg.copy")]] }, { sections: [[item("panel.x")]] }],
    );
    expect(ids(out)).toEqual([["sel.copy"], ["msg.copy"], ["panel.x"]]);
  });

  it("区域处理过的通用情境不再出现", () => {
    const out = assemble(
      [
        { kind: "selection", section: [item("sel.copy")] },
        { kind: "link", section: [item("link.copy")] },
      ],
      [{ claims: ["selection"], sections: [[item("rd.copy")]] }],
    );
    expect(ids(out)).toEqual([["link.copy"], ["rd.copy"]]);
  });

  it("区域级菜单只在没有更具体的菜单时出现", () => {
    const area: Contribution = { area: true, sections: [[item("notes.new")]] };
    expect(ids(assemble([], [area]))).toEqual([["notes.new"]]);
    expect(ids(assemble([], [{ sections: [[item("note.open")]] }, area]))).toEqual([["note.open"]]);
    expect(ids(assemble([{ kind: "editable", section: [item("field.paste")] }], [area]))).toEqual([
      ["field.paste"],
    ]);
  });

  it("去掉重复项、空组、空的子菜单和没有动作的条目", () => {
    const out = assemble(
      [],
      [
        {
          sections: [
            [item("a"), item("b")],
            [item("a")],
            [{ id: "sub", label: "sub", items: [{ id: "x", label: "x" }] }],
            [
              { id: "nothing", label: "nothing" },
              item("kept-disabled", { onSelect: undefined, disabled: true }),
            ],
            [{ id: "sub2", label: "sub2", items: [item("y")] }],
          ],
        },
      ],
    );
    expect(ids(out)).toEqual([["a", "b"], ["kept-disabled"], ["sub2"]]);
    expect(out[2]![0]!.items?.map((i) => i.id)).toEqual(["y"]);
  });

  it("什么都没有时返回空（交给浏览器原生菜单）", () => {
    expect(assemble([], [])).toEqual([]);
    expect(assemble([], [{ sections: [[{ id: "x", label: "x" }]] }])).toEqual([]);
  });
});

describe("contextMenu()", () => {
  const fire = (handler: (e: never) => void) => {
    const native = new MouseEvent("contextmenu");
    handler({ nativeEvent: native } as never);
    return contributionsOf(native);
  };

  it("把菜单登记到这次原生事件上，带上选项", () => {
    const list = fire(contextMenu(() => [[item("a")]], { area: true }));
    expect(list).toHaveLength(1);
    expect(list[0]!.area).toBe(true);
    expect(ids(list[0]!.sections)).toEqual([["a"]]);
  });

  it("build 返回空时不登记；返回完整对象时保留 claims", () => {
    expect(fire(contextMenu(() => null))).toEqual([]);
    const list = fire(contextMenu(() => ({ claims: ["selection"], sections: [[item("b")]] })));
    expect(list[0]!.claims).toEqual(["selection"]);
  });

  it("同一事件上内层先登记", () => {
    const native = new MouseEvent("contextmenu");
    contextMenu(() => [[item("inner")]])({ nativeEvent: native } as never);
    contextMenu(() => [[item("outer")]])({ nativeEvent: native } as never);
    expect(contributionsOf(native).flatMap((c) => ids(c.sections).flat())).toEqual(["inner", "outer"]);
  });
});

describe("targetContext", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  it("区分站外链接和站内链接", () => {
    document.body.innerHTML = `<a id="ext" href="https://example.com/a"><span id="in-ext">x</span></a><a id="int" href="/n/nb_1">y</a>`;
    const ext = targetContext(document.getElementById("in-ext")!, 5, 5);
    expect(ext.link).toEqual({ href: "https://example.com/a", external: true });
    const int = targetContext(document.getElementById("int")!, 5, 5);
    expect(int.link?.external).toBe(false);
  });

  it("识别图片和文字输入框，复选框不算输入框", () => {
    document.body.innerHTML = `<img id="img" src="https://example.com/p.png" alt="p"><input id="t" type="text"><input id="c" type="checkbox"><textarea id="ta"></textarea>`;
    expect(targetContext(document.getElementById("img")!, 1, 1).image?.src).toBe("https://example.com/p.png");
    expect(targetContext(document.getElementById("t")!, 1, 1).field?.id).toBe("t");
    expect(targetContext(document.getElementById("ta")!, 1, 1).field?.id).toBe("ta");
    expect(targetContext(document.getElementById("c")!, 1, 1).field).toBeNull();
  });

  it("编辑器里的链接、图片和选区交给编辑器自己", () => {
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true"><p><a id="a" href="https://example.com">link</a></p></div>`;
    const ctx = targetContext(document.getElementById("a")!, 1, 1);
    expect(ctx.link).toBeNull();
    expect(ctx.selection).toBeNull();
  });

  it("只有右键点在选中文字上才算选区", () => {
    document.body.innerHTML = `<p id="p">监督学习使用标签。</p><p id="q">另一段</p>`;
    const p = document.getElementById("p")!;
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()!.addRange(range);
    // jsdom 没有布局，退回到「选区与目标相交」判断
    expect(selectionAt(p, 0, 0)).toBe("监督学习使用标签。");
    expect(selectionAt(document.getElementById("q")!, 0, 0)).toBeNull();
    expect(targetContext(p, 0, 0).selection).toBe("监督学习使用标签。");
  });
});

describe("speakable", () => {
  it("去掉 Markdown 符号、链接地址和引用编号", () => {
    expect(speakable("## 结论\n\n- **注意力**机制[1]，见 [论文](https://x.y)。\n```js\ncode\n```")).toBe(
      "结论 注意力机制，见 论文。",
    );
  });
});
