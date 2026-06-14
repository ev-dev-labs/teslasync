import SwiftUI

/// One endpoint toggle's presentation (web `pollingEndpoints` / `onDemandEndpoints` /
/// `commandEndpoints` records). The `key` matches the wire flag; the label + description
/// resolve from the catalog.
struct FleetAPIEndpointDescriptor: Identifiable {
    let key: String
    let title: LocalizedStringKey
    let desc: LocalizedStringKey

    var id: String {
        key
    }
}

/// The endpoint label/description catalog, ported verbatim from the web page's three
/// `t(...)` endpoint arrays. `@MainActor` because the entries carry `LocalizedStringKey`
/// (non-`Sendable`) and are only read from SwiftUI view bodies.
@MainActor
enum FleetAPIEndpointCatalog {
    static let polling: [FleetAPIEndpointDescriptor] = [
        .init(key: "vehicle_discovery", title: "Vehicle Discovery", desc: "List vehicles from Tesla"),
        .init(key: "charge_state", title: "Charge State", desc: "Battery & charging data"),
        .init(key: "climate_state", title: "Climate State", desc: "Climate & temperature data"),
        .init(key: "drive_state", title: "Drive State", desc: "Location & speed data"),
        .init(key: "location_data", title: "Location Data", desc: "GPS coordinates"),
        .init(key: "vehicle_state", title: "Vehicle State", desc: "Locks, doors, odometer"),
        .init(key: "vehicle_config", title: "Vehicle Config", desc: "Model, trim, options")
    ]

    static let onDemand: [FleetAPIEndpointDescriptor] = [
        .init(key: "on_demand_vehicle_discovery", title: "Vehicle Discovery", desc: "Sync vehicles from Tesla"),
        .init(key: "on_demand_charge_state", title: "Charge State", desc: "Battery & charging data"),
        .init(key: "on_demand_climate_state", title: "Climate State", desc: "Climate & temperature data"),
        .init(key: "on_demand_drive_state", title: "Drive State", desc: "Location & speed data"),
        .init(key: "on_demand_location_data", title: "Location Data", desc: "GPS coordinates"),
        .init(key: "on_demand_vehicle_state", title: "Vehicle State", desc: "Locks, doors, odometer"),
        .init(key: "on_demand_vehicle_config", title: "Vehicle Config", desc: "Model, trim, options"),
        .init(key: "nearby_charging_sites", title: "Nearby Charging", desc: "Supercharger locations"),
        .init(key: "release_notes", title: "Release Notes", desc: "Firmware release notes"),
        .init(key: "recent_alerts", title: "Recent Alerts", desc: "Vehicle alert history"),
        .init(key: "service_data", title: "Service Data", desc: "Service history & status")
    ]

    static let commands: [FleetAPIEndpointDescriptor] = [
        .init(key: "wake_up", title: "Wake Up", desc: "Wake vehicle from sleep"),
        .init(key: "commands", title: "Vehicle Commands", desc: "Lock, unlock, climate, etc.")
    ]
}

/// API Endpoint Controls card (web GlassPanel #3): the polling / on-demand / command toggle
/// grids plus the telemetry-capture section. Renders the controls when the polling config is
/// present, and an empty state otherwise.
struct FleetAPIEndpointsPanel: View {
    let model: FleetAPIPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                FleetAPIPanelHeader(
                    systemImage: "shield.lefthalf.filled",
                    tone: .info,
                    title: "API Endpoint Controls"
                ) {
                    subtitle
                }
                if model.polling != nil {
                    FleetAPIEndpointSection(
                        title: "Polling Endpoints",
                        descriptors: FleetAPIEndpointCatalog.polling,
                        model: model
                    )
                    FleetAPIEndpointSection(
                        title: "On-Demand Endpoints",
                        descriptors: FleetAPIEndpointCatalog.onDemand,
                        model: model
                    )
                    FleetAPIEndpointSection(
                        title: "Commands",
                        descriptors: FleetAPIEndpointCatalog.commands,
                        model: model
                    )
                    FleetAPITelemetrySection(model: model)
                } else {
                    TSEmptyState(title: "common.noData", systemImage: "switch.2")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, TSSpacing.lg)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("API Endpoint Controls"))
    }

    private var subtitle: some View {
        HStack(spacing: TSSpacing.xs) {
            Text("Toggle individual Tesla Fleet API endpoints on or off")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if model.polling != nil {
                enabledChip
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusInfo)
            }
        }
    }

    /// Web `({enabledCount}/{totalCount} {t('enabled')})` — the live toggle tally.
    private var enabledChip: Text {
        Text(verbatim: "(\(model.enabledCount)/\(model.totalCount) ")
            + Text("enabled")
            + Text(verbatim: ")")
    }
}

/// A titled grid of endpoint toggle rows (web section: an uppercase label + a responsive
/// grid of `EndpointToggle`s). The grid is adaptive — multi-column on macOS/iPad, single on
/// iPhone (ADR-002/006).
struct FleetAPIEndpointSection: View {
    let title: LocalizedStringKey
    let descriptors: [FleetAPIEndpointDescriptor]
    let model: FleetAPIPageModel

    @MainActor private static let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.sm)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .textCase(.uppercase)
            LazyVGrid(columns: Self.columns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(descriptors) { descriptor in
                    FleetAPIEndpointRow(
                        title: descriptor.title,
                        desc: descriptor.desc,
                        isOn: model.polling?[descriptor.key] ?? false,
                        isBusy: model.isPollingInFlight
                    ) {
                        Task { await model.toggleEndpoint(descriptor.key) }
                    }
                }
            }
        }
    }
}
