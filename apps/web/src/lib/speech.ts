/** 用系统语音朗读一段 Markdown（右键「朗读」）。同一时间只读一段。 */

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function isSpeaking(): boolean {
  return canSpeak() && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** Markdown 转成适合朗读的纯文字：去掉代码、链接地址、引用编号和符号。 */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/^\s*(?:[-+*]|\d+[.)]|#{1,6}|>)\s*/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(md: string) {
  if (!canSpeak()) return;
  const text = speakable(md);
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const head = text.slice(0, 400).replace(/\s/g, "");
  const cjk = (head.match(/[㐀-鿿]/g)?.length ?? 0) > head.length * 0.2;
  u.lang = cjk ? "zh-CN" : "en-US";
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.toLowerCase().startsWith(cjk ? "zh" : "en"));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}
