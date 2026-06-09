//
//  RangeBarWidget.Bar.swift
//  TeslaSync — P4 dashboard widget · 0076 · RangeBarWidget (Apple)
//
//  The single horizontal proportion bar used by the standard layout — the SwiftUI parity of
//  the web `MetricBar` (features/components/data-display). Split out of RangeBarWidget.swift so
//  the surface view stays focused and within the file-length budget.
//

import Foundation
import SwiftUI

// MARK: - Bar palette (web MetricBar hex → SwiftUI)

extension RangeBarTone {
    /// The web data-viz hex the source passes to `MetricBar` (rated `#22d3ee`, ideal `#a78bfa`),
    /// reproduced verbatim as sRGB so the native bars match the web pixel-for-pixel.
    var color: Color {
        switch self {
        case .rated: Color(.sRGB, red: 0.133, green: 0.827, blue: 0.933, opacity: 1)
        case .ideal: Color(.sRGB, red: 0.655, green: 0.545, blue: 0.980, opacity: 1)
        }
    }
}

// MARK: - Range bar (web `MetricBar`)

/// One horizontal proportion bar: a label + a colored, monospaced readout over a rounded track
/// with a gradient fill. The SwiftUI parity of the web `MetricBar` (label row + `h-2` rounded
/// track + `linear-gradient(color99 → color)` fill with a soft glow). The fill animates from
/// empty on appear, honoring Reduce Motion.
struct RangeBarMeter: View {
    let metric: RangeBarMetric
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animatedFraction: Double = 0

    private var color: Color {
        metric.tone.color
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: metric.label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Text(verbatim: metric.sublabel)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .lineLimit(1)
            }
            track
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(metric.label) \(metric.sublabel)"))
        .accessibilityValue(Text(verbatim: RangeBarMeterPercent.value(metric.fraction)))
    }

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.3))
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(0.6), color],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(0, geo.size.width * animatedFraction))
                    .shadow(color: color.opacity(0.25), radius: 4)
            }
        }
        .frame(height: 8)
        .onAppear { applyFraction() }
        .onChange(of: metric.fraction) { _, _ in applyFraction() }
    }

    private func applyFraction() {
        if reduceMotion {
            animatedFraction = metric.fraction
        } else {
            withAnimation(.easeOut(duration: TSMotion.slowDuration)) {
                animatedFraction = metric.fraction
            }
        }
    }
}
