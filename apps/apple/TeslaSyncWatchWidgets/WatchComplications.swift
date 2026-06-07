import SwiftUI
import WidgetKit

/// The vehicle complication: battery, range, and coarse state for the watch face.
struct WatchVehicleComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WatchComplicationKind.vehicle, provider: WatchComplicationProvider()) { entry in
            WatchVehicleComplicationView(entry: entry)
        }
        .configurationDisplayName(Text("watch.complication.vehicle.name"))
        .description(Text("watch.complication.vehicle.description"))
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular, .accessoryCorner])
    }
}

/// The charging complication: progress and a finish countdown while charging.
struct WatchChargingComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WatchComplicationKind.charging, provider: WatchComplicationProvider()) { entry in
            WatchChargingComplicationView(entry: entry)
        }
        .configurationDisplayName(Text("watch.complication.charging.name"))
        .description(Text("watch.complication.charging.description"))
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}

/// Stable kinds for the watch complications (used by WidgetKit + reload requests).
enum WatchComplicationKind {
    static let vehicle = "TeslaSyncWatchVehicle"
    static let charging = "TeslaSyncWatchCharging"
}
