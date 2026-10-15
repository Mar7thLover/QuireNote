# 移动端（Capacitor）

移动端是 `apps/web` 构建产物的原生壳，界面在窄屏下自动切换为「底部导航 + 推入式详情页」。数据仍然保存在自托管的 Folio 服务器上：首次打开会要求填写服务器地址（例如 `https://folio.example.com`），之后可在「设置 → 数据管理 → 服务器地址」修改。

服务端的 CORS 已放行 `https://localhost`（Android）和 `capacitor://localhost`（iOS）。

## 原生能力

| 能力 | 实现 |
| --- | --- |
| 分享菜单「发送到 Folio」 | `@capgo/capacitor-share-target`。Android 已在 `AndroidManifest.xml` 声明文本、PDF、EPUB、DOCX、图片、音视频的 SEND / SEND_MULTIPLE；iOS 需要分享扩展（见下文） |
| 文件选择 | WebView 原生 `<input type="file">` |
| 录音 | WebView 中的 MediaRecorder，已声明 Android `RECORD_AUDIO` 和 iOS `NSMicrophoneUsageDescription` |
| 返回键 | `@capacitor/app` 监听 Android 返回键 |
| 离线 | 查询缓存持久化在 IndexedDB，断网时可浏览，恢复后同步 |

## 构建

```bash
pnpm --filter @folio/mobile build      # 构建 web 并 cap sync
```

### Android（本机）

需要 JDK 21（本机已有）和 Android SDK（本机尚未安装）。安装 Android Studio 或 command-line tools 后设置 `ANDROID_HOME`，然后：

```bash
cd apps/mobile/android
./gradlew assembleDebug                 # 产物：app/build/outputs/apk/debug/app-debug.apk
```

### iOS（云构建）

本仓库提供 `.github/workflows/mobile.yml`，在 GitHub Actions 的 macOS runner 上构建模拟器版本，并在 ubuntu runner 上构建 Android debug APK。正式签名需要在仓库 Secrets 中配置证书和描述文件（或改用 Codemagic / Ionic Appflow）。

### iOS 分享扩展

Windows 上无法生成 Xcode target，需要在 Mac 或云端 Xcode 中做一次：

1. 在 Xcode 打开 `apps/mobile/ios/App/App.xcworkspace`（或 `.xcodeproj`），File → New → Target → Share Extension，命名为 `ShareExtension`。
2. 用 `apps/mobile/ios-share-extension/ShareViewController.swift` 替换生成的同名文件。
3. 给 App 和 ShareExtension 两个 target 都开启 App Groups，组 ID 为 `group.app.folio.notebook`（与 `capacitor.config.ts` 一致）。
4. Info.plist 已注册 URL Scheme `folio`，扩展保存数据后会用 `folio://share` 唤起主应用。
