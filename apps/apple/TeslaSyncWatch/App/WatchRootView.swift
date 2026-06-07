import SwiftUI

/// The watch app root: a single `NavigationStack` over the glance, which links to
/// the Actions and Settings surfaces. It activates the WatchConnectivity link once
/// and asks the phone for fresh data whenever the app becomes active — an honest
/// foreground refresh, never a background stream.
struct WatchRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    let model: WatchModel

    var body: some View {
        NavigationStack {
            WatchGlanceView()
                .environment(model)
        }
        .tint(Color.TS.accent)
        .task {
            model.start()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.requestRefresh()
            }
        }
    }
}
