import SwiftUI

// Section 1 of the Energy-Flow surface (web "Energy Flow Diagram" GlassPanel — the real-time
// power-flow schematic fed by `/energy/flow`). Reproduces the eight web glass panels (the outer
// frame, the Grid source, the Battery hub with its SoC radial gauge, the Motor sink, and the four
// live-breakdown chips: DC Power, AC Power, HVAC, Accessories) plus the directional flow arrows.
// The schematic flows left-to-right on regular width and top-to-bottom on compact iPhone (ADR-002);
// charging power / remaining energy are the endpoint's wire-native kW / kWh shown verbatim like the
// web. Honors Dark Mode, Dynamic Type, increased contrast (token colours), and VoiceOver.

// MARK: - Diagram section (GlassPanel1)

/// The real-time energy-flow diagram (web outer Energy-Flow-Diagram GlassPanel). Renders the live
/// charge-state badge + freshness indicator, the source → battery → sink flow row, and the
/// four-chip live breakdown — each from the bound model's `flow` snapshot.
struct EnergyFlowDiagramSection: View {
    let model: EnergyFlowPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                flowRow
                breakdownRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: Header (title + charge-state badge + live freshness)

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .foregroundStyle(TSChartPalette.color(at: 0))
                .accessibilityHidden(true)
            TSSubhead("Energy Flow Diagram")
            Spacer(minLength: TSSpacing.sm)
            if let chargeState = model.chargeState, !chargeState.isEmpty {
                TSBadge(LocalizedStringKey(chargeState), tone: model.isCharging ? .success : .neutral)
            }
            if model.hasLiveFlow {
                EnergyFlowLiveIndicator(isStale: model.flowIsStale)
            }
        }
    }

    // MARK: Flow row (Grid → Charging → Battery → Driving → Motor)

    private var flowRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                gridNode
                EnergyFlowDiagramArrow(axis: .horizontal, label: "Charging", colorIndex: 1, value: chargingValue)
                batteryNode
                EnergyFlowDiagramArrow(axis: .horizontal, label: "Driving", colorIndex: 0, value: .unavailable)
                motorNode
            }
            VStack(alignment: .center, spacing: TSSpacing.md) {
                gridNode
                EnergyFlowDiagramArrow(axis: .vertical, label: "Charging", colorIndex: 1, value: chargingValue)
                batteryNode
                EnergyFlowDiagramArrow(axis: .vertical, label: "Driving", colorIndex: 0, value: .unavailable)
                motorNode
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The live charging-power reading carried by the grid → battery arrow.
    private var chargingValue: EnergyFlowValue {
        .power(model.chargePowerKw)
    }

    /// Grid source (GlassPanel2).
    private var gridNode: some View {
        EnergyFlowDiagramNode(systemImage: "powerplug.fill", colorIndex: 1, label: "Grid", dimmed: false) {
            EmptyView()
        }
    }

    /// Battery hub with the live SoC radial gauge (GlassPanel3 + the RadialGauge chart).
    private var batteryNode: some View {
        EnergyFlowDiagramNode(systemImage: "battery.100", colorIndex: 0, label: nil, dimmed: false) {
            VStack(spacing: TSSpacing.xs) {
                TSRadialGauge(value: model.batterySocPercent / 100, label: "Battery", colorIndex: 0)
                if let remaining = model.flow?.energyRemainingKwh {
                    (Text(verbatim: EnergyFormat.number(remaining, decimals: 1) + " ") + Text("kWh"))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// Motor sink — no real-time motor telemetry on this endpoint (GlassPanel4).
    private var motorNode: some View {
        EnergyFlowDiagramNode(systemImage: "car.fill", colorIndex: 0, label: "Motor", dimmed: true) {
            Text("No live data")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    // MARK: Breakdown row (DC Power, AC Power, HVAC, Accessories)

    private let breakdownColumns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]

    private var breakdownRow: some View {
        LazyVGrid(columns: breakdownColumns, spacing: TSSpacing.md) {
            EnergyFlowChip(
                systemImage: "bolt.fill",
                colorIndex: 1,
                label: "DC Power",
                value: .power(model.flow?.dcChargingPowerKw ?? 0)
            )
            EnergyFlowChip(
                systemImage: "waveform.path.ecg",
                colorIndex: 5,
                label: "AC Power",
                value: .power(model.flow?.acChargingPowerKw ?? 0)
            )
            EnergyFlowChip(systemImage: "thermometer.medium", colorIndex: 3, label: "HVAC", value: .unavailable)
            EnergyFlowChip(systemImage: "cpu", colorIndex: 2, label: "Accessories", value: .unavailable)
        }
    }
}

// MARK: - Flow node (a labelled glass panel in the schematic)

/// One node in the flow schematic (web inner GlassPanel): a tinted SF Symbol over an optional
/// label and a detail slot (the battery hub injects its radial gauge here).
struct EnergyFlowDiagramNode<Detail: View>: View {
    let systemImage: String
    let colorIndex: Int
    let label: LocalizedStringKey?
    let dimmed: Bool
    @ViewBuilder let detail: () -> Detail

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(.system(size: 26))
                    .foregroundStyle(TSChartPalette.color(at: colorIndex))
                    .accessibilityHidden(true)
                if let label {
                    Text(label)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                detail()
            }
            .frame(maxWidth: .infinity)
            .frame(minWidth: 120)
        }
        .opacity(dimmed ? 0.5 : 1)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Flow value (a power reading or an unavailable marker)

/// A flow reading: either a charging power in kW or the wire's "no value" marker (web `N/A`).
enum EnergyFlowValue {
    case power(Double)
    case unavailable

    var isActive: Bool {
        if case let .power(value) = self { return EnergyFlowDerivations.isFlowActive(value) }
        return false
    }
}

// MARK: - Flow chip (a live breakdown reading)

/// One live-breakdown chip (web bottom-row GlassPanel): a tinted icon, a muted caption, and the
/// power reading (or the `N/A` marker), dimmed when inactive.
struct EnergyFlowChip: View {
    let systemImage: String
    let colorIndex: Int
    let label: LocalizedStringKey
    let value: EnergyFlowValue

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 18))
                    .foregroundStyle(TSChartPalette.color(at: colorIndex))
                    .accessibilityHidden(true)
                Text(label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                EnergyFlowValueText(value: value, colorIndex: colorIndex)
            }
            .frame(maxWidth: .infinity)
        }
        .opacity(value.isActive ? 1 : 0.5)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Flow arrow (a directional connector)

/// A directional flow connector (web `FlowArrow`): an uppercase label over a tinted pill carrying
/// a direction chevron and the power reading (or `N/A`), dimmed when no power is flowing.
struct EnergyFlowDiagramArrow: View {
    enum Axis { case horizontal, vertical }

    let axis: Axis
    let label: LocalizedStringKey
    let colorIndex: Int
    let value: EnergyFlowValue

    private var chevron: String {
        axis == .horizontal ? "arrow.right" : "arrow.down"
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: chevron)
                    .font(.caption2)
                    .accessibilityHidden(true)
                EnergyFlowValueText(value: value, colorIndex: colorIndex)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(TSChartPalette.color(at: colorIndex).opacity(0.12), in: Capsule())
        }
        .opacity(value.isActive ? 1 : 0.3)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Flow value text

/// Renders an `EnergyFlowValue` as "`<n>` kW" or the localized `N/A` marker.
struct EnergyFlowValueText: View {
    let value: EnergyFlowValue
    let colorIndex: Int

    var body: some View {
        switch value {
        case let .power(reading):
            (Text(verbatim: EnergyFormat.number(abs(reading), decimals: 1) + " ") + Text("kW"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(TSChartPalette.color(at: colorIndex))
        case .unavailable:
            Text("N/A")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Live freshness indicator (ADR-013 staleness)

/// A small live-data freshness chip: a green "Live" dot while the snapshot is fresh, an amber
/// "Stale" dot once it ages past the 2-minute window (ADR-013).
struct EnergyFlowLiveIndicator: View {
    let isStale: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(isStale ? Color.TS.statusWarning : Color.TS.statusSuccess)
                .frame(width: 8, height: 8)
            Text(isStale ? "energyFlow.live.stale" : "energyFlow.live.label")
                .font(Font.TS.caption)
                .foregroundStyle(isStale ? Color.TS.statusWarning : Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}
