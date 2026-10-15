import type { CapacitorConfig } from "@capacitor/cli";

// 移动端壳：打包 apps/web 的构建产物，连接用户自托管的 Folio 服务器（在应用内首次启动时填写地址）
const config: CapacitorConfig = {
  appId: "app.folio.notebook",
  appName: "Folio",
  webDir: "../web/dist",
  server: { androidScheme: "https" },
  plugins: {
    StatusBar: { overlaysWebView: false },
    // iOS 分享扩展与主应用通过 App Group 交换数据，见 docs/mobile.md
    CapacitorShareTarget: { appGroupId: "group.app.folio.notebook" },
  },
};

export default config;
