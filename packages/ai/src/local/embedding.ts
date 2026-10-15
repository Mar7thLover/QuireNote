/**
 * local Embedding：确定性的哈希字符 n-gram 向量。
 * - 中文：单字（低权重）+ 二元组 + 三元组
 * - 英文：词（去停用词）+ 带边界的字符三元组（容忍词形变化）
 * 特征经 FNV-1a 哈希到固定维度（signed hashing），tf 取 1+log，最后 L2 归一化。
 */

export const LOCAL_EMBED_DIM = 384;

const ZH_STOP = new Set("的了是在和与及或而也就都把被对从于以其之这那个们为着并".split(""));
const EN_STOP = new Set(
  "a an the and or but of to in on at for with by from as is are was were be been this that it its into than then there their they".split(
    " ",
  ),
);

function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function addFeature(map: Map<string, number>, f: string, w: number): void {
  map.set(f, (map.get(f) ?? 0) + w);
}

export function features(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const norm = text.toLowerCase().normalize("NFKC");
  for (const m of norm.matchAll(/[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    for (let i = 0; i < run.length; i++) {
      const c = run[i]!;
      if (!ZH_STOP.has(c)) addFeature(map, `u:${c}`, 0.4);
      if (i + 1 < run.length) addFeature(map, `b:${run.slice(i, i + 2)}`, 1);
      if (i + 2 < run.length) addFeature(map, `t:${run.slice(i, i + 3)}`, 0.6);
    }
  }
  for (const m of norm.matchAll(/[a-z0-9]+/g)) {
    const w = m[0];
    if (EN_STOP.has(w)) continue;
    addFeature(map, `w:${w}`, 1);
    const padded = `#${w}#`;
    if (padded.length > 4) {
      for (let i = 0; i + 3 <= padded.length; i++) addFeature(map, `c:${padded.slice(i, i + 3)}`, 0.3);
    }
  }
  return map;
}

export function localEmbed(text: string, dim = LOCAL_EMBED_DIM): number[] {
  const v = new Float64Array(dim);
  for (const [f, w] of features(text)) {
    const h = fnv1a(f);
    const idx = h % dim;
    const sign = fnv1a(f, 0x9747b28c) & 1 ? 1 : -1;
    // 次线性 tf：log1p 保留不同特征的相对权重，同时抑制高频词。
    v[idx] = (v[idx] ?? 0) + sign * Math.log1p(w);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = norm > 0 ? v[i]! / norm : 0;
  return out;
}

export function localEmbedMany(texts: string[], dim = LOCAL_EMBED_DIM): number[][] {
  return texts.map((t) => localEmbed(t, dim));
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
