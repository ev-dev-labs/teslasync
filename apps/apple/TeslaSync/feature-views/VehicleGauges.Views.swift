//
//  VehicleGauges.Views.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The presentational subviews composed by `VehicleGauges`: the frosted panel surface (web
//  `GlassPanel`), the responsive data layout (web `grid lg:grid-cols-[auto,1fr]`), the radial
//  gauge (web `RadialGauge`), the metric bar (web `MetricBar`), the status chip, and the flow
//  layout that wraps the chip row (web `flex flex-wrap`). All consume the P1/S10 facade and the
//  shared P1/S9 tokens + components — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web hex constants map to the brand
//  tokens — CYAN → `accent`, PURPLE → `chartSeriesPower`, green `#10b981` → `statusSuccess`,
//  amber → `statusWarning`, red → `statusDanger`, the muted-grey inactive → `textMuted`, so the
//  surface adapts to both light and dark themes.
//

import SwiftUI

// MARK: - Tint → token bridge (web hex constants → design token)

extension VehicleGaugesTint {
    /// The design token the web hex constant maps to (semantic, not literal).
    var color: Color {
        switch self {
        case .accent: Color.TS.accent
        case .power: Color.TS.chartSeriesPower
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .inactive: Color.TS.textMuted
        }
    }
}

// MARK: - Panel surface (web `GlassPanel` + gradient overlay)

extension View {
    /// The cluster's frosted panel container — the shared padding + material applied by every
    /// state so the surface keeps a consistent shape (web `GlassPanel`), with the faint web
    /// cyan→purple gradient wash overlaid (web `bg-gradient-to-br from-neon-cyan/[0.02]`).
    func vehicleGaugesSurface() -> some View {
        padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
            .overlay {
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color.TS.accent.opacity(0.05), .clear, Color.TS.chartSeriesPower.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .allowsHitTesting(false)
            }
    }
}

// MARK: - Data layout (web responsive grid)

/// The resolved cluster — the car viz beside the gauges + bars + chips on a wide canvas, stacked
/// on a narrow one (web `grid-cols-1 lg:grid-cols-[auto,1fr]`). Wrapped in the shared fade-in
/// (web `FadeIn delay={0.05}`).
struct VehicleGaugesContentView: View {
    let content: VehicleGaugesContent

    var body: some View {
        TSFadeIn(delay: 0.05) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: TSSpacing.x3xl) {
                    VehicleGaugesCarViz(model: content.carViz)
                    gaugesAndMetrics
                }
                VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                    VehicleGaugesCarViz(model: content.carViz)
                        .frame(maxWidth: .infinity)
                    gaugesAndMetrics
                }
            }
        }
    }

    private var gaugesAndMetrics: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: VehicleGaugesLayout.gaugeColumns, spacing: TSSpacing.lg) {
                ForEach(content.gauges) { gauge in
                    VehicleGaugeRing(gauge: gauge)
                }
            }
            VStack(spacing: TSSpacing.md) {
                ForEach(content.bars) { bar in
                    VehicleGaugesMetricBarRow(bar: bar)
                }
            }
            VehicleGaugesFlowLayout(spacing: TSSpacing.sm) {
                ForEach(content.chips) { chip in
                    VehicleGaugesChipView(chip: chip)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Shared layout constants for the cluster (web responsive gauge column track).
enum VehicleGaugesLayout {
    /// Web `grid-cols-2 sm:grid-cols-4` — two gauges per row on a phone, up to four when wide.
    static let gaugeColumns = [
        GridItem(.adaptive(minimum: 96, maximum: .infinity), spacing: TSSpacing.lg, alignment: .top)
    ]
}

// MARK: - Radial gauge (web `RadialGauge`)

/// One radial gauge — a track ring + a tinted progress arc with the centre value/unit and the
/// label beneath (web `RadialGauge`). The arc fills in on appear (honouring Reduce Motion).
struct VehicleGaugeRing: View {
    let gauge: VehicleGaugesGauge
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill = 0.0

    private var label: String {
        VehicleGaugesStrings.string(gauge.labelKey, gauge.labelFallback)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle().stroke(Color.TS.border.opacity(0.3), lineWidth: 8)
                Circle()
                    .trim(from: 0, to: fill)
                    .stroke(gauge.tint.color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                centre
            }
            .frame(width: 96, height: 96)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .onAppear { animateFill(to: gauge.fraction) }
        .onChange(of: gauge.fraction) { _, value in animateFill(to: value) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleGaugesAccessibility.gaugeLabel(
            label: label,
            value: gauge.valueText,
            unit: gauge.unit
        )))
    }

    private var centre: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: gauge.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, TSSpacing.xs)
    }

    private func animateFill(to value: Double) {
        if reduceMotion {
            fill = value
        } else {
            withAnimation(.easeOut(duration: TSMotion.slowDuration)) { fill = value }
        }
    }
}

// MARK: - Metric bar (web `MetricBar`)

/// One metric bar — a label + tinted readout above a tinted proportion track (web `MetricBar`).
/// The fill animates in on appear (honouring Reduce Motion).
struct VehicleGaugesMetricBarRow: View {
    let bar: VehicleGaugesBar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill = 0.0

    private var label: String {
        VehicleGaugesStrings.string(bar.labelKey, bar.labelFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: bar.sublabel)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(bar.tint.color)
            }
            track
        }
        .onAppear { animateFill(to: bar.fraction) }
        .onChange(of: bar.fraction) { _, value in animateFill(to: value) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VehicleGaugesAccessibility.barLabel(
            label: label,
            sublabel: bar.sublabel
        )))
    }

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.3))
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [bar.tint.color.opacity(0.6), bar.tint.color],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geo.size.width * fill)
            }
        }
        .frame(height: 8)
    }

    private func animateFill(to value: Double) {
        if reduceMotion {
            fill = value
        } else {
            withAnimation(.easeOut(duration: TSMotion.slowDuration)) { fill = value }
        }
    }
}

// MARK: - Status chip (web quick-info chip)

/// One status chip — a tinted icon + label in a bordered capsule (web quick-info chip).
struct VehicleGaugesChipView: View {
    let chip: VehicleGaugesChip

    private var label: String {
        if let verbatim = chip.verbatim { return verbatim }
        guard let key = chip.labelKey, let fallback = chip.labelFallback else { return "" }
        return VehicleGaugesStrings.string(key, fallback)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: chip.iconSystemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(chip.tint.color)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Flow layout (web `flex flex-wrap`)

/// A line-wrapping layout for the chip row — the native parity of the web `flex flex-wrap`,
/// placing chips left-to-right and wrapping to the next line when the proposed width is reached.
struct VehicleGaugesFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth = 0.0, rowHeight = 0.0, totalHeight = 0.0, widest = 0.0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth, rowWidth > 0 {
                totalHeight += rowHeight + spacing
                widest = max(widest, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        widest = max(widest, rowWidth - spacing)
        return CGSize(width: min(widest, maxWidth), height: totalHeight + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var origin = CGPoint(x: bounds.minX, y: bounds.minY)
        var rowHeight = 0.0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > bounds.maxX, origin.x > bounds.minX {
                origin.x = bounds.minX
                origin.y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: origin, proposal: ProposedViewSize(size))
            origin.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
