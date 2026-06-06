import SwiftUI

/// Entry point for the TeslaSync native client.
///
/// A single SwiftUI `App` drives both the iOS/iPadOS and macOS targets
/// (adaptive layout, ADR-002). This P0 scaffold launches straight to an empty,
/// HIG-native navigation shell — pages, navigation graph, auth and live data
/// each arrive in their own later P-phase prompt.
@main
struct TeslaSyncApp: App {
    @State private var selection: AppRoute? = .dashboard

    var body: some Scene {
        WindowGroup {
            AppShell(selection: $selection)
        }
        .commands {
            AppCommands(selection: $selection)
        }
        #if os(macOS)
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        #endif
    }
}
