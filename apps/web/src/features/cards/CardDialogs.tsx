/** 卡片的分享与导入对话框，挂在根组件上，由 useUi 里的状态打开。 */
import { pluginEnabledNow, ST_PLUGIN } from "@/features/plugins/catalog";
import { useUi } from "@/stores/ui";
import { ImportCardDialog } from "./ImportCardDialog";
import { ShareCardDialog } from "./ShareCardDialog";

/** 文件选择框接受的格式：Quire 卡（PNG / JSON / .quire）；启用「酒馆兼容」后另加 CHARX。 */
export function cardAccept(sillytavern = pluginEnabledNow(ST_PLUGIN)): string {
  return sillytavern ? ".png,.json,.quire,.charx" : ".png,.json,.quire";
}

/** 打开系统文件选择框，选中后进入导入预览。 */
export function pickCardFile(notebookId?: string | null): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = cardAccept();
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
