import SwiftUI
import WidgetKit

/// The TeslaSync widget extension entry point. Bundles the six glanceable widgets;
/// each is a `StaticConfiguration` over the shared `TeslaSyncTimelineProvider`,
/// reading cached data from the App Group store (no networking in the extension).
@main
struct TeslaSyncWidgetsBundle: WidgetBundle {
    var body: some Widget {
        VehicleStatusWidget()
        ChargingProgressWidget()
        RecentDriveWidget()
        AlertCountWidget()
        EnergySnapshotWidget()
        SystemHealthWidget()
    }
}
