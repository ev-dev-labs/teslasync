//
//  WidgetEventFeed.Views.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  The presentational subviews composed by `WidgetEventFeed`: the timeline list (the native parity of
//  the web body that maps each `EventFeedItem` to a `TimelineItem`), the event row, and the freshness
//  chip (P4 connectivity axis). The row reproduces the web `TimelineItem` composition: a leading
//  tinted icon box, a vertical connector to the next row, the title (truncated), the optional
//  subtitle, and the relative time — and, when the item carries an `href` and the host wired a
//  handler, the whole row becomes a tappable drill-through (web row `<Link>`). All colour comes from
//  the shared P1/S9 tokens via `TSTone` / `TSIconBox` — no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Tone bridge (web `color` → P1/S9 token)

/// Maps the pure `WidgetEventTone` (the native mirror of the web `EventFeedItem.color`) onto the
/// shared `TSTone` palette so the row tint stays token-driven.
extension WidgetEventTone {
    var tsTone: TSTone {
        switch self {
        case .accent: .accent
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        case .neutral: .neutral
        }
    }
}

// MARK: - Feed list (web timeline body)

/// The timeline list — the data render of the surface. Maps the arranged items to connected rows,
/// exactly as the web body maps each `EventFeedItem` to a `TimelineItem`. The relative-time string is
/// supplied per row by the surface (web `formatRelativeTime`).
struct WidgetEventFeedListView: View {
    let items: [WidgetEventFeedItem]
    let canSelect: Bool
    let relativeTime: (Date) -> String
    let onSelect: (WidgetEventFeedItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { offset, item in
                WidgetEventFeedRow(
                    item: item,
                    isLast: offset == items.count - 1,
                    canSelect: canSelect,
                    time: relativeTime(item.timestamp),
                    onSelect: onSelect
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Event row (web `TimelineItem`)

/// A single event row with its connector — the native parity of the web `TimelineItem`. Renders the
/// leading tinted icon box (web `color` box + glyph), the connector to the next row, the truncated
/// title, the optional subtitle, and the relative time. When the item carries an `href` and the host
/// wired a handler, the whole row is a button that drives the drill-through (web row `<Link>`).
struct WidgetEventFeedRow: View {
    let item: WidgetEventFeedItem
    let isLast: Bool
    let canSelect: Bool
    let time: String
    let onSelect: (WidgetEventFeedItem) -> Void

    private var isInteractive: Bool {
        item.href != nil && canSelect
    }

    private var severityText: String? {
        item.severity.map { WidgetEventFeedStrings.string($0.accessibilityKey, $0.accessibilityFallback) }
    }

    private var accessibilityText: String {
        WidgetEventFeedAccessibility.rowLabel(
            severity: severityText,
            title: item.title,
            subtitle: item.subtitle,
            time: time
        )
    }

    var body: some View {
        if isInteractive {
            Button {
                onSelect(item)
            } label: {
                rowContent
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: accessibilityText))
            .accessibilityAddTraits(.isButton)
            .accessibilityHint(Text(verbatim: WidgetEventFeedStrings.string(
                "widgetEventFeed.openHint", "Opens details"
            )))
        } else {
            rowContent
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: accessibilityText))
        }
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            connector
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: item.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(verbatim: time)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, isLast ? 0 : TSSpacing.md)
        }
        .contentShape(Rectangle())
    }

    private var connector: some View {
        VStack(spacing: 0) {
            TSIconBox(systemName: item.iconSymbol, tone: item.tone.tsTone)
            if !isLast {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
                    .padding(.top, TSSpacing.xs)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown above the list when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the feed, with
/// an explicit label.
struct WidgetEventFeedFreshnessChip: View {
    let connection: WidgetEventFeedConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: WidgetEventFeedStrings.string("widgetEventFeed.live", "Live")
        case .stale: WidgetEventFeedStrings.string("widgetEventFeed.stale", "Stale")
        case .offline: WidgetEventFeedStrings.string("widgetEventFeed.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            WidgetEventFeedStrings.string("widgetEventFeed.staleA11y", "Stale — tap to refresh")
        case .offline:
            WidgetEventFeedStrings.string("widgetEventFeed.offlineA11y", "Offline — showing the last known events")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
