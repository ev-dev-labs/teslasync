//
//  CommandHistoryWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0029 · CommandHistoryWidget (Apple)
//
//  The presentational subviews composed by `CommandHistoryWidget`: the compact
//  latest-command row + its status badge (web `CompactView`), the stale/offline
//  connectivity banner, the newest-first command feed + its friendly empty state,
//  and the individual timeline command rows (web `WidgetEventFeed` / `TimelineItem`).
//  All consume pre-localized strings from the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Status badge (web `Badge`)

/// A compact tinted status badge — the native port of the web `Badge` used by
/// `CompactView`. The label arrives pre-localized; the tone maps to a status token.
struct CommandStatusBadge: View {
    let label: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Compact row (web `CompactView`)

/// The one-column collapsed layout (web `CompactView`): a terminal glyph, the
/// latest command's display name, and a success/failed/pending status badge. The
/// 44pt minimum height preserves the web `min-h-[44px]` touch target.
struct CommandCompactRow: View {
    let item: CommandFeedItem

    var body: some View {
        let tone = CommandStatusCatalog.compactTone(for: item.kind)
        let label = CommandStatusCatalog.compactLabel(for: item.kind, localize: CommandStrings.string)
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "terminal.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: item.title)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: TSSpacing.sm)
            CommandStatusBadge(label: label, tone: tone)
        }
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: CommandAccessibility.compactSummary(
            command: item.title,
            statusLabel: label
        )))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the feed when the bound source is not live,
/// so cached commands are clearly labeled (web `DataFreshness` indicator intent).
struct CommandConnectivityBanner: View {
    let connection: CommandConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.commandOfflineBanner" : "widget.commandStaleBanner"
        let fallback = isOffline
            ? "Offline — showing last known commands"
            : "Reconnecting — commands may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            CommandStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Command feed (web `WidgetEventFeed`)

/// The newest-first command feed with a friendly empty state — the native port of
/// the web `WidgetEventFeed`. The source-order items are sorted + capped at
/// `maxItems` (web `maxItems={10}`) by `CommandFeedBuilder.feed`.
struct CommandEventFeed: View {
    let items: [CommandFeedItem]
    let maxItems: Int

    var body: some View {
        let shown = CommandFeedBuilder.feed(items: items, limit: maxItems)
        if shown.isEmpty {
            CommandEmptyFeed()
        } else {
            let now = Date()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { offset, item in
                    CommandEventRow(
                        item: item,
                        isLast: offset == shown.count - 1,
                        now: now
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

/// The feed-level empty state (web `WidgetEventFeed` `emptyMessage` "No commands
/// sent", `emptyIcon` Terminal). Always rendered in place of a blank panel.
struct CommandEmptyFeed: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "terminal.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
            CommandStrings.text("widget.noCommands", "No commands sent")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

/// A single command row: a connected timeline dot/icon in the resolved status color,
/// the display-formatted command title, the relative time, and the raw status token
/// subtitle (web `TimelineItem`).
struct CommandEventRow: View {
    let item: CommandFeedItem
    let isLast: Bool
    let now: Date

    var body: some View {
        let visual = CommandStatusCatalog.feedVisual(for: item.kind)
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
                    Text(verbatim: CommandRelativeTime.string(for: item.timestamp, relativeTo: now))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                Text(verbatim: item.statusRaw)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.sm)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: CommandAccessibility.feedSummary(for: item)))
    }
}
