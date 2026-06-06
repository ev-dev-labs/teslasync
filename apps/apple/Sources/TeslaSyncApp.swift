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
    #if os(iOS)
        @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #elseif os(macOS)
        @NSApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #endif

    @State private var selection: AppRoute? = .dashboard
    @State private var auth = AuthCoordinator.bootstrap()

    private var isLiveDemo: Bool {
        ProcessInfo.processInfo.arguments.contains("-uiTestLiveDemo")
    }

    private var isPushDemo: Bool {
        ProcessInfo.processInfo.arguments.contains("-uiTestPushDemo")
    }

    var body: some Scene {
        WindowGroup {
            rootContent
        }
        .commands {
            AppCommands(selection: $selection)
        }
        #if os(macOS)
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        #endif
    }

    @ViewBuilder private var rootContent: some View {
        if isPushDemo {
            PushDemoView()
                .teslaSyncTheme()
        } else if isLiveDemo {
            LiveDemoView()
                .teslaSyncTheme()
        } else {
            RootView(coordinator: auth, selection: $selection)
                .task { connectPush() }
                .onChange(of: pushDelegate.runtime.coordinator?.pendingRoute) { _, route in
                    if let route {
                        selection = route
                        _ = pushDelegate.runtime.consumePendingRoute()
                    }
                }
        }
    }

    /// Wires the push runtime to the app's auth + API base URL once at launch. The
    /// base URL comes from the bundle (the macOS-pinned config), mirroring the
    /// facade's bootstrap convention.
    private func connectPush() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "TeslaSyncAPIBaseURL") as? String
        let baseURL = URL(string: configured ?? "https://teslasync.local") ?? URL(fileURLWithPath: "/")
        pushDelegate.runtime.connect(auth: auth, baseURL: baseURL)
    }
}
