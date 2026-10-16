// QuireNote iOS 分享扩展：把系统分享菜单里的链接、文本、文件写入 App Group，再唤起主应用。
// 接入步骤见 docs/mobile.md（需要在 Xcode 中新建 Share Extension target，并把本文件替换进去）。
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    let appGroupId = "group.app.quirenote.notebook"
    let appUrlScheme = "quirenote"

    private var texts: [String] = []
    private var files: [[String: String]] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = item.attachments else { return finish() }
        Task {
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    if url.isFileURL { saveFile(url) } else { texts.append(url.absoluteString) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    texts.append(text)
                } else if let type = provider.registeredTypeIdentifiers.first,
                          let url = try? await provider.loadItem(forTypeIdentifier: type) as? URL {
                    saveFile(url)
                }
            }
            let data: [String: Any] = ["title": item.attributedContentText?.string ?? "", "texts": texts, "files": files]
            UserDefaults(suiteName: appGroupId)?.set(data, forKey: "share-target-data")
            openHostApp()
            finish()
        }
    }

    /// 把文件复制到 App Group 共享目录，主应用通过插件读取。
    private func saveFile(_ url: URL) {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return }
        let dest = dir.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
        try? FileManager.default.copyItem(at: url, to: dest)
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        files.append(["uri": dest.absoluteString, "name": url.lastPathComponent, "mimeType": mime])
    }

    private func openHostApp() {
        guard let url = URL(string: "\(appUrlScheme)://share") else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication { app.open(url); return }
            responder = r.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
