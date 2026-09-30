import Foundation
import Network

/// Servidor HTTP mínimo, só em 127.0.0.1, que entrega o app web embutido no bundle (pasta "www").
///
/// Por que não `loadFileURL`: páginas em file:// têm origem opaca no WKWebView — módulos ES são
/// bloqueados e o IndexedDB não persiste de forma confiável. Servindo em http://127.0.0.1:PORTA o app
/// tem uma origem fixa (os croquis salvos sobrevivem entre aberturas) e tudo funciona offline.
final class LocalServer {
    static let shared = LocalServer()
    /// Porta FIXA: a origem (e portanto os dados salvos) depende dela. Não mude depois de usar o app.
    static let port: UInt16 = 47823
    static var baseURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "croqui.localserver", qos: .userInitiated)
    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true)
    private var readyCallbacks: [() -> Void] = []
    private var isReady = false

    /// Chama `onReady` (na main queue) quando o servidor estiver aceitando conexões.
    func start(onReady: @escaping () -> Void) {
        queue.async {
            if self.isReady { DispatchQueue.main.async(execute: onReady); return }
            self.readyCallbacks.append(onReady)
            guard self.listener == nil else { return }
            do {
                let params = NWParameters.tcp
                params.requiredInterfaceType = .loopback
                params.allowLocalEndpointReuse = true
                let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.port)!)
                listener.newConnectionHandler = { [weak self] conn in self?.serve(conn) }
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self else { return }
                    switch state {
                    case .ready:
                        self.isReady = true
                        let cbs = self.readyCallbacks
                        self.readyCallbacks.removeAll()
                        cbs.forEach { cb in DispatchQueue.main.async(execute: cb) }
                    case .failed(let error):
                        NSLog("[Croqui] servidor local falhou: \(error)")
                        self.listener?.cancel()
                        self.listener = nil
                        // tenta de novo em 1 s (ex.: porta presa por uma instância anterior)
                        self.queue.asyncAfter(deadline: .now() + 1) {
                            let cbs = self.readyCallbacks
                            self.readyCallbacks.removeAll()
                            cbs.forEach { self.start(onReady: $0) }
                        }
                    default: break
                    }
                }
                self.listener = listener
                listener.start(queue: self.queue)
            } catch {
                NSLog("[Croqui] não consegui abrir a porta \(Self.port): \(error)")
            }
        }
    }

    // MARK: - HTTP

    private func serve(_ conn: NWConnection) {
        conn.start(queue: queue)
        receiveRequest(conn, buffer: Data())
    }

    private func receiveRequest(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { conn.cancel(); return }
            var buf = buffer
            if let data { buf.append(data) }
            if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buf[..<end.lowerBound], as: UTF8.self)
                self.respond(conn, requestHead: head)
            } else if isComplete || error != nil || buf.count > 256 * 1024 {
                conn.cancel()
            } else {
                self.receiveRequest(conn, buffer: buf)
            }
        }
    }

    private func respond(_ conn: NWConnection, requestHead: String) {
        let firstLine = requestHead.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
        let parts = firstLine.split(separator: " ")
        let method = parts.first.map(String.init) ?? "GET"
        var path = parts.count > 1 ? String(parts[1]) : "/"
        if let q = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path
        if path.hasSuffix("/") { path += "index.html" }

        // Nada de sair da pasta www.
        let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        let inside = file.path.hasPrefix(root.standardizedFileURL.path)

        var status = "200 OK"
        var body = Data()
        var type = "application/octet-stream"
        if inside, let data = try? Data(contentsOf: file) {
            body = data
            type = Self.mime(for: file.pathExtension)
        } else {
            status = "404 Not Found"
            body = Data("not found".utf8)
            type = "text/plain; charset=utf-8"
        }
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: \(type)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Cache-Control: no-cache\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        if method != "HEAD" { out.append(body) }
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    private static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
