import { currentLang } from "@/i18n";

/** core 里的类型元数据（资料、生成物、元素）带中英两种名称，按界面语言取。 */
export function metaLabel(meta: { label: string; labelEn: string }): string {
  return currentLang() === "en" ? meta.labelEn : meta.label;
}
