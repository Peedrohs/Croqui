import SwiftUI
import UIKit
import WebKit

/// O app web inteiro roda aqui dentro. A ponte nativa (NativeBridge) adiciona o que o Safari não dá:
/// vibração do Taptic Engine e a planilha de compartilhar para PNG/PDF/JSON.
struct CroquiWebView: UIViewRepresentable {
    func makeCoordinator() -> NativeBridge { NativeBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistente: projetos ficam salvos entre aberturas
        config.allowsInlineMediaPlayback = true
        config.preferences.isElementFullscreenEnabled = false

        let ucc = WKUserContentController()
        // Avisa a página que está no app nativo (desliga o service worker e usa a ponte).
        ucc.addUserScript(WKUserScript(
            source: "window.__CROQUI_NATIVE__ = { version: 1 };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        for name in NativeBridge.handlers { ucc.add(context.coordinator, name: name) }
        config.userContentController = ucc

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(named: "LaunchBackground")
        web.scrollView.backgroundColor = .clear
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        web.uiDelegate = context.coordinator
        web.navigationDelegate = context.coordinator
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true } // Safari → Desenvolvedor → iPad
        #endif
        context.coordinator.webView = web

        LocalServer.shared.start {
            MainActor.assumeIsolated {
                _ = web.load(URLRequest(url: LocalServer.baseURL.appendingPathComponent("index.html")))
            }
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
