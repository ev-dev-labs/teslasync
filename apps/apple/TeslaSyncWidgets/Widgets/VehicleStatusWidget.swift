import SwiftUI
import WidgetKit

/// Vehicle status widget: battery, range, charge/plug state, and a coarse location
/// with honest freshness. Deep-links to the Vehicles route.
struct VehicleStatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.vehicleStatus, provider: TeslaSyncTimelineProvider()) { entry in
            VehicleStatusEntryView(entry: entry)
        }
        .configurationDisplayName(Text("widget.vehicle.displayName"))
        .description(Text("widget.vehicle.description"))
        .supportedFamilies(WidgetFamilies.systemAndAccessories)
    }
}

struct VehicleStatusEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .widgetURL(WidgetDeepLink.vehicleStatus.url)
            .widgetSurface(for: family)
    }

    @ViewBuilder private var content: some View {
        if let vehicle = entry.snapshot.vehicle, entry.freshness != .offline {
            loaded(vehicle)
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder private func loaded(_ vehicle: VehicleStatusSummary) -> some View {
        switch family {
        case .systemSmall:
            VehicleSmallView(vehicle: vehicle, freshness: entry.freshness)
        case .systemMedium:
            VehicleMediumView(vehicle: vehicle, freshness: entry.freshness)
        case .systemLarge, .systemExtraLarge:
            VehicleLargeView(vehicle: vehicle, freshness: entry.freshness)
        default:
            accessory(vehicle)
        }
    }

    @ViewBuilder private func accessory(_ vehicle: VehicleStatusSummary) -> some View {
        #if os(iOS)
            switch family {
            case .accessoryCircular:
                WidgetAccessoryGauge(
                    fraction: vehicle.batteryFraction,
                    label: vehicle.batteryDisplay,
                    systemImage: "bolt.car.fill"
                )
            case .accessoryInline:
                WidgetAccessoryInline(
                    systemImage: "bolt.car.fill",
                    text: Text(verbatim: "\(vehicle.batteryDisplay) · \(vehicle.rangeDisplay)")
                )
            case .accessoryRectangular:
                WidgetAccessoryRectangular(
                    titleKey: "widget.vehicle.displayName",
                    systemImage: "bolt.car.fill",
                    primary: Text(verbatim: "\(vehicle.batteryDisplay) · \(vehicle.rangeDisplay)"),
                    secondary: vehicle.locationLabel.map { Text(verbatim: $0) }
                )
            default:
                VehicleSmallView(vehicle: vehicle, freshness: entry.freshness)
            }
        #else
            VehicleSmallView(vehicle: vehicle, freshness: entry.freshness)
        #endif
    }
}

private struct VehicleSmallView: View {
    let vehicle: VehicleStatusSummary
    let freshness: WidgetFreshness

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: vehicle.vehicleName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            HStack(spacing: TSSpacing.md) {
                WidgetBatteryRing(
                    fraction: vehicle.batteryFraction,
                    centerText: vehicle.batteryDisplay,
                    isCharging: vehicle.isCharging,
                    lineWidth: 7
                )
                .frame(width: 54, height: 54)
                VStack(alignment: .leading, spacing: 2) {
                    WidgetMetric(titleKey: "widget.vehicle.range", value: vehicle.rangeDisplay)
                    VehicleLocationLabel(locationLabel: vehicle.locationLabel)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct VehicleMediumView: View {
    let vehicle: VehicleStatusSummary
    let freshness: WidgetFreshness

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: vehicle.vehicleName)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                VehicleStatusBadge(vehicle: vehicle)
                Spacer(minLength: 0)
                WidgetFreshnessChip(freshness: freshness)
            }
            WidgetBatteryRing(
                fraction: vehicle.batteryFraction,
                centerText: vehicle.batteryDisplay,
                isCharging: vehicle.isCharging,
                lineWidth: 9
            )
            .frame(width: 72, height: 72)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                WidgetMetric(titleKey: "widget.vehicle.range", value: vehicle.rangeDisplay)
                VehicleLocationLabel(locationLabel: vehicle.locationLabel)
                Spacer(minLength: 0)
            }
        }
    }
}

private struct VehicleLargeView: View {
    let vehicle: VehicleStatusSummary
    let freshness: WidgetFreshness

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                WidgetSectionHeader(titleKey: "widget.vehicle.displayName", systemImage: "car.fill")
                Spacer()
                WidgetFreshnessChip(freshness: freshness)
            }
            HStack(spacing: TSSpacing.lg) {
                WidgetBatteryRing(
                    fraction: vehicle.batteryFraction,
                    centerText: vehicle.batteryDisplay,
                    isCharging: vehicle.isCharging,
                    lineWidth: 11
                )
                .frame(width: 96, height: 96)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    WidgetMetric(titleKey: "widget.vehicle.range", value: vehicle.rangeDisplay)
                    VehicleStatusBadge(vehicle: vehicle)
                    VehicleLocationLabel(locationLabel: vehicle.locationLabel)
                }
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
            WidgetUpdatedLabel(date: vehicle.sampledAt)
        }
    }
}

private struct VehicleStatusBadge: View {
    let vehicle: VehicleStatusSummary

    private var titleKey: LocalizedStringKey {
        if vehicle.isCharging { return "widget.vehicle.charging" }
        if vehicle.isPluggedIn { return "widget.vehicle.plugged" }
        return "widget.vehicle.parked"
    }

    private var systemImage: String {
        if vehicle.isCharging { return "bolt.fill" }
        if vehicle.isPluggedIn { return "powerplug.fill" }
        return "parkingsign"
    }

    var body: some View {
        Label {
            Text(titleKey)
        } icon: {
            Image(systemName: systemImage)
        }
        .font(Font.TS.caption)
        .foregroundStyle(vehicle.isCharging ? Color.TS.statusSuccess : Color.TS.textSecondary)
        .lineLimit(1)
    }
}

private struct VehicleLocationLabel: View {
    let locationLabel: String?

    var body: some View {
        Label {
            if let locationLabel {
                Text(verbatim: locationLabel)
            } else {
                Text("widget.vehicle.location.unknown")
            }
        } icon: {
            Image(systemName: "mappin.and.ellipse")
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .lineLimit(1)
    }
}
