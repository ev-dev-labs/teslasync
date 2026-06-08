//
//  RouteEfficiencyWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0082 · RouteEfficiencyWidget (Apple)
//
//  The presentational subviews composed by `RouteEfficiencyWidget`: the tinted tier
//  chip, the stale/offline connectivity banner, the ranked route list + its rows (with
//  the proportional background bar), and the friendly empty state. All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Tier chip (web `Badge`)

/// The efficiency-tier capsule chip styled with the shared `TSTone` tokens, resolving
/// its pre-localized label from the per-surface i18n table. Hidden from VoiceOver — the
/// enclosing row's combined label already speaks the tier.
struct RouteEfficiencyBadgeChip: View {
    let badge: RouteEfficiencyBadge

    var body: some View {
        Text(verbatim: RouteEfficiencyStrings.string(badge.localization.key, badge.localization.fallback))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(badge.tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(badge.tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(badge.tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the list when the bound source is not live, so
/// the cached routes are clearly labeled (web freshness-indicator intent).
struct RouteEfficiencyConnectivityBanner: View {
    let connection: RouteEfficiencyConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.routeEfficiency.offlineBanner" : "widget.routeEfficiency.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded routes"
            : "Refreshing — these routes may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            RouteEfficiencyStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Ranked list (web `WidgetRankedList`)

/// The route-efficiency ranked list — the native port of the web `WidgetRankedList`.
/// The already value-descending rows are capped at `limit` (web standard list = 5) and
/// each row draws a proportional background bar relative to the visible maximum.
struct RouteEfficiencyRankedList: View {
    let rows: [RouteEfficiencyRow]
    var limit: Int = 5

    var body: some View {
        let visible = Array(rows.prefix(limit))
        let maxValue = visible.map(\.value).max() ?? 0
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(Array(visible.enumerated()), id: \.element.id) { index, row in
                RouteEfficiencyRankedRow(rank: index + 1, row: row, maxValue: maxValue)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }
}

/// A single ranked row: the proportional bar behind a rank number, the truncating
/// route label, the tier chip, and the monospaced formatted value (web `RankedList`
/// row). The whole row is one VoiceOver element speaking rank, route, value, and tier.
struct RouteEfficiencyRankedRow: View {
    let rank: Int
    let row: RouteEfficiencyRow
    let maxValue: Double

    private var barFraction: Double {
        maxValue > 0 ? row.value / maxValue : 0
    }

    private var barColor: Color {
        row.isBest ? Color.TS.statusSuccess : Color.TS.chartSeriesSpeed
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: rank.formatted(.number))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 20, alignment: .trailing)
                .accessibilityHidden(true)
            Text(verbatim: row.label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            RouteEfficiencyBadgeChip(badge: row.badge)
            Text(verbatim: row.formattedValue)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(alignment: .leading) {
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(barColor.opacity(0.15))
                    .frame(width: geo.size.width * barFraction)
                    .frame(maxHeight: .infinity)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: RouteEfficiencyAccessibility.rowSummary(
            rank: rank,
            row: row,
            localize: RouteEfficiencyStrings.string
        )))
    }
}

// MARK: - Empty state (web `EmptyState` "No route data")

/// The "No route data" empty state — always rendered in place of a blank panel (web
/// `EmptyState` with the route glyph).
struct RouteEfficiencyEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                RouteEfficiencyStrings.text("widget.routeEfficiency.noData", "No route data")
            } icon: {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
            }
        } description: {
            RouteEfficiencyStrings.text(
                "widget.routeEfficiency.emptyHint",
                "Recurring routes appear once you've driven the same trip more than once."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
