//
//  SafetyHistoryWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  The presentational subviews composed by `SafetyHistoryWidget`: the stale/offline
//  connectivity banner, the three-up 30-day stat tiles (web `StatCard` row), the
//  newest-first event feed + its friendly empty state, the individual timeline event
//  rows, and the narrow single-line compact summary (web `CompactView`). All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so cached events are clearly labeled (web `DataFreshness` indicator intent).
struct SafetyConnectivityBanner: View {
    let connection: SafetyConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.safetyOfflineBanner" : "widget.safetyStaleBanner"
        let fallback = isOffline
            ? "Offline — showing last known events"
            : "Reconnecting — events may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SafetyStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat tiles (web `StatCard` three-up row)

/// One stat tile — the native port of the web `StatCard`: a muted label, a large
/// value, and an optional sublabel (the "Trend" tile's Increasing/Decreasing/Stable).
struct SafetyStatTile: View {
    let label: String
    let value: String
    var sublabel: String?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            TSMetricValue(value)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let sublabel {
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        if let sublabel { return "\(label): \(value), \(sublabel)" }
        return "\(label): \(value)"
    }
}

/// The three-up 30-day summary above the feed (web stat-card row): the 30-day total,
/// the most-common type, and the trend (with its localized sublabel).
struct SafetyStatsRow: View {
    let stats: SafetyStats

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            SafetyStatTile(
                label: SafetyStrings.string("widget.safetyTotal", "Events (30d)"),
                value: stats.totalEvents.formatted()
            )
            SafetyStatTile(
                label: SafetyStrings.string("widget.safetyMostCommon", "Most Common"),
                value: stats.mostCommon
            )
            SafetyStatTile(
                label: SafetyStrings.string("widget.safetyTrend", "Trend"),
                value: stats.trend.glyph,
                sublabel: SafetyStatsBuilder.trendSublabel(stats.trend, localize: SafetyStrings.string)
            )
        }
    }
}

// MARK: - Event feed (web `WidgetEventFeed`)

/// The newest-first event feed with a friendly empty state — the native port of the
/// web `WidgetEventFeed`. The already-sorted items are capped at `maxItems`
/// (web `maxItems={10}`).
struct SafetyEventFeed: View {
    let items: [SafetyFeedItem]
    let maxItems: Int

    var body: some View {
        let shown = Array(items.prefix(maxItems))
        if shown.isEmpty {
            SafetyEmptyFeed()
        } else {
            let now = Date()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { offset, item in
                    SafetyEventRow(item: item, isLast: offset == shown.count - 1, now: now)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

/// The feed-level empty state (web `WidgetEventFeed` `emptyMessage` "No safety
/// events", `emptyIcon` AlertOctagon). Always rendered in place of a blank panel.
struct SafetyEmptyFeed: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.octagon")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
            SafetyStrings.text("widget.noSafetyEvents", "No safety events")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

/// A single event row: a connected timeline dot/icon in the resolved event color, the
/// localized title + relative time, and the lock/sentry-style subtitle (web
/// `TimelineItem`).
struct SafetyEventRow: View {
    let item: SafetyFeedItem
    let isLast: Bool
    let now: Date

    var body: some View {
        let visual = SafetyEventCatalog.visual(for: item.kind)
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(spacing: 0) {
                Image(systemName: visual.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(visual.dotColor)
                    .frame(width: 18, height: 18)
                    .accessibilityHidden(true)
                if !isLast {
                    Rectangle().fill(Color.TS.border).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: item.title)
                        .font(Font.TS.bodySm).fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: TSSpacing.xs)
                    Text(verbatim: SafetyRelativeTime.string(for: item.timestamp, relativeTo: now))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                Text(verbatim: item.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.sm)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SafetyAccessibility.eventSummary(for: item)))
    }
}

// MARK: - Compact summary (web `CompactView`)

/// The narrow single-line summary (web `CompactView`): the AlertOctagon glyph, the
/// 30-day event count (or "No safety events" when zero), and the most-common type +
/// trend glyph. The registry `minSize` (cols ≥ 2) clamps above the compact threshold,
/// so production renders the wide layout; this is preserved for full web parity.
struct SafetyCompactView: View {
    let stats: SafetyStats

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: primaryLine)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                if stats.totalEvents > 0 {
                    Text(verbatim: "\(stats.mostCommon) \(stats.trend.glyph)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SafetyAccessibility.compactSummary(
            stats: stats,
            localize: SafetyStrings.string
        )))
    }

    private var primaryLine: String {
        guard stats.totalEvents > 0 else {
            return SafetyStrings.string("widget.noSafetyEvents", "No safety events")
        }
        let events = SafetyStrings.string("widget.safetyEvents", "events")
        let window = SafetyStrings.string("widget.safety30dWindow", "(30d)")
        return "\(stats.totalEvents.formatted()) \(events) \(window)"
    }
}
