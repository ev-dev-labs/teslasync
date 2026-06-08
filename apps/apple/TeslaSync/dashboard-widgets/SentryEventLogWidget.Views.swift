//
//  SentryEventLogWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0086 · SentryEventLogWidget (Apple)
//
//  The presentational subviews composed by `SentryEventLogWidget`: the stale/offline
//  connectivity banner, the newest-first event feed + its friendly empty state, and
//  the individual timeline event rows. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the feed when the bound source is not live,
/// so cached events are clearly labeled (web `DataFreshness` indicator intent).
struct SentryConnectivityBanner: View {
    let connection: SentryConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.sentryOfflineBanner" : "widget.sentryStaleBanner"
        let fallback = isOffline
            ? "Offline — showing last known events"
            : "Reconnecting — events may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SentryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Event feed (web `WidgetEventFeed`)

/// The newest-first event feed with a friendly empty state — the native port of the
/// web `WidgetEventFeed`. The already-sorted items are capped at `maxItems` (web
/// `eventLimit`); `showsSubtitle` gates the per-row subtitle (web `isWide`).
struct SentryEventFeed: View {
    let items: [SentryFeedItem]
    let maxItems: Int
    let showsSubtitle: Bool

    var body: some View {
        let shown = Array(items.prefix(maxItems))
        if shown.isEmpty {
            SentryEmptyFeed()
        } else {
            let now = Date()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { offset, item in
                    SentryEventRow(
                        item: item,
                        showsSubtitle: showsSubtitle,
                        isLast: offset == shown.count - 1,
                        now: now
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

/// The feed-level empty state (web `WidgetEventFeed` `emptyMessage` "No security
/// events recorded", `emptyIcon` Shield). Always rendered in place of a blank panel.
struct SentryEmptyFeed: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
            SentryStrings.text("widget.noSentryEvents", "No security events recorded")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

/// A single event row: a connected timeline dot/icon in the resolved event color,
/// the localized title + relative time, and (when wide) the lock/sentry subtitle
/// (web `TimelineItem`).
struct SentryEventRow: View {
    let item: SentryFeedItem
    let showsSubtitle: Bool
    let isLast: Bool
    let now: Date

    var body: some View {
        let visual = SentryEventCatalog.visual(for: item.kind)
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
                    Text(verbatim: SentryRelativeTime.string(for: item.timestamp, relativeTo: now))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                if showsSubtitle {
                    Text(verbatim: item.subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.sm)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SentryAccessibility.eventSummary(
            for: item,
            showsSubtitle: showsSubtitle
        )))
    }
}
