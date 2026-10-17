/**
 * 界面语言（zh / en）：服务端返回给界面的文字——错误提示、任务进度、自动起的名字——按它来写。
 * 每个请求按 `?lang=` 或 Accept-Language 记在异步上下文里；后台任务沿用入队那一刻的语言；
 * 没有请求的时候（启动、测试直接调用）用默认语言。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { setAiLangSource } from "@quirenote/ai";

export type Lang = "zh" | "en";

const store = new AsyncLocalStorage<Lang>();
let fallback: Lang = "zh";

/** `zh…` 为中文，其他语言一律英文（与前端的语言检测一致）；没有给出时返回 null。 */
export function parseLang(value: string | null | undefined): Lang | null {
  const first = value?.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
  if (!first || first === "*") return null;
  return first.startsWith("zh") ? "zh" : "en";
}

export function currentLang(): Lang {
  return store.getStore() ?? fallback;
}

// @quirenote/ai 的错误和兜底文字跟着同一个语言走。
setAiLangSource(currentLang);

export function withLang<T>(lang: Lang, fn: () => T): T {
  return store.run(lang, fn);
}

/** 没有请求上下文时的语言（启动时创建的 provider 名称等）。 */
export function setDefaultLang(lang: Lang): void {
  fallback = lang;
}

/** 启动语言：QUIRENOTE_LANG，其次操作系统的区域设置。 */
export function bootLang(env: NodeJS.ProcessEnv): Lang {
  return parseLang(env.QUIRENOTE_LANG) ?? parseLang(Intl.DateTimeFormat().resolvedOptions().locale) ?? "zh";
}
