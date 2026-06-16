import SwiftUI

/// Native SwiftUI parity of the web `RadialGauge` (`web/src/components/charts/RadialGauge.tsx`)
/// for the Energy hero: a circular progress ring filled to `value / max` with the formatted
/// value + unit at its centre and the label beneath. Unlike the shared `TSRadialGauge` (which
/// renders a 0–1 percentage), the energy hero shows absolute SI-derived quantities (energy,
/// efficiency, mass, currency) with their unit, so this feature-local view reproduces the web
/// component's value+unit centre while reusing the same ring styling + brand palette. Honors
/// Dynamic Type, Dark Mode, increased contrast (token colours), and VoiceOver.
struct EnergyGauge: View {
    let value: Double
    let max: Double
    let unit: String
    let label: LocalizedStringKey
    let colorIndex: Int

    /// Web stroke width (`STROKE_WIDTH = 8`).
    private let strokeWidth: CGFloat = 8

    /// Web `clamped = max(0, min(value, max))`.
    private var clamped: Double {
        Swift.max(0, Swift.min(value, max))
    }

    /// Web fill `clamped / max`.
    private var fraction: Double {
        max > 0 ? clamped / max : 0
    }

    /// Web `d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())`.
    private var valueText: String {
        let decimals = clamped == clamped.rounded() ? 0 : 2
        return EnergyFormat.number(clamped, decimals: decimals)
    }

    private var color: Color {
        TSChartPalette.color(at: colorIndex)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.3), lineWidth: strokeWidth)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(color, style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                center
            }
            .frame(width: 96, height: 96)
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: "\(valueText) \(unit)"))
    }

    /// Web centre: the value in a bold role with the unit in a smaller muted role.
    private var center: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: valueText)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, TSSpacing.xs)
    }
}

#if DEBUG
    #Preview("Energy gauges") {
        HStack(spacing: TSSpacing.lg) {
            EnergyGauge(value: 298, max: 387, unit: "kWh", label: "Energy Used", colorIndex: 4)
            EnergyGauge(value: 178, max: 300, unit: "Wh/km", label: "Efficiency", colorIndex: 2)
            EnergyGauge(value: 125.3, max: 188, unit: "kg", label: "CO₂ Saved", colorIndex: 6)
            EnergyGauge(value: 76.34, max: 114, unit: "$", label: "Total Cost", colorIndex: 1)
        }
        .padding()
        .teslaSyncTheme()
    }
#endif
