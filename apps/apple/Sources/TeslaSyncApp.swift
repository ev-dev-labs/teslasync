import SwiftUI

/// Entry point for the TeslaSync native client.
///
/// A single SwiftUI `App` drives both the iOS/iPadOS and macOS targets
/// (adaptive layout, ADR-002). The window roots in `RootView`, the authentication
/// gate (P4/P5): it shows onboarding/sign-in until a session exists, then mounts
/// the navigation shell. The shared `AuthCoordinator` is owned here so its state
/// outlives any individual screen.
@main
struct TeslaSyncApp: App {
    @State private var selection: AppRoute? = .dashboard
    @State private var auth = AuthCoordinator.bootstrap()

    var body: some Scene {
        WindowGroup {
            RootView(coordinator: auth, selection: $selection)
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
