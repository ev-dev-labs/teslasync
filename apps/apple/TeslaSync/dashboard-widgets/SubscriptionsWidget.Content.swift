//
//  SubscriptionsWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) headline layout
//  (active count + next-expiry chip) and the standard detail list (one row per
//  subscription with its value + status chip), plus the status badge. Split from
//  SubscriptionsWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension SubscriptionsWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1×2): active count + "active" + next-expiry chip (web compact) ──
    @ViewBuilder
    private var compactContent: some View {
        if projection.hasData {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: "creditcard.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: "\(projection.activeCount)")
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                SubscriptionsStrings.text("widget.subscriptions.activeCount", "active")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                if let nextText = projection.nextExpiryText {
                    Text(verbatim: nextText)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .padding(.horizontal, TSSpacing.sm)
                        .padding(.vertical, 2)
                        .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: SubscriptionsAccessibility.summary(for: projection)))
        } else {
            emptyState
        }
    }

    /// ── Standard (2×4): the full subscription detail list (web WidgetDetailCard) ──
    private var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                if connection != .live { connectivityBanner }
                detailList
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SubscriptionsAccessibility.summary(for: projection)))
    }

    @ViewBuilder
    private var detailList: some View {
        let rows = projection.rows
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
            detailRow(row)
            if index < rows.count - 1 {
                Divider().overlay(Color.TS.border)
            }
        }
    }

    /// One detail row — web `WidgetDetailCard` line: label · value · status chip.
    private func detailRow(_ row: SubscriptionRow) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.name)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.valueText)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            SubscriptionStatusBadge(active: row.active)
        }
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(row)))
    }

    /// "{name}, {value}, {Active|Expired}" — the per-row VoiceOver phrase.
    private func rowAccessibilityLabel(_ row: SubscriptionRow) -> String {
        let status = SubscriptionsStrings.statusLabel(active: row.active)
        return "\(row.name), \(row.valueText), \(status)"
    }
}

// MARK: - SubscriptionStatusBadge (tone chip — web `<Badge variant size="sm">`)

/// A capsule status chip styled with the shared status tokens, carrying a
/// pre-localized tone label. Mirrors the web `<Badge variant={success|danger}
/// size="sm">{Active|Expired}</Badge>` mapping (web `badgeVariantMap`:
/// success→success, error→danger).
private struct SubscriptionStatusBadge: View {
    let active: Bool

    private var tone: TSTone {
        active ? .success : .danger
    }

    var body: some View {
        let label = SubscriptionsStrings.statusLabel(active: active)
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: label))
    }
}
