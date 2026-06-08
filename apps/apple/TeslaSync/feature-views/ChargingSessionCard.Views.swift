//
//  ChargingSessionCard.Views.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The token mapping (semantic tone / glow → generated P1/S9 tokens), the wrapping
//  flow layout (native parity of the web `flex flex-wrap` rows), and the slot-based
//  history row (web `HistoryListRow`) composing the checkbox / leading score badge
//  / primary line / route / metrics into one navigable, accessible element. The
//  atomic pieces live in `.Elements`, the non-loaded chrome in `.States`.
//

import SwiftUI

// MARK: - Token mapping (semantic tone / glow → generated design tokens)

extension ChargingSessionCardTone {
    /// The generated design token for this tone — theme-aware (light / dark /
    /// high-contrast) so the badge never hardcodes a hex.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .critical: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        case .accent: Color.TS.accent
        case .purple: Color.TS.chartSeriesPower
        }
    }
}

extension ChargingSessionCardGlow {
    /// The hover-glow token (web `glow` colour).
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        }
    }
}

// MARK: - Flow layout (wrapping rows for the primary + metrics lines)

/// A minimal left-aligned wrapping layout (native parity of the web `flex
/// flex-wrap` rows). Lays subviews left-to-right, wrapping to a new line when the
/// next subview would overflow the proposed width.
struct ChargingFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.sm
    var verticalSpacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        layout(maxWidth: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let frames = layout(maxWidth: bounds.width, subviews: subviews).frames
        for index in subviews.indices {
            let frame = frames[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func layout(maxWidth: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var origin = CGPoint.zero
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x > 0, origin.x + size.width > maxWidth {
                origin.x = 0
                origin.y += rowHeight + verticalSpacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: origin, size: size))
            origin.x += size.width + horizontalSpacing
            rowHeight = Swift.max(rowHeight, size.height)
            contentWidth = Swift.max(contentWidth, origin.x - horizontalSpacing)
        }
        return (CGSize(width: contentWidth, height: origin.y + rowHeight), frames)
    }
}

// MARK: - The history row (web `HistoryListRow` composition)

/// The loaded charging-session row: checkbox + leading score badge + primary /
/// route / metrics lines + chevron, wrapped as one navigable, accessible element.
struct ChargingSessionRowView: View {
    let projection: ChargingSessionCardProjection
    let anomaly: ChargingAnomalyInfo?
    let density: ChargingSessionCardDensity
    let selected: Bool
    let selectable: Bool
    let formatting: any ChargingSessionCardFormatting
    let localize: (String, String) -> String
    let onToggleSelect: (Bool) -> Void
    let onOpen: () -> Void

    private var batteryDelta: ChargingBatteryDeltaDisplay {
        ChargingBatteryDeltaDisplay.make(startPct: projection.startSocPct, endPct: projection.endSocPct)
    }

    private var scoreAccessibilityText: String? {
        guard projection.scoreGrade != nil, let score = projection.score else { return nil }
        return ChargingSessionCardAccessibility.scoreAria(valueText: formatting.formatInt(score), localize: localize)
    }

    private var batterySummary: String {
        if batteryDelta.hasData, let from = batteryDelta.fromPercent, let toValue = batteryDelta.toPercent {
            return ChargingSessionCardAccessibility.batteryDelta(
                fromText: String(from),
                toText: String(toValue),
                localize: localize
            )
        }
        return ChargingSessionCardAccessibility.batteryDeltaUnknown(localize: localize)
    }

    private var rowSummary: String {
        ChargingSessionCardAccessibility.rowSummary(parts: [
            formatting.formatTimestamp(projection.startedAt),
            ChargingSessionCardLabels.chargerLabel(projection.category, localize: localize),
            formatting.formatDurationMinutes(projection.durationMinutes),
            projection.showsEnergyBadge
                ? ChargingSessionCardLabels.energy(
                    valueText: formatting.formatNumber(projection.energyKwh),
                    localize: localize
                )
                : nil,
            batterySummary,
            scoreAccessibilityText
        ])
    }

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            if selectable {
                ChargingSessionCheckbox(
                    selected: selected,
                    label: ChargingSessionCardAccessibility.selectSession(localize: localize),
                    onToggle: onToggleSelect
                )
            }
            Button(action: onOpen) { rowBody }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: rowSummary))
                .accessibilityHint(Text(verbatim: localize("card.openHint", "Opens charging session details")))
                .accessibilityAddTraits(.isButton)
        }
    }

    private var rowBody: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            if let grade = projection.scoreGrade {
                ChargingSessionScoreBadge(grade: grade, accessibilityText: scoreAccessibilityText ?? grade.label)
                    .frame(width: 36)
            }
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                primaryLine
                ChargingSessionRoute(
                    place: projection.startPlace,
                    latitude: projection.startLat,
                    longitude: projection.startLng,
                    localize: localize
                )
                if density == .comfortable {
                    metricsLine
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .padding(TSSpacing.md)
        .tsGlassPanel()
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(selected ? Color.TS.accent.opacity(0.45) : Color.clear, lineWidth: 1)
        )
        .shadow(color: projection.glow.color.opacity(selected ? 0.22 : 0.12), radius: selected ? 10 : 6)
    }

    private var primaryLine: some View {
        ChargingFlowLayout {
            Text(verbatim: formatting.formatTimestamp(projection.startedAt))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "·")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: formatting.formatDurationMinutes(projection.durationMinutes))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
            ChargingSessionBadge(
                text: ChargingSessionCardLabels.chargerLabel(projection.category, localize: localize),
                tone: projection.category.badgeTone
            )
            if projection.showsEnergyBadge {
                ChargingSessionBadge(
                    text: ChargingSessionCardLabels.energy(
                        valueText: formatting.formatNumber(projection.energyKwh),
                        localize: localize
                    ),
                    tone: .info
                )
            }
            if projection.showsFreeBadge {
                ChargingSessionBadge(
                    text: ChargingSessionCardLabels.free(localize: localize),
                    tone: .success,
                    systemImage: "sun.max.fill"
                )
            }
            if let anomaly {
                ChargingSessionBadge(text: anomaly.message, tone: .danger, systemImage: "exclamationmark.triangle.fill")
            }
        }
    }

    private var metricsLine: some View {
        ChargingFlowLayout(horizontalSpacing: TSSpacing.md) {
            ChargingSessionBatteryDelta(display: batteryDelta, accessibilityText: batterySummary)
            if let peak = projection.peakPowerKw {
                ChargingSessionInlineMetric(
                    systemImage: "chart.line.uptrend.xyaxis",
                    value: ChargingSessionCardLabels.peak(valueText: formatting.formatNumber(peak), localize: localize)
                )
            }
            if let avg = projection.avgRateKw {
                ChargingSessionInlineMetric(
                    systemImage: "powerplug.fill",
                    value: ChargingSessionCardLabels.average(
                        valueText: formatting.formatNumber(avg),
                        localize: localize
                    )
                )
            }
            if projection.durationMinutes > 0 {
                ChargingSessionInlineMetric(
                    systemImage: "clock",
                    value: formatting.formatDurationMinutes(projection.durationMinutes)
                )
            }
            if let cost = projection.costDecimal, cost > 0 {
                ChargingSessionInlineMetric(
                    systemImage: "dollarsign",
                    value: formatting.formatCurrency(cost),
                    tone: .success
                )
            }
            if let cpk = projection.costPerKwh {
                Text(verbatim: ChargingSessionCardLabels.costPerKwh(
                    valueText: formatting.formatCurrency(cpk, decimals: 2),
                    localize: localize
                ))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
            }
            if projection.showsDistanceGained, let distance = projection.distanceGainedDisplay {
                ChargingSessionInlineMetric(
                    systemImage: "bolt.fill",
                    value: ChargingSessionCardLabels.distanceGained(
                        valueText: formatting.formatInt(distance),
                        unit: formatting.distanceUnit,
                        localize: localize
                    ),
                    tone: .purple
                )
            }
        }
    }
}
