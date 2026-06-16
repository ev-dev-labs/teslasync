import SwiftUI

// The Driving detail data panels (web `MoreDetailsPanel`, `EnergySummaryPanel`,
// `CostSavingsPanel`, `JourneyDetailsPanel`, `WhyEndedPanel`) + the two opt-in AI surfaces
// (`AIDriveCoaching`, `AISpeedProfileInsights`). Unit-bearing values format at the render
// boundary through `Units` (SI in, display out — ADR-005); each grid reflows for compact vs.
// regular width and every panel resolves its own success/empty from the bound state.

// MARK: - Metric tile (web centered label/value cell)

/// One label-over-value tile (web `<div className="text-center">…`). The value is caller-
/// formatted at the render boundary; the tone tints it with a design-token status colour,
/// matching the web's semantic colouring without raw neon.
struct DriveMetricTile: View {
    let label: LocalizedStringKey
    let value: String
    var tone: TSTone = .accent

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(tone.color)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// A titled glass panel with a tinted icon header (web panel `<h3>` row).
struct DriveDetailPanel<Content: View>: View {
    let title: LocalizedStringKey
    let systemImage: String
    var tone: TSTone = .accent
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: systemImage).foregroundStyle(tone.color).accessibilityHidden(true)
                    TSPanelTitle(title)
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - More details (web `MoreDetailsPanel`)

/// The more-details panel: odometer + range endpoints, elevation summary, energy in/out,
/// consumption, then avg power, avg temps, min speed, battery used, and net consumption.
struct DriveMoreDetailsSection: View {
    let record: DriveDetailRecord
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]
    private var isMiles: Bool {
        units.distance == "mi"
    }

    var body: some View {
        DriveDetailPanel(title: "driveDetail.moreDetails", systemImage: "waveform.path.ecg") {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                DriveMetricTile(
                    label: "driveDetail.odometer",
                    value: distancePair(stats.odometerStartM, stats.odometerEndM),
                    tone: .accent
                )
                DriveMetricTile(
                    label: "driveDetail.rangeStartEnd",
                    value: distancePair(stats.startRangeM, stats.endRangeM),
                    tone: .success
                )
                DriveMetricTile(label: "driveDetail.elevSummary", value: elevSummaryText, tone: .success)
                DriveMetricTile(
                    label: "driveDetail.energyConsumed",
                    value: Units.formatEnergy(stats.energyWh, units),
                    tone: .warning
                )
                DriveMetricTile(
                    label: "driveDetail.energyRecovered",
                    value: Units.formatEnergy(stats.regenWh, units),
                    tone: .success
                )
                DriveMetricTile(label: "driveDetail.consumptionRate", value: consumptionText, tone: .accent)
            }
            Divider().overlay(Color.TS.border)
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                DriveMetricTile(
                    label: "driveDetail.avgPower",
                    value: "\(DriveDetailFormat.number(stats.avgPowerW / 1000, decimals: 1)) kW",
                    tone: .warning
                )
                if let outside = stats.avgOutsideTempC {
                    DriveMetricTile(
                        label: "driveDetail.avgOutsideTemp",
                        value: Units.formatTemperature(outside, units),
                        tone: .info
                    )
                }
                if let inside = stats.avgInsideTempC {
                    DriveMetricTile(
                        label: "driveDetail.avgInsideTemp",
                        value: Units.formatTemperature(inside, units),
                        tone: .warning
                    )
                }
                DriveMetricTile(
                    label: "driveDetail.minSpeed",
                    value: Units.formatSpeed(stats.minSpeedMps, units),
                    tone: .neutral
                )
                DriveMetricTile(label: "driveDetail.batteryUsed", value: batteryUsedText, tone: .warning)
                DriveMetricTile(
                    label: "driveDetail.netEnergy",
                    value: Units.formatEnergy(stats.energyWh - stats.regenWh, units),
                    tone: .accent
                )
            }
        }
    }

    private var consumptionText: String {
        guard stats.consumptionWhPerKm > 0 else { return DriveDetailFormat.emptyValue }
        let value = DriveDetailFormat.efficiencyDisplay(whPerKm: stats.consumptionWhPerKm, isMiles: isMiles)
        return "\(DriveDetailFormat.number(value, decimals: 0)) \(DriveDetailFormat.efficiencyUnit(isMiles: isMiles))"
    }

    private var batteryUsedText: String {
        guard let used = stats.batteryUsedPct else { return DriveDetailFormat.emptyValue }
        return "\(DriveDetailFormat.number(used, decimals: 0))%"
    }

    private var elevSummaryText: String {
        let gain = DriveDetailFormat.number(stats.elevGainM, decimals: 0)
        let loss = DriveDetailFormat.number(stats.elevLossM, decimals: 0)
        return "↑ \(gain) · ↓ \(loss) m"
    }

    private func distancePair(_ startM: Double?, _ endM: Double?) -> String {
        guard let startM, let endM, startM > 0 || endM > 0 else { return DriveDetailFormat.emptyValue }
        let start = Units.convertDistance(startM, units)
        let end = Units.convertDistance(endM, units)
        return "\(DriveDetailFormat.pair(start, end, decimals: 0)) \(units.distance)"
    }
}

// MARK: - Energy summary (web `EnergySummaryPanel`)

/// The energy-summary panel: consumed, recovered, net, efficiency, battery used (with the
/// start→end sub-label), and range used.
struct DriveEnergySummarySection: View {
    let record: DriveDetailRecord
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]
    private var isMiles: Bool {
        units.distance == "mi"
    }

    var body: some View {
        DriveDetailPanel(title: "driveDetail.energySummary", systemImage: "bolt.batteryblock", tone: .success) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                DriveMetricTile(
                    label: "driveDetail.energyConsumed",
                    value: Units.formatEnergy(stats.energyWh, units),
                    tone: .warning
                )
                DriveMetricTile(
                    label: "driveDetail.energyRecovered",
                    value: Units.formatEnergy(stats.regenWh, units),
                    tone: .success
                )
                DriveMetricTile(
                    label: "driveDetail.netConsumption",
                    value: Units.formatEnergy(stats.energyWh - stats.regenWh, units),
                    tone: .accent
                )
                DriveMetricTile(label: "driveDetail.efficiency", value: efficiencyText, tone: .accent)
                DriveMetricTile(label: "driveDetail.batteryUsed", value: batteryUsedText, tone: .warning)
                DriveMetricTile(label: "driveDetail.rangeUsed", value: rangeUsedText, tone: .success)
            }
        }
    }

    private var efficiencyText: String {
        guard stats.consumptionWhPerKm > 0 else { return DriveDetailFormat.emptyValue }
        let value = DriveDetailFormat.efficiencyDisplay(whPerKm: stats.consumptionWhPerKm, isMiles: isMiles)
        return "\(DriveDetailFormat.number(value, decimals: 0)) \(DriveDetailFormat.efficiencyUnit(isMiles: isMiles))"
    }

    private var batteryUsedText: String {
        guard let used = stats.batteryUsedPct else { return DriveDetailFormat.emptyValue }
        let start = record.startBatteryPct.map { DriveDetailFormat.number($0, decimals: 0) } ?? "?"
        let end = record.endBatteryPct.map { DriveDetailFormat.number($0, decimals: 0) } ?? "?"
        return "\(DriveDetailFormat.number(used, decimals: 0))% (\(start)% → \(end)%)"
    }

    private var rangeUsedText: String {
        guard let start = stats.startRangeM, let end = stats.endRangeM else { return DriveDetailFormat.emptyValue }
        return Units.formatDistance(start - end, units)
    }
}

// MARK: - Cost & savings (web `CostSavingsPanel`)

/// The cost-and-savings panel: trip cost (with the per-kWh rate sub-label), cost per distance,
/// and — when the gas equivalent costs more — the gas-cost-equivalent, savings, and savings %.
struct DriveCostSavingsSection: View {
    let record: DriveDetailRecord
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]
    private var isMiles: Bool {
        units.distance == "mi"
    }

    private var gasCost: Double {
        DriveDetailFormat.gasCost(distanceM: record.distanceM)
    }

    private var evCost: Double {
        DriveDetailFormat.evCost(energyWh: stats.energyWh)
    }

    private var savings: Double {
        gasCost - evCost
    }

    var body: some View {
        DriveDetailPanel(title: "driveDetail.costSavings", systemImage: "dollarsign.circle", tone: .success) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                VStack(spacing: 2) {
                    DriveMetricTile(
                        label: "driveDetail.tripCost",
                        value: DriveDetailFormat.currency(evCost),
                        tone: .success
                    )
                    Text(verbatim: rateSub).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
                if record.distanceM > 0 {
                    DriveMetricTile(
                        label: costPerUnitTitle,
                        value: DriveDetailFormat.currency(DriveDetailFormat.costPerDistance(
                            energyWh: stats.energyWh,
                            distanceM: record.distanceM,
                            isMiles: isMiles
                        ) ?? 0, decimals: 3),
                        tone: .accent
                    )
                }
                if savings > 0 {
                    VStack(spacing: 2) {
                        DriveMetricTile(
                            label: "driveDetail.gasCostEquiv",
                            value: DriveDetailFormat.currency(gasCost),
                            tone: .danger
                        )
                        Text(verbatim: mpgSub).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    }
                    DriveMetricTile(
                        label: "driveDetail.gasSavings",
                        value: DriveDetailFormat.currency(savings),
                        tone: .success
                    )
                    DriveMetricTile(
                        label: "driveDetail.savingsPct",
                        value: "\(DriveDetailFormat.number(savings / gasCost * 100, decimals: 0))%",
                        tone: .success
                    )
                }
            }
        }
    }

    private var rateSub: String {
        let rate = DriveDetailFormat.number(DriveDetailFormat.defaultCostPerKwh, decimals: 2)
        return "\(DriveDetailFormat.defaultCurrencySymbol)\(rate)/kWh"
    }

    private var mpgSub: String {
        "\(DriveDetailFormat.number(DriveDetailFormat.defaultGasEfficiencyMpg, decimals: 0)) MPG"
    }

    private var costPerUnitTitle: LocalizedStringKey {
        isMiles ? "driveDetail.costPerMi" : "driveDetail.costPerKm"
    }
}

// MARK: - Journey details (web `JourneyDetailsPanel`)

/// One journey endpoint's display fields (web start / destination block), bundled so the
/// endpoint view stays within the parameter budget.
private struct DriveJourneyEndpoint {
    let titleKey: LocalizedStringKey
    let systemImage: String
    let tone: TSTone
    let place: String
    let timeText: String
    let battery: Double?
}

/// The journey-details panel: the start + destination endpoints, each with the address (or
/// coordinates), the timestamp, and the battery level.
struct DriveJourneyDetailsSection: View {
    let record: DriveDetailRecord

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.lg)]

    var body: some View {
        DriveDetailPanel(title: "driveDetail.journeyDetails", systemImage: "location.north.line") {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                endpoint(DriveJourneyEndpoint(
                    titleKey: "driveDetail.start",
                    systemImage: "mappin.circle.fill",
                    tone: .success,
                    place: startPlace,
                    timeText: DriveDetailDateText.dateTime(record.startedAt),
                    battery: record.startBatteryPct
                ))
                endpoint(DriveJourneyEndpoint(
                    titleKey: "driveDetail.destination",
                    systemImage: "flag.checkered.circle.fill",
                    tone: .danger,
                    place: endPlace,
                    timeText: endTimeText,
                    battery: record.endBatteryPct
                ))
            }
        }
    }

    private func endpoint(_ endpoint: DriveJourneyEndpoint) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Label(endpoint.titleKey, systemImage: endpoint.systemImage)
                .font(Font.TS.bodySm).fontWeight(.semibold).foregroundStyle(endpoint.tone.color)
            Text(verbatim: endpoint.place).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: endpoint.timeText).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.xs) {
                TSMetricLabel("driveDetail.battery")
                Text(verbatim: endpoint.battery.map { "\(DriveDetailFormat.int($0))%" } ?? "?%")
                    .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var startPlace: String {
        if let address = record.startAddress, !address.isEmpty { return address }
        if let lat = record.startLat, let lon = record.startLon { return DriveDetailFormat.coordinate(
            latitude: lat,
            longitude: lon
        ) }
        return String(localized: "driveDetail.noAddress")
    }

    private var endPlace: String {
        if let address = record.endAddress, !address.isEmpty { return address }
        if let lat = record.endLat, let lon = record.endLon { return DriveDetailFormat.coordinate(
            latitude: lat,
            longitude: lon
        ) }
        return String(localized: record.endedAt == nil ? "driveDetail.inProgress" : "driveDetail.noAddress")
    }

    private var endTimeText: String {
        guard let end = record.endedAt else { return String(localized: "driveDetail.inProgress") }
        return DriveDetailDateText.dateTime(end)
    }
}
