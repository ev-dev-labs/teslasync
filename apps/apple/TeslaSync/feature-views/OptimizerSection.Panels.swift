//
//  OptimizerSection.Panels.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The four data panels composed by `OptimizerSection`, split out of the shell
//  views: Charging Habits, the Battery-Friendly Score gauge (web `RadialGauge`), Cost
//  Analysis, and Optimization Recommendations (with its empty state). Each panel
//  renders its content or a self-contained empty state — never hidden — using the
//  P1/S10 facade strings + shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Charging Habits panel (web "Charging Habits")

/// The current-habits panel (web "Charging Habits"): five label/value rows.
struct OptimizerHabitsPanel: View {
    let schedule: OptimizerSchedule
    let localize: (String, String) -> String
    let formatting: any OptimizerFormatting

    private var labels: HabitLabels {
        HabitLabels(
            sessionsWeek: localize("charging.optimizer.sessionsWeek", "Sessions/week"),
            homePct: localize("charging.optimizer.homePct", "Home charging"),
            avgTarget: localize("charging.optimizer.avgTarget", "Avg charge target"),
            commonHour: localize("charging.optimizer.commonHour", "Common start hour"),
            commonDay: localize("charging.optimizer.commonDay", "Most common")
        )
    }

    private var summary: String {
        OptimizerAccessibility.habitsSummary(
            schedule: schedule,
            labels: labels,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
    }

    var body: some View {
        OptimizerGlassPanel(
            systemImage: "calendar",
            tint: Color.TS.accent,
            title: localize("charging.optimizer.habits", "Charging Habits")
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                OptimizerStatRow(
                    label: labels.sessionsWeek,
                    value: formatting.formatNumber(OptimizerNumeric.safe(schedule.avgSessionsPerWeek), decimals: 1)
                )
                OptimizerStatRow(
                    label: labels.homePct,
                    value: formatting.formatPercent(OptimizerNumeric.safe(schedule.homeChargingPct))
                )
                OptimizerStatRow(
                    label: labels.avgTarget,
                    value: formatting.formatPercent(OptimizerNumeric.safe(schedule.avgChargeToPct))
                )
                OptimizerStatRow(
                    label: labels.commonHour,
                    value: OptimizerProjection.startHourLabel(schedule.mostCommonStartHour),
                    monospaced: true
                )
                OptimizerStatRow(
                    label: labels.commonDay,
                    value: schedule.mostCommonDay.isEmpty ? "—" : schedule.mostCommonDay
                )
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: summary))
        }
    }
}

// MARK: - Battery-Friendly Score panel (web `RadialGauge`)

/// The circular score gauge (web `RadialGauge` — a trimmed ring with the score
/// centered). The fraction is `score / 100`; the tint is the tier color.
struct BatteryScoreGauge: View {
    let score: Double
    let tint: Color
    let centerText: String
    var size: CGFloat = 150

    private var fraction: Double {
        OptimizerNumeric.clamp(score, upper: 100) / 100
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border.opacity(0.35), lineWidth: 8)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(tint, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(verbatim: centerText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The Battery-Friendly Score panel (web center column): the gauge plus a tier
/// caption. The panel carries the combined VoiceOver label for the gauge.
struct OptimizerScorePanel: View {
    let score: Double
    let tier: BatteryScoreTier
    let localize: (String, String) -> String
    let formatting: any OptimizerFormatting

    private var tint: Color {
        switch tier {
        case .good: Color.TS.statusSuccess
        case .fair: Color.TS.statusWarning
        case .poor: Color.TS.statusDanger
        }
    }

    private var label: String {
        localize("charging.optimizer.batteryScore", "Battery-Friendly Score")
    }

    private var caption: String {
        switch tier {
        case .good: localize("charging.optimizer.scoreGood", "Your habits are battery-friendly")
        case .fair: localize("charging.optimizer.scoreFair", "Room for improvement")
        case .poor: localize("charging.optimizer.scorePoor", "Consider adjusting your habits")
        }
    }

    private var centerText: String {
        formatting.formatNumber(OptimizerNumeric.clamp(score, upper: 100), decimals: 0)
    }

    private var summary: String {
        OptimizerAccessibility.scoreSummary(
            score: score,
            label: label,
            caption: caption,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
    }

    var body: some View {
        OptimizerGlassPanel(
            systemImage: "bolt.heart.fill",
            tint: tint,
            title: label,
            alignment: .center
        ) {
            VStack(spacing: TSSpacing.sm) {
                BatteryScoreGauge(score: score, tint: tint, centerText: centerText)
                Text(verbatim: caption)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: summary))
        }
    }
}

// MARK: - Cost Analysis panel (web "Cost Analysis")

/// The cost-analysis panel (web "Cost Analysis"): peak / off-peak rates, the peak
/// session share (tinted by the web `> 30` threshold), and the peak / off-peak hour
/// windows below a divider.
struct OptimizerCostPanel: View {
    let analysis: OptimizerCostAnalysis
    let localize: (String, String) -> String
    let formatting: any OptimizerFormatting

    private var labels: CostAnalysisLabels {
        CostAnalysisLabels(
            peakRate: localize("charging.optimizer.peakRate", "Peak rate"),
            offpeakRate: localize("charging.optimizer.offpeakRate", "Off-peak rate"),
            peakSessions: localize("charging.optimizer.peakSessions", "Sessions during peak")
        )
    }

    private var peakSessionsTint: Color {
        OptimizerProjection.peakSessionsElevated(analysis.sessionsDuringPeakPct)
            ? Color.TS.statusDanger
            : Color.TS.statusSuccess
    }

    private var summary: String {
        OptimizerAccessibility.costSummary(
            analysis: analysis,
            labels: labels,
            formatCurrency: { formatting.formatCurrency($0, decimals: $1) },
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
    }

    var body: some View {
        OptimizerGlassPanel(
            systemImage: "dollarsign.circle",
            tint: Color.TS.statusSuccess,
            title: localize("charging.optimizer.costAnalysis", "Cost Analysis")
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                rates
                Divider().overlay(Color.TS.border)
                hours
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: summary))
        }
    }

    /// Formats a per-kWh rate string (web `$${fmtNumber(rate, 3)}/kWh`).
    private func rateValue(_ rate: Double) -> String {
        "\(formatting.formatCurrency(OptimizerNumeric.safe(rate), decimals: 3))/kWh"
    }

    private var rates: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            OptimizerStatRow(
                label: labels.peakRate,
                value: rateValue(analysis.peakCostPerKwh),
                valueTint: Color.TS.statusDanger,
                monospaced: true
            )
            OptimizerStatRow(
                label: labels.offpeakRate,
                value: rateValue(analysis.offpeakCostPerKwh),
                valueTint: Color.TS.statusSuccess,
                monospaced: true
            )
            OptimizerStatRow(
                label: labels.peakSessions,
                value: formatting.formatPercent(OptimizerNumeric.safe(analysis.sessionsDuringPeakPct)),
                valueTint: peakSessionsTint,
                monospaced: true
            )
        }
    }

    private var hours: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            OptimizerStatRow(
                label: localize("charging.optimizer.peakHours", "Peak hours"),
                value: OptimizerProjection.hoursLabel(analysis.peakHours),
                valueTint: Color.TS.textSecondary,
                monospaced: true
            )
            OptimizerStatRow(
                label: localize("charging.optimizer.offpeakHours", "Off-peak hours"),
                value: OptimizerProjection.hoursLabel(analysis.offpeakHours),
                valueTint: Color.TS.textSecondary,
                monospaced: true
            )
        }
    }
}

// MARK: - Recommendations panel (web "Optimization Recommendations")

/// The recommendations panel (web "Optimization Recommendations"): a priority-tinted
/// list, or the empty state when there are no recommendations.
struct OptimizerRecommendationsPanel: View {
    let recommendations: [OptimizerRecommendation]
    let localize: (String, String) -> String
    let formatting: any OptimizerFormatting

    var body: some View {
        OptimizerGlassPanel(
            systemImage: "lightbulb.fill",
            tint: Color.TS.statusWarning,
            title: localize("charging.optimizer.recommendations", "Optimization Recommendations")
        ) {
            if recommendations.isEmpty {
                OptimizerEmptyState(
                    message: localize(
                        "charging.optimizer.noRecs",
                        "Recommendations will appear after more charging sessions."
                    )
                )
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(recommendations) { recommendation in
                        OptimizerRecommendationRow(
                            recommendation: recommendation,
                            localize: localize,
                            formatting: formatting
                        )
                    }
                }
            }
        }
    }
}

/// One recommendation card: a priority-tinted container with a shield glyph, the
/// title, a priority chip, an optional savings chip, and the detail line.
struct OptimizerRecommendationRow: View {
    let recommendation: OptimizerRecommendation
    let localize: (String, String) -> String
    let formatting: any OptimizerFormatting

    private var tone: Color {
        switch recommendation.priority {
        case .high: Color.TS.statusDanger
        case .medium: Color.TS.statusWarning
        case .low: Color.TS.statusSuccess
        }
    }

    private var perMonth: String {
        localize("charging.optimizer.perMonth", "/mo")
    }

    private var savingsChip: String? {
        guard OptimizerProjection.recommendationSavingsVisible(recommendation) else { return nil }
        let amount = formatting.formatNumber(OptimizerNumeric.safe(recommendation.estimatedSavings), decimals: 0)
        return "~$\(amount)\(perMonth)"
    }

    private var summary: String {
        OptimizerAccessibility.recommendationSummary(
            recommendation,
            perMonthSuffix: perMonth,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                header
                if !recommendation.detail.isEmpty {
                    Text(verbatim: recommendation.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.20), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            if !recommendation.title.isEmpty {
                Text(verbatim: recommendation.title)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
            }
            OptimizerChip(text: recommendation.priority.rawValue.uppercased(), tone: tone)
            if let savingsChip {
                OptimizerChip(text: savingsChip, tone: Color.TS.statusSuccess)
            }
            Spacer(minLength: 0)
        }
    }
}

/// A small pill chip (web `text-[10px] px-1.5 py-0.5 rounded-full`) used for the
/// priority + savings badges on a recommendation.
struct OptimizerChip: View {
    let text: String
    let tone: Color

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.18), in: Capsule())
            .accessibilityHidden(true)
    }
}
