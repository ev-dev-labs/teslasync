import SwiftUI
import WidgetKit

/// Battery-ring tint for the complications, matching the watch glance thresholds.
/// Inlined here because the widget extension is a separate module from the watch
/// app (it cannot see the app's `WatchFormat`).
private func batteryTint(_ fraction: Double) -> Color {
    if fraction > 0.4 { return Color.TS.statusSuccess }
    if fraction > 0.2 { return Color.TS.statusWarning }
    return Color.TS.statusDanger
}

/// The primary vehicle complication: battery + range + coarse state across every
/// supported accessory family. When the cache is offline or empty it shows an
/// honest dashed/unknown state, never a stale value dressed up as live.
struct WatchVehicleComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { Color.clear }
    }

    @ViewBuilder private var content: some View {
        if let vehicle = entry.snapshot.vehicle, entry.freshness != .offline {
            vehicleBody(vehicle)
        } else {
            WatchComplicationUnavailable(family: family)
        }
    }

    @ViewBuilder private func vehicleBody(_ vehicle: VehicleStatusSummary) -> some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: vehicle.batteryFraction) {
                Image(systemName: "bolt.car.fill")
            } currentValueLabel: {
                Text(verbatim: vehicle.batteryDisplay)
            }
            .gaugeStyle(.accessoryCircular)
            .tint(batteryTint(vehicle.batteryFraction))
        case .accessoryCorner:
            Image(systemName: "bolt.car.fill")
                .font(.title3)
                .widgetLabel { Text(verbatim: vehicle.batteryDisplay) }
        case .accessoryInline:
            Label {
                Text(verbatim: "\(vehicle.batteryDisplay) · \(vehicle.rangeDisplay)")
            } icon: {
                Image(systemName: "bolt.car.fill")
            }
        case .accessoryRectangular:
            WatchRectangularVehicle(vehicle: vehicle, freshness: entry.freshness)
        default:
            Text(verbatim: vehicle.batteryDisplay)
        }
    }
}

/// The rectangular family: name, battery + range, and the coarse state, with a
/// freshness dot so the user can tell live data from cached.
private struct WatchRectangularVehicle: View {
    let vehicle: VehicleStatusSummary
    let freshness: WidgetFreshness

    private var stateKey: LocalizedStringKey {
        if vehicle.isCharging { return "widget.vehicle.charging" }
        if vehicle.isPluggedIn { return "widget.vehicle.plugged" }
        return "widget.vehicle.parked"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(freshness.tintColor)
                    .frame(width: 5, height: 5)
                Text(verbatim: vehicle.vehicleName)
                    .font(.headline)
                    .lineLimit(1)
            }
            Text(verbatim: "\(vehicle.batteryDisplay) · \(vehicle.rangeDisplay)")
                .lineLimit(1)
            Label(stateKey, systemImage: vehicle.isCharging ? "bolt.fill" : "parkingsign")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The charging complication: progress and a self-updating finish countdown while a
/// session is active; an idle/offline state otherwise.
struct WatchChargingComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { Color.clear }
    }

    @ViewBuilder private var content: some View {
        if let charging = entry.snapshot.charging, charging.isActive, entry.freshness != .offline {
            active(charging)
        } else {
            WatchComplicationUnavailable(family: family, systemImage: "bolt.slash")
        }
    }

    @ViewBuilder private func active(_ charging: ChargingSummary) -> some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: charging.batteryFraction) {
                Image(systemName: "bolt.fill")
            } currentValueLabel: {
                Text(verbatim: charging.batteryDisplay)
            }
            .gaugeStyle(.accessoryCircular)
            .tint(Color.TS.statusSuccess)
        case .accessoryInline:
            inline(charging)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label("widget.vehicle.charging", systemImage: "bolt.fill")
                    .font(.headline)
                    .lineLimit(1)
                Text(verbatim: charging.batteryDisplay)
                if let finishBy = charging.finishBy {
                    Text(finishBy, style: .timer)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            Text(verbatim: charging.batteryDisplay)
        }
    }

    @ViewBuilder private func inline(_ charging: ChargingSummary) -> some View {
        if let finishBy = charging.finishBy {
            Label {
                Text(finishBy, style: .timer)
            } icon: {
                Image(systemName: "bolt.fill")
            }
        } else {
            Label {
                Text(verbatim: charging.batteryDisplay)
            } icon: {
                Image(systemName: "bolt.fill")
            }
        }
    }
}

/// The honest unknown/offline complication state, per family.
struct WatchComplicationUnavailable: View {
    let family: WidgetFamily
    var systemImage = "car.fill"

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: 0) {
                Image(systemName: systemImage)
            } currentValueLabel: {
                Text(verbatim: "–")
            }
            .gaugeStyle(.accessoryCircular)
            .tint(Color.TS.textMuted)
        case .accessoryCorner:
            Image(systemName: systemImage)
                .font(.title3)
                .widgetLabel { Text("watch.complication.offline") }
        case .accessoryRectangular:
            Label("watch.complication.offline", systemImage: "wifi.slash")
                .font(.caption)
                .foregroundStyle(.secondary)
        default:
            Label("watch.complication.offline", systemImage: "wifi.slash")
        }
    }
}

private extension WidgetFreshness {
    /// A plain `Color` for the rectangular freshness dot (the app-side `tint`
    /// helper lives in the watch app module, not this extension).
    var tintColor: Color {
        switch self {
        case .fresh: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}
