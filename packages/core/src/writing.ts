/**
 * 小说写作：一本 Notebook 的稿件结构（卷 → 章，每章是一篇笔记）和每章的大纲。
 * 章节正文就是笔记，用同一个编辑器；稿件只记顺序、梗概、场景节拍和目标字数。
 */
import { z } from "zod";

export const ManuscriptChapter = z.object({
  noteId: z.string(),
  /** 一句话梗概。 */
  synopsis: z.string().max(5000).default(""),
  /** 场景节拍：这一章依次发生什么。 */
  beats: z.array(z.string().max(2000)).max(100).default([]),
  /** 目标字数；null 表示不设。 */
  target: z.number().int().min(0).nullable().default(null),
});
export type ManuscriptChapter = z.infer<typeof ManuscriptChapter>;

export const ManuscriptVolume = z.object({
  id: z.string(),
  title: z.string().max(200).default(""),
  chapters: z.array(ManuscriptChapter).max(2000).default([]),
});
export type ManuscriptVolume = z.infer<typeof ManuscriptVolume>;

export const Manuscript = z.object({
  volumes: z.array(ManuscriptVolume).max(200).default([]),
  /** 全书目标字数。 */
  target: z.number().int().min(0).nullable().default(null),
});
export type Manuscript = z.infer<typeof Manuscript>;

/** 卡片里的稿件：章节引用卡片里的笔记 id。 */
export const CardManuscript = z.object({
  volumes: z
    .array(
      z.object({
        title: z.string().max(200).default(""),
        chapters: z
          .array(
            z.object({
              note_id: z.string(),
              synopsis: z.string().max(5000).default(""),
              beats: z.array(z.string().max(2000)).max(100).default([]),
              target: z.number().int().min(0).nullable().default(null),
            }),
          )
          .max(2000)
          .default([]),
      }),
    )
    .max(200)
    .default([]),
  target: z.number().int().min(0).nullable().default(null),
});
export type CardManuscript = z.infer<typeof CardManuscript>;

/** 字数：中日韩文字逐字计，其他文字按词计（与首页的写作统计一致）。 */
export function countWords(text: string): number {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>\n]+>/g, " ");
  const cjk =
    plain.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words =
    plain
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return cjk + words;
}
