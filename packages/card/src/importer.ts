/**
 * 插件提供的卡片导入器：把别的格式转成 Quire 卡。导入器是纯数据转换——输入文件内容，输出卡片 JSON，
 * 不访问网络和数据库；将来第三方插件也按这个接口接入（在 Worker 里运行）。
 */
import type { QuireCard } from "@quirenote/core";

export interface ConvertOptions {
  /** 界面语言，用于生成的标题、提示和多语言字段的取舍。 */
  lang?: string;
  /** 文件名（没有自己名字的格式用它命名）。 */
  filename?: string;
}

export interface Converted {
  /** 来源格式，例如 `st-card-png`；导入预览按它显示。 */
  format: string;
  card: QuireCard;
  warnings: string[];
}

export interface CardImporter {
  /** 所属插件的 id；服务端据此检查插件是否启用。 */
  id: string;
  /** JSON 文件（或压缩包里的 card.json）不是 Quire 卡时，看看是不是自己的格式。 */
  fromJson?(value: unknown, opts: ConvertOptions): Converted | null;
  /** 压缩包里 card.json 不是 Quire 卡时；files 为压缩包里的其余文件。 */
  fromZip?(value: unknown, files: Map<string, Uint8Array>, opts: ConvertOptions): Converted | null;
  /** PNG 里没有 quire 块时，看看别的文本块；返回的卡片会自动带上这张图作为封面。 */
  fromPngText?(text: Map<string, string>, opts: ConvertOptions): Converted | null;
}
