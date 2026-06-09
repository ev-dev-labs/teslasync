//
//  TemperatureGauges.Views.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  The content chrome composed by `TemperatureGauges`: the single glass panel (web
//  `GlassPanel p-6`), its thermometer header, and the responsive gauge grid (web `Grid cols 2 /
//  md 4`) of radial temperature gauges (web `RadialGauge`) with their "Max: …" ceiling lines. The
//  freshness chip, connectivity banner, and loading / empty / error states live in
//  TemperatureGauges.States.swift. All consume pre-localized strings from the P1/S10 facade and
//  the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Severity → token tint (web tempSeverityColor hex map)

extension TempSeverity {
    /// The shared tone for the gauge arc + readout (web hex map: normal `#10b981` → success,
    /// warning `#f59e0b` → warning, critical `#ef4444` → danger, missing reading `#6b7280` →
    /// neutral).
    var tone: TSTone {
        switch self {
        case .normal: .success
        case .warning: .warning
        case .critical: .danger
        case .unknown: .neutral
        }
    }

    var color: Color {
        tone.color
    }
}

// MARK: - Layout

enum TemperatureGaugesLayout {
    /// The responsive gauge track (web `grid-cols-2 md:grid-cols-4`): two gauges per row on a
    /// narrow phone panel, flowing to four on a wider iPad / Mac surface via an adaptive column
    /// track sized to one gauge cell.
    static let columns = [
        GridItem(.adaptive(minimum: 132, maximum: .infinity), spacing: TSSpacing.md, alignment: .top)
    ]
}

// MARK: - Panel scaffolding (web single `GlassPanel p-6`)

/// The glass panel that wraps the whole surface (web `GlassPanel className="p-6"`), holding the
/// header and the gauge grid / state content in a single column.
struct TemperatureGaugesPanel<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

// MARK: - Header (web `<h3>` with Thermometer icon)

/// The uppercase muted panel header (web `text-sm font-medium uppercase tracking-wider
/// text-muted` with an inline Thermometer glyph), with the live-state freshness chip on the
/// trailing edge.
struct TemperatureGaugesHeader: View {
    let connection: TemperatureGaugesConnection
    let isFetching: Bool
    let updatedAt: Date?
    let showsChip: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TemperatureGaugesStrings.text("drivetrain.tempGauges", "Temperature Gauges")
                .font(Font.TS.label)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            if showsChip {
                TemperatureGaugesFreshnessChip(
                    connection: connection,
                    isFetching: isFetching,
                    updatedAt: updatedAt
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content (web gauge `Grid`)

/// The populated state: one radial gauge cell per sensor, in the web render order, in a
/// responsive grid.
struct TemperatureGaugesContent: View {
    let projection: TemperatureGaugesProjection

    var body: some View {
        LazyVGrid(columns: TemperatureGaugesLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(projection.gauges) { gauge in
                TemperatureGaugesCell(gauge: gauge)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: TemperatureGaugesAccessibility.summary(for: projection)))
    }
}

// MARK: - Gauge cell (web `flex flex-col items-center`: RadialGauge + "Max:" line)

/// One sensor's cell: the centered radial gauge over its "Max: …" ceiling line (web
/// `<div className="flex flex-col items-center"> <RadialGauge/> <p>Max: …</p> </div>`).
struct TemperatureGaugesCell: View {
    let gauge: TempGaugeProjection

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TemperatureGaugesRadialGaugeView(gauge: gauge)
            Text(verbatim: maxLine)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: TemperatureGaugesAccessibility.gaugeSummary(for: gauge, maxLabel: maxLabel))
        )
    }

    /// The localized "Max" label (web `t('drivetrain.maxLabel', 'Max')`).
    private var maxLabel: String {
        TemperatureGaugesStrings.string("drivetrain.maxLabel", "Max")
    }

    /// The ceiling line (web `Max: {fmtNumber(max,0)}{unit}`).
    private var maxLine: String {
        "\(maxLabel): \(gauge.maxText)\(gauge.unit)"
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// One radial gauge: a neutral track ring, a severity-tinted progress arc filling the clamped
/// display value over the display ceiling, a centre value + unit suffix, and the sensor label
/// below — the native parity of the web `RadialGauge`. The arc fills in on appear and honours
/// Reduce Motion.
struct TemperatureGaugesRadialGaugeView: View {
    let gauge: TempGaugeProjection

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill: Double = 0

    private let diameter: CGFloat = 108
    private let lineWidth: CGFloat = 8

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: fill)
                    .stroke(
                        gauge.severity.color,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                centreReadout
            }
            .frame(width: diameter, height: diameter)
            Text(verbatim: gauge.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .onAppear { animate(to: gauge.fraction) }
        .onChange(of: gauge.fraction) { _, newValue in animate(to: newValue) }
        .accessibilityHidden(true)
    }

    private var centreReadout: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: gauge.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, lineWidth)
    }

    private func animate(to fraction: Double) {
        let target = min(max(fraction, 0), 1)
        withAnimation(reduceMotion ? nil : .easeOut(duration: TSMotion.slowDuration)) {
            fill = target
        }
    }
}
