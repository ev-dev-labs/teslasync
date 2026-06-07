import SwiftUI

/// Entry point for the TeslaSync Apple Watch companion.
///
/// A single SwiftUI watch app (modern `WKApplication`, no legacy WatchKit
/// extension). It owns the `WatchModel`, which hydrates last-known values from the
/// on-wrist cache and applies the coalesced sync payloads the iPhone pushes over
/// WatchConnectivity. There is no networking and no background stream here — the
/// companion is a glanceable, honest mirror of the data the phone last shared
/// (ADR-013), with confirmed quick actions relayed to the phone.
@main
struct TeslaSyncWatchApp: App {
    @State private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            WatchRootView(model: model)
        }
    }
}
