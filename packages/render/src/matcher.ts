import type { MatchInfo, MatchOutcome, MatchRequest } from "./types";

/**
 * 在若干段文本上执行同一条正则，返回每段的匹配列表。
 *
 * 这个函数刻意写成**自包含**（不引用模块内其他符号），既供 worker 使用，
 * 也能通过 `Function.prototype.toString` 注入到任意 worker 实现里（测试中用于 Node worker_threads）。
 * 规则没有 `g` 标志时，每段只取第一个匹配，由引擎决定全局只用第一处。
 */
export function collectMatches(req: Omit<MatchRequest, "id">): MatchOutcome {
  try {
    if (!/^[dgimsuvy]*$/.test(req.flags) || new Set(req.flags).size !== req.flags.length) {
      throw new SyntaxError(`非法的正则标志 "${req.flags}"`);
    }
    const global = req.flags.includes("g");
    const unicode = req.flags.includes("u") || req.flags.includes("v");
    const re = new RegExp(req.pattern, global ? req.flags : `${req.flags}g`);
    const results: MatchInfo[][] = [];
    for (const text of req.texts) {
      const out: MatchInfo[] = [];
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        let named: Record<string, string | null> | null = null;
        if (m.groups) {
          named = {};
          for (const [k, v] of Object.entries(m.groups)) named[k] = v ?? null;
        }
        out.push({ index: m.index, match: m[0], groups: m.slice(1).map((g) => g ?? null), named });
        if (!global) break;
        if (m[0] === "") {
          // 空匹配时手动前进，避免死循环；unicode 模式下跳过整个代理对。
          const code = text.charCodeAt(re.lastIndex);
          re.lastIndex += unicode && code >= 0xd800 && code <= 0xdbff ? 2 : 1;
          if (re.lastIndex > text.length) break;
        }
      }
      results.push(out);
    }
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 展开 String.prototype.replace 风格的替换串：支持 `$$`、`$&`、`` $` ``、`$'`、`$1`..`$99`、`$<name>`。
 * 在主线程执行，不涉及正则回溯。
 */
export function expandReplacement(replacement: string, m: MatchInfo, input: string): string {
  let out = "";
  for (let i = 0; i < replacement.length; i++) {
    const ch = replacement[i];
    if (ch !== "$" || i === replacement.length - 1) {
      out += ch;
      continue;
    }
    const next = replacement[i + 1] ?? "";
    if (next === "$") {
      out += "$";
      i++;
    } else if (next === "&") {
      out += m.match;
      i++;
    } else if (next === "`") {
      out += input.slice(0, m.index);
      i++;
    } else if (next === "'") {
      out += input.slice(m.index + m.match.length);
      i++;
    } else if (next === "<" && m.named) {
      const end = replacement.indexOf(">", i + 2);
      if (end === -1) {
        out += ch;
        continue;
      }
      out += m.named[replacement.slice(i + 2, end)] ?? "";
      i = end;
    } else if (/[0-9]/.test(next)) {
      const two = replacement.slice(i + 1, i + 3);
      const n2 = /^[0-9]{2}$/.test(two) ? Number(two) : 0;
      const n1 = Number(next);
      if (n2 >= 1 && n2 <= m.groups.length) {
        out += m.groups[n2 - 1] ?? "";
        i += 2;
      } else if (n1 >= 1 && n1 <= m.groups.length) {
        out += m.groups[n1 - 1] ?? "";
        i += 1;
      } else {
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}
