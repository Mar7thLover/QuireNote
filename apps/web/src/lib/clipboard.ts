import { toast } from "@quirenote/ui";
import i18n from "@/i18n";

/** 写入剪贴板：优先异步接口，不可用时退回 execCommand。 */
export async function copyText(text: string, notify = false): Promise<boolean> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand("copy");
    ta.remove();
  }
  if (!ok) toast.error(i18n.t("menu.copyFailed"));
  else if (notify) toast(i18n.t("common.copied"));
  return ok;
}

/** 读取剪贴板文字；浏览器拒绝时提示改用快捷键。 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    toast.error(i18n.t("menu.pasteBlocked"));
    return null;
  }
}

/** 读取剪贴板里的 HTML（编辑器粘贴保留格式）；读不到时返回 null，由调用方退回纯文本。 */
export async function readClipboardHtml(): Promise<string | null> {
  try {
    if (!navigator.clipboard.read) return null;
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/html")) return await (await item.getType("text/html")).text();
    }
  } catch {}
  return null;
}

/**
 * 在输入框的光标处插入文字（替换选区）。走 execCommand 保留撤销记录、触发 React 的 onChange；
 * 不支持时直接改值并派发 input 事件。
 */
export function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  el.focus();
  if (document.execCommand(text ? "insertText" : "delete", false, text)) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  setter?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.setSelectionRange(start + text.length, start + text.length);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 复制图片本身（剪贴板只收 PNG，其它格式先转一次）。 */
export async function copyImage(src: string) {
  try {
    const blob = await (await fetch(src)).blob();
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast(i18n.t("menu.imageCopied"));
  } catch {
    toast.error(i18n.t("menu.imageCopyFailed"));
  }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
  );
}

/** 下载文件（同源地址直接保存，跨域地址浏览器会改为打开）。 */
export function download(url: string, name = "") {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 把文字存成文件下载。 */
export function downloadText(text: string, name: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
