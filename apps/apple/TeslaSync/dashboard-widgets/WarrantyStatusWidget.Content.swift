//
//  WarrantyStatusWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) days-remaining
//  headline and the standard time/mileage `MetricBar`s + the coverage detail card,
//  plus the metric-bar / detail-row / status-chip building blocks. Split from
//  WarrantyStatusWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension WarrantyStatusWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1×2): days remaining + Active/Expired badge (web compact branch) ──
    @ViewBuilder
    private var compactContent: some View {
        if projection.hasData {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                Text(verbatim: projection.headlineText)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                WarrantyStrings.text("widget.warranty.daysLeft", "days left")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                WarrantyBadgeChip(badge: projection.statusBadge)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: WarrantyAccessibility.summary(for: projection)))
        } else {
            emptyState
        }
    }

    /// ── Standard (2×2): time + mileage progress bars + coverage detail card ──
    private var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live { connectivityBanner }
                if let time = projection.timeMetric { WarrantyMetricBar(metric: time) }
                if let mileage = projection.mileageMetric { WarrantyMetricBar(metric: mileage) }
                WarrantyDetailCard(entries: projection.entries)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: WarrantyAccessibility.summary(for: projection)))
    }
}

// MARK: - WarrantyMetricBar (web `MetricBar`: label + coloured readout + fill)

/// A labeled proportion bar (web `MetricBar`). The `TSMetricBar` design-token
/// primitive renders the fill; the label row reproduces the web header (title left,
/// tone-coloured value right).
struct WarrantyMetricBar: View {
    let metric: WarrantyMetric

    private var sublabel: String {
        let unit: String = switch metric.unit {
        case let .symbol(symbol): symbol
        case let .localized(ref): WarrantyStrings.resolve(ref)
        }
        return "\(metric.valueText) \(unit)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: WarrantyStrings.resolve(metric.label))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(metric.variant.tone.color)
            }
            TSMetricBar(fraction: metric.fraction, tone: metric.variant.tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(WarrantyStrings.resolve(metric.label)): \(sublabel)"))
    }
}

// MARK: - WarrantyDetailCard (web `WidgetDetailCard`)

/// The coverage / dates detail list (web `WidgetDetailCard`). Renders a friendly
/// empty state when there are no entries (web `entries.length === 0`).
struct WarrantyDetailCard: View {
    let entries: [WarrantyDetailEntry]

    var body: some View {
        if entries.isEmpty {
            ContentUnavailableView {
                Label {
                    WarrantyStrings.text("widget.warranty.noData", "No warranty data")
                } icon: {
                    Image(systemName: "checkmark.shield.fill")
                }
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    WarrantyDetailRow(entry: entry)
                    if index < entries.count - 1 {
                        Rectangle()
                            .fill(Color.TS.border.opacity(0.5))
                            .frame(height: 1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One detail row (web `DetailEntry`): label left, value (+ optional badge) right.
private struct WarrantyDetailRow: View {
    let entry: WarrantyDetailEntry

    private var valueText: String {
        switch entry.value {
        case .none: "—"
        case let .text(text): text
        case let .localized(ref): WarrantyStrings.resolve(ref)
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Text(verbatim: WarrantyStrings.resolve(entry.label))
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            valueLabel
            if let badge = entry.badge {
                WarrantyBadgeChip(badge: badge)
            }
        }
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    @ViewBuilder
    private var valueLabel: some View {
        let text = Text(verbatim: valueText)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
        if entry.mono {
            text.monospacedDigit()
        } else {
            text
        }
    }

    private var accessibilityText: String {
        let label = WarrantyStrings.resolve(entry.label)
        let badge = entry.badge.map { ", \(WarrantyStrings.resolve($0.label))" } ?? ""
        return "\(label): \(valueText)\(badge)"
    }
}

// MARK: - WarrantyBadgeChip (web `<Badge variant size="sm">`)

/// A compact tinted status chip (web `Badge`, no dot) styled with the shared tone
/// tokens. Resolves the localized label through the P1/S10 facade — the shared
/// `TSBadge` takes only a `LocalizedStringKey` (default catalog table), so it can't
/// resolve this surface's per-table key.
struct WarrantyBadgeChip: View {
    let badge: WarrantyBadge

    var body: some View {
        let tone = badge.variant.tone
        let label = WarrantyStrings.resolve(badge.label)
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: label))
    }
}
