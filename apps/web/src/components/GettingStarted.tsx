/** 第一次在对话里成功提问后由 ChatPanel 写入；首页「使用手册」据此判断是否已经上手。 */
export const ASKED_KEY = "quirenote.askedOnce";

export function hasAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {}
}
