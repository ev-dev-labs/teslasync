import SwiftUI

// The Charging detail header + the hero/battery/stat sections (web `ChargingDetailPage.tsx`
// header, the five gauge `GlassPanel`s, the Battery-Progress panel, and the eight headline
// stat cards). Unit-bearing values format at the render boundary through `Units` (SI in,
// display out — ADR-005); the gauges and stat cards mirror the web `RadialGauge` /
// `StatCard` shapes natively. Each section renders verbatim data badges and the stat grid
// reflows for compact iPhone vs. regular macOS/iPad width.

// MARK: - Header (web header: date title + vehicle + DC/AC + state + charger + place badges)

/// The page header: the session date as the title, the owning vehicle, and the DC/AC,
/// live charging-state, charger-type, and start-place badges (web's wrapping badge row).
/// The `NavigationStack` supplies the back affordance the web renders as an arrow link.
struct ChargingDetailHeader: View {
    let session: ChargingSessionDetail
    let vehicle: ChargingDetailVehicle?
    let live: ChargingTelemetryLatest?

    private var isDC: Bool { ChargingDetailDerivations.isDC(session) }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: dateTitle)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            if let vehicle {
                Text(verbatim: vehicle.displayName)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.sm) { badges }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var badges: some View {
        ChargingValueBadge(text: isDC ? "DC" : "AC", tone: isDC ? .warning : .info)
        if let state = live?.chargingState, !state.isEmpty {
            ChargingValueBadge(text: state, tone: ChargingStateTone.tone(state))
        }
        if let type = session.chargerType, !type.isEmpty {
            ChargingValueBadge(text: type, tone: .neutral)
        }
        if let place = session.startPlace, !place.isEmpty {
            ChargingValueBadge(text: place, tone: .neutral, systemImage: "mappin")
        }
    }

    private var dateTitle: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: session.startedAt)
    }
}

// MARK: - Value badge (web `Badge` rendering a runtime data string verbatim)

/// A capsule badge rendering a runtime telemetry string verbatim with a semantic tone
/// (web `<Badge variant=…>{value}</Badge>`). Status / charger / place strings come from the
/// vehicle, not the string catalog, so they render verbatim.
struct ChargingValueBadge: View {
    let text: String
    var tone: TSTone = .neutral
    var systemImage: String?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage).font(.caption2)
            }
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Metric gauge (web `RadialGauge` — value + unit + ring at value/max)

/// A radial gauge mirroring the web `RadialGauge`: a ring filled to `fraction` (value over
/// max) with the absolute value, unit, and label centered. Built from design-token shapes
/// (the shared `TSRadialGauge` only renders a percentage), so it shows the real metric.
struct ChargingMetricGauge: View {
    let fraction: Double
    let value: String
    let unit: String
    let label: LocalizedStringKey
    var colorIndex: Int = 0

    private var clamped: Double { min(max(fraction, 0), 1) }

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
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(verbatim: value)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    if !unit.isEmpty {
                        Text(verbatim: unit).font(Font.TS.bodySm).foregroundStyle(Color.TS.textMuted)
                    }
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

// MARK: - Stat card (web `StatCard` — icon + label + value + unit + optional sublabel)

/// One headline metric (web `StatCard`): a muted label with a tinted icon, the value with
/// an optional unit suffix, and an optional supporting sublabel. The caller pre-formats the
/// value/sublabel at the render boundary.
struct ChargingStatCard: View {
    let title: LocalizedStringKey
    let value: String
    var unit: String?
    let systemImage: String
    var tone: TSTone = .accent
    var sublabel: String?

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: value)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let unit, !unit.isEmpty {
                        Text(verbatim: unit).font(Font.TS.bodySm).foregroundStyle(Color.TS.textMuted)
                    }
                }
                if let sublabel {
                    Text(verbatim: sublabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Hero gauges (web GlassPanel1–5 — energy / end-SoC / peak-power / duration / avg-power)

/// The five hero gauges, each in its own glass panel (web `GlassPanel1`…`GlassPanel5`).
/// Maxima mirror the web (energy floor 80, DC vs. AC power ceilings, 120-min duration
/// floor); values convert at the render boundary.
struct ChargingHeroGaugeSection: View {
    let session: ChargingSessionDetail
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]
    private var isDC: Bool { ChargingDetailDerivations.isDC(session) }
    private var powerCeiling: Double { isDC ? 250 : 22 }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            panel(energyGauge)
            panel(endSocGauge)
            panel(peakPowerGauge)
            panel(durationGauge)
            panel(avgPowerGauge)
        }
    }

    private func panel(_ gauge: ChargingMetricGauge) -> some View {
        TSGlassPanel { gauge.frame(maxWidth: .infinity) }
    }

    private var energyGauge: ChargingMetricGauge {
        let display = Units.convertEnergy(session.totalEnergyAddedWh, units)
        return ChargingMetricGauge(
            fraction: display / max(display, 80),
            value: ChargingDetailFormat.number(display, decimals: 1),
            unit: units.energy,
            label: "charging.detail.energyAdded",
            colorIndex: 4
        )
    }

    private var endSocGauge: ChargingMetricGauge {
        let soc = session.endSocPct ?? 0
        return ChargingMetricGauge(
            fraction: soc / 100,
            value: ChargingDetailFormat.number(soc, decimals: 0),
            unit: "%",
            label: "charging.detail.endSoc",
            colorIndex: 2
        )
    }

    private var peakPowerGauge: ChargingMetricGauge {
        let kilowatts = (session.peakPowerW ?? 0) / 1000
        return ChargingMetricGauge(
            fraction: kilowatts / powerCeiling,
            value: ChargingDetailFormat.number(kilowatts, decimals: 1),
            unit: "kW",
            label: "charging.detail.peakPower",
            colorIndex: 6
        )
    }

    private var durationGauge: ChargingMetricGauge {
        let minutes = Double(ChargingDetailDerivations.durationMinutes(session.startedAt, session.endedAt))
        return ChargingMetricGauge(
            fraction: minutes / max(minutes, 120),
            value: ChargingDetailFormat.number(minutes, decimals: 0),
            unit: "min",
            label: "charging.detail.duration",
            colorIndex: 1
        )
    }

    private var avgPowerGauge: ChargingMetricGauge {
        let kilowatts = (session.avgPowerW ?? 0) / 1000
        return ChargingMetricGauge(
            fraction: kilowatts / powerCeiling,
            value: ChargingDetailFormat.number(kilowatts, decimals: 1),
            unit: "kW",
            label: "charging.detail.avgPower",
            colorIndex: 0
        )
    }
}

// MARK: - Battery progress (web GlassPanel6 — start/end SoC bars + gained summary)

/// The Battery-Progress panel (web `GlassPanel6`): the start/end SoC meters plus the
/// SoC-gained / range-gained / energy-added summary, with the SoC-range help affordance.
struct ChargingBatteryProgressSection: View {
    let session: ChargingSessionDetail
    @Environment(\.tsUnits) private var units

    private let summaryColumns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.xs) {
                    TSPanelTitle("charging.detail.batteryProgress")
                    Image(systemName: "info.circle")
                        .font(.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityLabel(Text("help.charging.socRange.aria"))
                }
                meter("charging.detail.startSoc", value: session.startSocPct, tone: .warning)
                meter("charging.detail.endSoc", value: session.endSocPct, tone: .success)
                LazyVGrid(columns: summaryColumns, spacing: TSSpacing.md) { summary }
            }
        }
    }

    private func meter(_ label: LocalizedStringKey, value: Double?, tone: TSTone) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                TSMetricLabel(label)
                Spacer(minLength: TSSpacing.sm)
                TSCode(ChargingDetailFormat.percent(value))
            }
            TSMetricBar(fraction: (value ?? 0) / 100, tone: tone)
        }
    }

    @ViewBuilder
    private var summary: some View {
        summaryCell("charging.detail.socGained",
                    ChargingDetailFormat.socGained(start: session.startSocPct, end: session.endSocPct))
        summaryCell("charging.detail.rangeGained", rangeGained)
        summaryCell("charging.detail.energyAdded", Units.formatEnergy(session.totalEnergyAddedWh, units))
    }

    private func summaryCell(_ label: LocalizedStringKey, _ value: String) -> some View {
        VStack(spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            Text(verbatim: value).font(Font.TS.panel).fontWeight(.bold).foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity)
    }

    private var rangeGained: String {
        guard let meters = ChargingDetailDerivations.addedDistanceM(session) else {
            return ChargingDetailFormat.emptyValue
        }
        return Units.formatDistance(meters, units)
    }
}
