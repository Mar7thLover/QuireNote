/** 可嵌入的视频站：返回播放器地址，不是则返回 null。 */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host === "youtube.com" && u.pathname === "/watch" && u.searchParams.get("v"))
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get("v")!)}`;
    if (host === "youtu.be" && u.pathname.length > 1)
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (host === "bilibili.com") {
      const m = /^\/video\/(BV[\w]+|av(\d+))/.exec(u.pathname);
      if (m) {
        const p = u.searchParams.get("p");
        const id = m[2] ? `aid=${m[2]}` : `bvid=${m[1]}`;
        return `https://player.bilibili.com/player.html?${id}${p ? `&p=${p}` : ""}&autoplay=0`;
      }
    }
  } catch {}
  return null;
}
