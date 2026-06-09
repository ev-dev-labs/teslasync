//
//  ChargePlansWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) headline layout
//  (Target SOC + departure chip) and the standard layout (active-plan header +
//  the two stat tiles + the detail card + the rate-plan section), plus the
//  status badge, stat tile, and detail row sub-views. Split from
//  ChargePlansWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension ChargePlansWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1×2): clock + Target SOC headline + departure chip (web compact) ──
    @ViewBuilder
    private var compactContent: some View {
        if let active = projection.active {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: active.targetSocText)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                ChargePlansStrings.text("widget.chargePlans.targetSoc", "Target SOC")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                if let departure = active.compactDepartureText {
                    Text(verbatim: departure)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: ChargePlansAccessibility.summary(for: projection)))
        } else {
            planEmptyState
        }
    }

    /// ── Standard (2×4): active-plan block + rate-plan section (web standard) ──
    private var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live { connectivityBanner }
                if let active = projection.active {
                    activePlanBlock(active)
                } else {
                    planEmptyState
                }
                if projection.hasRates {
                    rateSection
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ChargePlansAccessibility.summary(for: projection)))
    }

    /// The active charge plan: status header + the two stat tiles + detail card.
    private func activePlanBlock(_ active: ActivePlanProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                ChargePlanStatusBadge(text: active.statusText, tone: active.statusTone, showsDot: true)
                if !active.ratePlanHeaderText.isEmpty {
                    Text(verbatim: active.ratePlanHeaderText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }

            HStack(spacing: TSSpacing.sm) {
                ChargePlanStatTile(
                    label: ChargePlansStrings.string("widget.chargePlans.targetSoc", "Target SOC"),
                    value: active.targetSocText
                )
                ChargePlanStatTile(
                    label: ChargePlansStrings.string("widget.chargePlans.departure", "Departure"),
                    value: active.departureText
                )
            }

            detailCard(
                entries: active.detailEntries,
                emptyMessage: ChargePlansStrings.string("widget.chargePlans.noDetails", "No plan details")
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The rate-plan section (web `Rate Plans` header + the rate detail card).
    private var rateSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Divider().overlay(Color.TS.border)
            ChargePlansStrings.text("widget.chargePlans.ratePlans", "Rate Plans")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            detailCard(
                entries: projection.rateRows,
                emptyMessage: ChargePlansStrings.string("widget.chargePlans.noRates", "No rate plans")
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A list of detail rows (web `WidgetDetailCard`): trims to four rows in the
    /// dense (`size.rows <= 3`) layout, friendly empty state when there are none.
    @ViewBuilder
    private func detailCard(entries: [ChargePlanDetailRow], emptyMessage: String) -> some View {
        if entries.isEmpty {
            ChargePlanInlineEmpty(message: emptyMessage)
        } else {
            let visible = isDense ? Array(entries.prefix(4)) : entries
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, row in
                    ChargePlanDetailRowView(row: row)
                    if index < visible.count - 1 {
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                }
            }
        }
    }

    /// Web no-active-plan empty state ("No charge plans").
    private var planEmptyState: some View {
        ChargePlanInlineEmpty(
            message: ChargePlansStrings.string("widget.chargePlans.noPlans", "No charge plans"),
            systemImage: "clock"
        )
    }
}

// MARK: - Detail row (web `WidgetDetailCard` line)

/// One label · value · optional-chip row — the web `WidgetDetailCard` line. The
/// value is monospaced when `row.mono` is set (the rate rows).
private struct ChargePlanDetailRowView: View {
    let row: ChargePlanDetailRow

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.value)
                .font(row.mono ? Font.system(size: 12, design: .monospaced) : Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            if let badge = row.badge {
                ChargePlanStatusBadge(text: badge.text, tone: badge.tone, showsDot: false)
            }
        }
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: rowAccessibilityLabel))
    }

    /// "{label}, {value}[, {badge}]" — the per-row VoiceOver phrase.
    private var rowAccessibilityLabel: String {
        if let badge = row.badge {
            return "\(row.label), \(row.value), \(badge.text)"
        }
        return "\(row.label), \(row.value)"
    }
}

// MARK: - Stat tile (web `StatCard`)

/// A compact headline tile — the native counterpart of the web `StatCard`
/// (`label` + prominent `value`) used by the two-up summary grid.
private struct ChargePlanStatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - Status badge (web `<Badge variant size="sm" [dot]>`)

/// A capsule status chip styled with the shared status tokens, carrying a
/// pre-resolved tone + label. Mirrors the web `<Badge variant size="sm">` (with
/// an optional leading state `dot` for the active-plan header).
private struct ChargePlanStatusBadge: View {
    let text: String
    let tone: ChargePlanTone
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

/// A small centered empty state for the in-body sections (no active plan / no
/// details / no rates) — the web `EmptyState` with an icon + message.
private struct ChargePlanInlineEmpty: View {
    let message: String
    var systemImage: String = "clock"

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

// MARK: - Tone mapping (web `badgeVariantMap`)

private extension ChargePlanTone {
    /// Maps the SwiftUI-free projection tone to the shared design-system `TSTone`.
    var tsTone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .neutral: .neutral
        }
    }
}
