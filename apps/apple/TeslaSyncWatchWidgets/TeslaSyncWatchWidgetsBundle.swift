import SwiftUI
import WidgetKit

/// The TeslaSync watch complication extension entry point. Bundles the glanceable
/// watch-face complications; each is a `StaticConfiguration` over the shared
/// `WatchComplicationProvider`, reading cached data from the watch App Group store
/// (no networking in the extension).
@main
struct TeslaSyncWatchWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WatchVehicleComplication()
        WatchChargingComplication()
    }
}
