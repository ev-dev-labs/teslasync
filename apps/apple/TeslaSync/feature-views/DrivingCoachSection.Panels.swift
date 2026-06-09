//
//  DrivingCoachSection.Panels.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The metric panels composed by `DrivingCoachSection`: the score radial gauge (web `RadialGauge`), the
//  style-breakdown split bar + legend, the avg / best efficiency stat cards (web `StatCard`), and the
//  driving-pattern threshold bars. Split out of DrivingCoachSection.Views.swift to keep each file within the
//  400-line budget. The shared chrome (panel heading, inner empty, band → token mapping, dynamic enum
//  labels) lives in DrivingCoachSection.Views.swift. Token-driven (P1/S9); copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Score gauge (web `RadialGauge value={overall_score}`)

/// The driving-score radial gauge — the Apple-idiomatic counterpart of the web `RadialGauge`: a track ring
/// + a banded value arc from 12 o'clock, the centred score readout with the "Driving Score" label, and the
/// "{n} drives analyzed" caption beneath the ring (web `<p>{count} drives analyzed</p>`). The arc animates
/// on change unless Reduce Motion is on.
struct DrivingCoachScoreGaugePanel: View {
    let gauge: DrivingCoachGauge
    let drivesAnalyzed: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let diameter: CGFloat = 150
    private var lineWidth: CGFloat {
        max(8, diameter * 0.08)
    }

    private var drivesAnalyzedText: String {
        String(
            format: DrivingCoachSectionStrings.string("dynamics.coach.drivesAnalyzed", "%lld drives analyzed"),
            drivesAnalyzed
        )
    }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                ZStack {
                    Circle()
                        .stroke(Color.TS.border.opacity(0.6), style: StrokeStyle(lineWidth: lineWidth))
                    Circle()
                        .trim(from: 0, to: gauge.fraction)
                        .stroke(gauge.band.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(
                            reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                            value: gauge.fraction
                        )
                    centerReadout
                }
                .frame(width: diameter, height: diameter)

                Text(verbatim: drivesAnalyzedText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: gaugeAccessibility))
        }
    }

    private var centerReadout: some View {
        VStack(spacing: 2) {
            Text(verbatim: gauge.scoreText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            DrivingCoachSectionStrings.text("dynamics.coach.overallScore", "Driving Score")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .padding(.horizontal, lineWidth)
    }

    private var gaugeAccessibility: String {
        let label = DrivingCoachAccessibility.gaugeLabel(
            for: gauge,
            localize: DrivingCoachSectionStrings.string
        )
        return "\(label). \(drivesAnalyzedText)"
    }
}

// MARK: - Style breakdown (web split bar + legend)

/// The "Style Breakdown" panel: the proportional split bar (a coloured segment per style with a positive
/// share) over the always-present legend rows, or the friendly inner empty state when no drives have been
/// analysed (web `total_drives_analyzed > 0 ? … : EmptyState`).
struct DrivingCoachStyleBreakdownPanel: View {
    let model: DrivingCoachStyleBreakdownVM

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingCoachPanelHeading(key: "dynamics.coach.styleBreakdown", fallback: "Style Breakdown")
                if model.hasData {
                    splitBar
                    legend
                } else {
                    DrivingCoachInnerEmpty(
                        key: "dynamics.coach.noData",
                        fallback: "Drive more to see your style breakdown."
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var splitBar: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                ForEach(model.segments) { segment in
                    segment.style.band.color
                        .frame(width: max(0, proxy.size.width * segment.fraction))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 16)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }

    private var legend: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(model.legend) { row in
                HStack(spacing: TSSpacing.sm) {
                    Circle().fill(row.style.band.color).frame(width: 8, height: 8)
                    Text(verbatim: DrivingCoachLabels.style(row.style))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: "\(row.count)")
                        .font(Font.TS.caption)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(row.style.band.color)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Efficiency cards (web `StatCard` pair)

/// The avg / best efficiency readouts — the native parity of the web `StatCard` pair inside their
/// `GlassPanel` (the Zap + ShieldCheck icons).
struct DrivingCoachEfficiencyPanel: View {
    let avgEfficiencyText: String
    let bestEfficiencyText: String

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                TSStatCard(
                    title: LocalizedStringKey(
                        DrivingCoachSectionStrings.string("dynamics.coach.avgEfficiency", "Avg Efficiency")
                    ),
                    value: avgEfficiencyText,
                    systemImage: "bolt.fill"
                )
                TSStatCard(
                    title: LocalizedStringKey(
                        DrivingCoachSectionStrings.string("dynamics.coach.bestEfficiency", "Best Efficiency")
                    ),
                    value: bestEfficiencyText,
                    systemImage: "checkmark.shield.fill"
                )
            }
        }
    }
}

// MARK: - Driving patterns (web threshold bars)

/// The "Driving Patterns" panel: the five threshold bars (web `patterns.map`), each a labelled, banded fill
/// whose width is the clamped value.
struct DrivingCoachPatternsPanel: View {
    let rows: [DrivingCoachPatternRow]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingCoachPanelHeading(key: "dynamics.coach.patterns", fallback: "Driving Patterns")
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(rows) { row in
                        DrivingCoachPatternBar(row: row)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One driving-pattern bar: the label + banded percentage readout above a track whose fill is the clamped
/// value (web `min(100, value)`).
struct DrivingCoachPatternBar: View {
    let row: DrivingCoachPatternRow

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                DrivingCoachSectionStrings.text(row.labelKey, row.labelFallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: row.valueText)
                    .font(Font.TS.caption)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(row.band.color)
            }
            track
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingCoachSectionStrings.text(row.labelKey, row.labelFallback))
        .accessibilityValue(Text(verbatim: row.valueText))
    }

    private var track: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.5))
                Capsule()
                    .fill(row.band.color)
                    .frame(width: max(0, proxy.size.width * row.fraction))
            }
        }
        .frame(height: 6)
    }
}
