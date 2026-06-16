import SwiftUI

// The Driving detail header + timeline + hero gauges + stat grid + the per-section error
// boundary, skeleton, and no-telemetry banner (web `DriveDetailHeader`, `DriveTimeline`,
// `HeroGauges`, `DriveStatCards`, `DriveDetailSkeleton`, and the page's `SectionErrorBoundary`
// / `AlertBanner`). Unit-bearing values format at the render boundary through `Units` (SI in,
// display out — ADR-005); the gauge + stat grids reflow for compact iPhone vs. regular
// macOS/iPad width.

// MARK: - Section error boundary (web per-section `SectionErrorBoundary fallbackTitle=…`)

/// Renders a section, or its localized failure fallback when the model marks it failed (web
/// `SectionErrorBoundary` — SwiftUI has no render-time catch, so the condition is supplied by
/// the model). The fallback shows the section's own title, mirroring the web `fallbackTitle`.
struct DriveDetailSectionBoundary<Content: View>: View {
    let fallbackTitle: LocalizedStringKey
    let failed: Bool
    var onRetry: (() -> Void)?
    @ViewBuilder var content: () -> Content

    var body: some View {
        if failed {
            TSGlassPanel {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    Text(fallbackTitle)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    if let onRetry {
                        TSButton("action.retry", variant: .ghost, size: .small, action: onRetry)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
        } else {
            content()
        }
    }
}

// MARK: - No-telemetry banner (web `AlertBanner` envelope)

/// The "no telemetry recorded" banner that replaces the four numeric-summary panels when the
/// drive only persisted start/end timestamps + battery (web `!hasMeaningfulDriveStats`).
struct DriveDetailNoTelemetryBanner: View {
    var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "info.circle",
            title: "driveDetail.noTelemetryTitle",
            message: "driveDetail.noTelemetryBody"
        )
    }
}

// MARK: - Header (web `DriveDetailHeader`: route title + vehicle · date · time)

/// The page header: the route (start → end address) as the title, and the owning vehicle with
/// the drive's start date/time as the subtitle. The `NavigationStack` supplies the back +
/// share affordances the web renders inline.
struct DriveDetailHeaderSection: View {
    let record: DriveDetailRecord
    let vehicleName: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: routeTitle)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(verbatim: subtitle)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var routeTitle: String {
        if let start = record.startAddress, let end = record.endAddress {
            return "\(start) → \(end)"
        }
        return String(localized: "driveDetail.title")
    }

    private var subtitle: String {
        let date = DriveDetailDateText.dateTime(record.startedAt)
        if let end = record.endedAt {
            return "\(vehicleName) · \(date) → \(DriveDetailDateText.time(end))"
        }
        return "\(vehicleName) · \(date)"
    }
}

// MARK: - Timeline (web `DriveTimeline`: start · duration · end + progress bar)

/// The timeline strip: the start time, total duration, and end time (or "in progress"), over a
/// gradient progress bar (web `DriveTimeline`).
struct DriveTimelineSection: View {
    let record: DriveDetailRecord

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                HStack {
                    Label {
                        Text(verbatim: DriveDetailDateText.time(record.startedAt))
                    } icon: {
                        Image(systemName: "flag.fill")
                    }
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusSuccess)
                    Spacer()
                    Text(verbatim: DriveDetailFormat.duration(minutes: DriveDetailDerivations.durationMinutes(record)))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Spacer()
                    Label {
                        endText
                    } icon: {
                        Image(systemName: "flag.checkered")
                    }
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                }
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color.TS.statusSuccess, Color.TS.accent],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: 8)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var endText: some View {
        if let end = record.endedAt {
            Text(verbatim: DriveDetailDateText.time(end))
        } else {
            Text("driveDetail.inProgress")
        }
    }
}

// MARK: - Metric gauge (web `RadialGauge` — value + unit + ring at value/max)

/// A radial gauge mirroring the web `RadialGauge`: a ring filled to `fraction` with the
/// absolute value, unit, and label centered. Built from token shapes (the shared
/// `TSRadialGauge` only renders a percentage), so it shows the real metric like the web gauge.
struct DriveMetricGauge: View {
    let fraction: Double
    let value: String
    let unit: String
    let label: LocalizedStringKey
    var colorIndex: Int = 0

    private var clamped: Double {
        min(max(fraction, 0), 1)
    }

    var body: some View {
        ZStack {
            Circle().stroke(Color.TS.border.opacity(0.3), lineWidth: 10)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(
                    TSChartPalette.color(at: colorIndex),
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: TSSpacing.xs) {
                Text(verbatim: value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                if !unit.isEmpty {
                    Text(verbatim: unit).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
                TSMetricLabel(label)
            }
            .padding(TSSpacing.md)
        }
        .frame(width: 120, height: 120)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: "\(value) \(unit)"))
    }
}

// MARK: - Hero gauges (web `HeroGauges` — distance / max-speed / duration / consumption / efficiency)

/// The five hero gauges (web `HeroGauges`). Maxima mirror the web (distance floor 100, speed
/// ceiling 250 m/s display, 60-min floor, consumption floor 300, efficiency ceiling 30); the
/// efficiency gauge only renders when the drive has start+end battery and distance, exactly as
/// the web gates it.
struct DriveHeroGaugeSection: View {
    let record: DriveDetailRecord
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    private var isMiles: Bool {
        units.distance == "mi"
    }

    var body: some View {
        TSGlassPanel {
            LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                panel(distanceGauge)
                panel(maxSpeedGauge)
                panel(durationGauge)
                panel(consumptionGauge)
                if let efficiency = efficiencyGauge {
                    panel(efficiency)
                }
            }
        }
    }

    private func panel(_ gauge: DriveMetricGauge) -> some View {
        gauge.frame(maxWidth: .infinity)
    }

    private var distanceGauge: DriveMetricGauge {
        let display = Units.convertDistance(record.distanceM, units)
        return DriveMetricGauge(
            fraction: display / max(display * 1.5, 100),
            value: DriveDetailFormat.number(display, decimals: 0),
            unit: units.distance,
            label: "driveDetail.distance",
            colorIndex: 2
        )
    }

    private var maxSpeedGauge: DriveMetricGauge {
        let display = Units.convertSpeed(stats.maxSpeedMps, units)
        let ceiling = Units.convertSpeed(250 / 3.6, units)
        return DriveMetricGauge(
            fraction: display / max(ceiling, 1),
            value: DriveDetailFormat.number(display, decimals: 0),
            unit: units.speed,
            label: "driveDetail.maxSpeed",
            colorIndex: 5
        )
    }

    private var durationGauge: DriveMetricGauge {
        let minutes = DriveDetailDerivations.durationMinutes(record)
        return DriveMetricGauge(
            fraction: minutes / max(minutes * 1.5, 60),
            value: DriveDetailFormat.number(minutes, decimals: 0),
            unit: "min",
            label: "driveDetail.duration",
            colorIndex: 4
        )
    }

    private var consumptionGauge: DriveMetricGauge {
        let display = DriveDetailFormat.efficiencyDisplay(whPerKm: stats.consumptionWhPerKm, isMiles: isMiles)
        return DriveMetricGauge(
            fraction: display / max(display * 1.5, 300),
            value: DriveDetailFormat.number(display, decimals: 0),
            unit: DriveDetailFormat.efficiencyUnit(isMiles: isMiles),
            label: "driveDetail.consumption",
            colorIndex: 3
        )
    }

    private var efficiencyGauge: DriveMetricGauge? {
        guard let batteryUsed = stats.batteryUsedPct, record.distanceM > 0 else { return nil }
        let distanceDisplay = Units.convertDistance(record.distanceM, units)
        guard distanceDisplay > 0 else { return nil }
        let value = batteryUsed / distanceDisplay * 10
        return DriveMetricGauge(
            fraction: value / 30,
            value: DriveDetailFormat.number(value, decimals: 1),
            unit: isMiles ? "%/100mi" : "%/100km",
            label: "driveDetail.efficiency",
            colorIndex: 0
        )
    }
}

// MARK: - Stat grid (web `DriveStatCards` — eight headline tiles)

/// The eight headline stat cards (web `DriveStatCards`): distance, duration, max + avg speed,
/// SoC start→end, max power, elevation gain/loss, plus the trip-cost / cost-per-distance tiles
/// when the drive used energy. Reflows from 2 columns (compact) to 4 (regular).
struct DriveStatGridSection: View {
    let record: DriveDetailRecord
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    private var isMiles: Bool {
        units.distance == "mi"
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "driveDetail.distance",
                value: Units.formatDistance(record.distanceM, units),
                systemImage: "point.topleft.down.to.point.bottomright.curvepath"
            )
            TSStatCard(
                title: "driveDetail.duration",
                value: DriveDetailFormat.duration(minutes: DriveDetailDerivations.durationMinutes(record)),
                systemImage: "clock"
            )
            TSStatCard(
                title: "driveDetail.maxSpeed",
                value: Units.formatSpeed(stats.maxSpeedMps, units),
                systemImage: "gauge.with.dots.needle.67percent"
            )
            TSStatCard(
                title: "driveDetail.avgSpeed",
                value: Units.formatSpeed(stats.avgSpeedMps, units),
                systemImage: "speedometer"
            )
            TSStatCard(title: "driveDetail.soc", value: socText, systemImage: "battery.75percent")
            TSStatCard(
                title: "driveDetail.maxPower",
                value: "\(DriveDetailFormat.number(stats.powerMaxW / 1000, decimals: 1)) kW",
                systemImage: "bolt.fill"
            )
            TSStatCard(
                title: "driveDetail.elevGain",
                value: "\(DriveDetailFormat.number(stats.elevGainM, decimals: 0)) m ↑",
                systemImage: "arrow.up.right"
            )
            TSStatCard(
                title: "driveDetail.elevLoss",
                value: "\(DriveDetailFormat.number(stats.elevLossM, decimals: 0)) m ↓",
                systemImage: "arrow.down.right"
            )
            if stats.energyWh > 0 {
                TSStatCard(
                    title: "driveDetail.tripCost",
                    value: DriveDetailFormat.currency(DriveDetailFormat.evCost(energyWh: stats.energyWh)),
                    systemImage: "dollarsign.circle"
                )
            }
            if stats.energyWh > 0, record.distanceM > 0 {
                TSStatCard(
                    title: costPerUnitTitle,
                    value: DriveDetailFormat.currency(DriveDetailFormat.costPerDistance(
                        energyWh: stats.energyWh,
                        distanceM: record.distanceM,
                        isMiles: isMiles
                    ) ?? 0, decimals: 3),
                    systemImage: "chart.line.downtrend.xyaxis"
                )
            }
        }
    }

    private var socText: String {
        let start = record.startBatteryPct.map { "\(DriveDetailFormat.int($0))%" } ?? "?%"
        let end = record.endBatteryPct.map { "\(DriveDetailFormat.int($0))%" } ?? "?%"
        return "\(start) → \(end)"
    }

    private var costPerUnitTitle: LocalizedStringKey {
        isMiles ? "driveDetail.costPerMi" : "driveDetail.costPerKm"
    }
}
