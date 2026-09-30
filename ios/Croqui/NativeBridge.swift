import UIKit
import WebKit

/// Mensagens JS → nativo:
///   window.webkit.messageHandlers.haptic.postMessage("light" | "selection" | "success")
///   window.webkit.messageHandlers.share.postMessage({ name, mime, base64 })
@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    static let handlers = ["haptic", "share"]
    weak var webView: WKWebView?

    private let light = UIImpactFeedbackGenerator(style: .light)
    private let selection = UISelectionFeedbackGenerator()
    private let notify = UINotificationFeedbackGenerator()

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "haptic":
            let kind = message.body as? String ?? "light"
            switch kind {
            case "selection": selection.selectionChanged()
            case "success": notify.notificationOccurred(.success)
            default: light.impactOccurred()
            }
        case "share":
            guard let dict = message.body as? [String: Any],
                  let name = dict["name"] as? String,
                  let b64 = dict["base64"] as? String,
                  let data = Data(base64Encoded: b64) else { return }
            share(data: data, filename: name)
        default: break
        }
    }

    /// Planilha de compartilhar do iOS: Salvar em Arquivos, AirDrop, Mail, Fotos (PNG)…
    private func share(data: Data, filename: String) {
        let safe = filename.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do { try data.write(to: url, options: .atomic) } catch { NSLog("[Croqui] share: \(error)"); return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        guard let host = webView?.window?.rootViewController else { return }
        let top = host.presentedViewController ?? host
        // No iPad a planilha é um popover: precisa de âncora (canto superior direito, perto do botão Compartilhar).
        if let pop = vc.popoverPresentationController, let view = webView {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.maxX - 120, y: view.safeAreaInsets.top + 30, width: 1, height: 1)
            pop.permittedArrowDirections = [.up]
        }
        top.present(vc, animated: true)
    }

    // MARK: - Diálogos JS (confirm/alert/prompt) — o app usa os próprios, mas garante que nada trave.

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, or: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert) { completionHandler(false) }
    }

    private func present(_ alert: UIAlertController, or fallback: @escaping () -> Void) {
        guard let host = webView?.window?.rootViewController else { fallback(); return }
        (host.presentedViewController ?? host).present(alert, animated: true)
    }

    // Links externos (se houver) abrem no Safari, não dentro do app.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.host != "127.0.0.1", url.scheme?.hasPrefix("http") == true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // Se o processo da web cair (memória), recarrega em vez de ficar em branco.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
