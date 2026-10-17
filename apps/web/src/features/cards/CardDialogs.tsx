/** 卡片的分享与导入对话框，挂在根组件上，由 useUi 里的状态打开。 */
import { useUi } from "@/stores/ui";
import { ImportCardDialog } from "./ImportCardDialog";
import { ShareCardDialog } from "./ShareCardDialog";

/** 文件选择框接受的格式：Quire 卡（PNG / JSON / .quire）、酒馆角色卡（PNG / JSON / CHARX）、世界书和正则脚本（JSON）。 */
export const CARD_ACCEPT = ".png,.json,.quire,.charx";

/** 打开系统文件选择框，选中后进入导入预览。 */
export function pickCardFile(notebookId?: string | null): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = CARD_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) useUi.getState().set({ importCard: { file, notebookId } });
  };
  input.click();
}

export function CardDialogs() {
  const share = useUi((s) => s.shareCard);
  const importing = useUi((s) => s.importCard);
  const set = useUi((s) => s.set);
  return (
    <>
      <ShareCardDialog target={share} onClose={() => set({ shareCard: null })} />
      <ImportCardDialog request={importing} onClose={() => set({ importCard: null })} />
    </>
  );
}
