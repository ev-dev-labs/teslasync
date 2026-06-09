//
//  ChargingOptimizerWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) headline layout
//  (optimal-start clock + SOC line + savings chip) and the standard / wide layout
//  (the three key-metric tiles + the schedule-match chip + the wide-mode 24-hour
//  rate timeline + the recommendation tip cards), plus the metric tile, badge,
//  timeline, tip-card, and inline-empty sub-views. Split from
//  ChargingOptimizerWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard/wide layouts)

extension ChargingOptimizerWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1 col): clock + optimal-start headline + SOC line + savings chip ──
    private var compactContent: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                Text(verbatim: projection.optimalStartText)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Text(verbatim: projection.targetSocShortText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            if let savings = projection.savingsShortText {
                ChargingOptimizerBadge(
                    text: savings,
                    tone: .success,
                    showsDot: false
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ChargingOptimizerAccessibility.summary(for: projection)))
    }

    /// ── Standard (2×2) / Wide (cols ≥ 4): metrics + schedule chip + timeline + tips ──
    private var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live { connectivityBanner }
                metricsRow
                scheduleMatchRow
                if isWide { rateTimeline }
                tipsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ChargingOptimizerAccessibility.summary(for: projection)))
    }

    /// The three web key-metric tiles: optimal start, target SOC, savings/mo.
    private var metricsRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ChargingOptimizerMetricTile(
                systemImage: "clock",
                iconColor: Color.TS.statusSuccess,
                value: projection.optimalStartText,
                label: ChargingOptimizerStrings.string("widget.chargingOptimizer.optimalStart", "Optimal start")
            )
            ChargingOptimizerMetricTile(
                systemImage: "battery.100.bolt",
                iconColor: Color.TS.statusInfo,
                value: projection.targetSocText,
                label: ChargingOptimizerStrings.string("widget.chargingOptimizer.targetSoc", "Target SOC")
            )
            ChargingOptimizerMetricTile(
                systemImage: "dollarsign.circle",
                iconColor: Color.TS.statusWarning,
                value: projection.savingsText,
                label: ChargingOptimizerStrings.string("widget.chargingOptimizer.savingsLabel", "Savings/mo")
            )
        }
    }

    /// The web schedule-match row: peak-usage caption + Optimized / Can improve chip.
    private var scheduleMatchRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: projection.peakUsageText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: TSSpacing.sm)
            ChargingOptimizerBadge(
                text: projection.scheduleBadgeText,
                tone: projection.scheduleBadgeTone,
                showsDot: false
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.peakUsageText), \(projection.scheduleBadgeText)"))
    }

    /// The wide-mode 24-hour rate timeline (web `isWide && …`): the labelled bar of
    /// 24 peak / off-peak / standard cells with the optimal-start bolt marker.
    private var rateTimeline: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ChargingOptimizerStrings.text("widget.chargingOptimizer.rateTimeline", "24h Rate Timeline")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            ChargingOptimizerTimelineBar(slots: projection.timeline)
            HStack(spacing: 0) {
                ForEach(Array(projection.timelineAxisLabels.enumerated()), id: \.offset) { index, label in
                    Text(verbatim: label)
                        .font(.system(size: 10))
                        .foregroundStyle(Color.TS.textMuted)
                    if index < projection.timelineAxisLabels.count - 1 {
                        Spacer(minLength: 0)
                    }
                }
            }
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
    }

    /// The recommendation tip cards (web `WidgetTipCards`): up to five cards in the
    /// wide layout / three otherwise, or a friendly empty state.
    @ViewBuilder
    private var tipsSection: some View {
        let limit = isWide ? 5 : 3
        if projection.tips.isEmpty {
            ChargingOptimizerInlineEmpty(
                message: ChargingOptimizerStrings.string(
                    "widget.chargingOptimizer.noRecommendations",
                    "No recommendations"
                ),
                systemImage: "sparkles"
            )
        } else {
            VStack(spacing: TSSpacing.sm) {
                ForEach(projection.tips.prefix(limit)) { tip in
                    ChargingOptimizerTipCard(tip: tip)
                }
            }
        }
    }
}

// MARK: - Metric tile (web key-metric card)

/// One centered icon · value · label tile — the native counterpart of the web
/// key-metric card (`flex flex-col items-center` with the tinted lucide icon).
private struct ChargingOptimizerMetricTile: View {
    let systemImage: String
    let iconColor: Color
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(iconColor)
                .accessibilityHidden(true)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: label)
                .font(.system(size: 10))
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label), \(value)"))
    }
}

// MARK: - Rate-timeline bar (web 24-cell flex bar)

/// The 24-hour rate bar — 24 equal-width cells tinted by their rate kind, with a
/// bolt marker on the optimal-start cell (web `Zap`). Each cell carries an
/// accessibility label so VoiceOver can read the per-hour rate.
private struct ChargingOptimizerTimelineBar: View {
    let slots: [ChargingOptimizerHourSlot]

    var body: some View {
        HStack(spacing: 1) {
            ForEach(slots) { slot in
                ZStack {
                    cellColor(for: slot.kind)
                    if slot.isOptimalStart {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.TS.statusSuccess)
                            .accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: "\(slot.hourText), \(slot.kindLabel)"))
            }
        }
        .frame(height: 24)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private func cellColor(for kind: ChargingOptimizerSlotKind) -> Color {
        switch kind {
        case .peak:
            Color.TS.statusDanger.opacity(0.30)
        case .offpeak:
            Color.TS.statusSuccess.opacity(0.30)
        case .standard:
            Color.TS.textMuted.opacity(0.12)
        }
    }
}

// MARK: - Tip card (web `WidgetTipCards` card)

/// One recommendation card — the native counterpart of the web tip card: a
/// leading sparkles glyph, the title with an optional impact chip, and the detail
/// body.
private struct ChargingOptimizerTipCard: View {
    let tip: ChargingOptimizerTip

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Text(verbatim: tip.title)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let impact = tip.impact, let label = tip.impactLabel {
                        ChargingOptimizerBadge(text: label, tone: impact, showsDot: false)
                    }
                }
                Text(verbatim: tip.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: tipAccessibilityLabel))
    }

    /// "{title}, {detail}[, {impactLabel}]" — the per-card VoiceOver phrase.
    private var tipAccessibilityLabel: String {
        if let label = tip.impactLabel, tip.impact != nil {
            return "\(tip.title), \(tip.detail), \(label)"
        }
        return "\(tip.title), \(tip.detail)"
    }
}

// MARK: - Badge (web `<Badge variant size="sm">`)

/// A capsule chip styled with the shared status tokens, carrying a pre-resolved
/// tone + label. Mirrors the web `<Badge variant size="sm">` used by the schedule
/// match, the savings chip, and the tip impact.
private struct ChargingOptimizerBadge: View {
    let text: String
    let tone: ChargingOptimizerTone
    let showsDot: Bool

    private var color: Color {
        tone.tsTone.color
    }

    var body: some View {
        HStack(spacing: 4) {
            if showsDot {
                Circle().fill(color).frame(width: 6, height: 6)
            }
            Text(verbatim: text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Inline empty state (web `EmptyState` inside the body)

/// A small centered empty state for the in-body sections (no recommendations) —
/// the web `EmptyState` with an icon + message.
private struct ChargingOptimizerInlineEmpty: View {
    let message: String
    var systemImage: String = "sparkles"

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Tone mapping (web `impactBadgeMap` / schedule variant)

private extension ChargingOptimizerTone {
    /// Maps the SwiftUI-free projection tone to the shared design-system `TSTone`.
    var tsTone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .neutral: .neutral
        }
    }
}
