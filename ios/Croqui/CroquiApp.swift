import SwiftUI

@main
struct CroquiApp: App {
    var body: some Scene {
        WindowGroup {
            CroquiWebView()
                .ignoresSafeArea() // a página cuida das áreas seguras (viewport-fit=cover + env())
                .background(Color("LaunchBackground"))
        }
    }
}
