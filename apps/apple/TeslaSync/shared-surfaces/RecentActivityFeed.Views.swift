//
//  RecentActivityFeed.Views.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The presentational subviews composed by `RecentActivityFeed`: the timeline (web `Timeline`) with its
//  connector rail, one feed row (the tinted glyph dot, the localized title with the optional
//  click-through link, the subtitle, and the relative time), the tone → token palette, and the
//  freshness chip (P4 connectivity axis). All colour comes from the shared P1/S9 tokens — no Tailwind
//  ports, no raw hex — and all copy resolves through the P1/S10 facade.
//
//  Accessibility note: a non-linkable row is one combined VoiceOver element whose spoken label is built
//  by `RecentActivityFeedAccessibility` (the web row text). A linkable row keeps its title as a separate,
//  individually focusable button (its own label + an "opens the linked item" hint), with the subtitle
//  and time read as adjacent text.
//

import SwiftUI

// MARK: - Palette (web Tailwind value colors → adaptive tokens)

/// Maps a feed row's tone to a theme-adaptive semantic token. The web uses Tailwind values (fuchsia /
/// amber / emerald / sky-indigo / rose / cyan / muted); native uses the semantic tokens so light / dark
/// / high-contrast all resolve correctly.
enum RecentActivityFeedPalette {
    static func tint(_ tone: RecentActivityFeedTone) -> Color {
        switch tone {
        case .power: Color.TS.chartSeriesPower
        case .warning: Color.TS.statusWarning
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .danger: Color.TS.statusDanger
        case .accent: Color.TS.accent
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Timeline (web `Timeline`)

/// The chronological list of feed rows over a connector rail — the native parity of the web `Timeline`.
/// Rows render in array order; each is a single VoiceOver element (or a focusable link when it routes).
struct RecentActivityFeedTimeline: View {
    let rows: [RecentActivityFeedRow]
    let canNavigate: Bool
    let onNavigate: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { offset, row in
                RecentActivityFeedRowView(
                    row: row,
                    isLast: offset == rows.count - 1,
                    canNavigate: canNavigate,
                    onNavigate: onNavigate
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Row (web `Timeline` item)

/// One feed row: the connector rail + tinted glyph dot, the title (a link when it routes), the subtitle,
/// and the right-anchored relative time. The connector hides on the final row (web `i < length - 1`).
struct RecentActivityFeedRowView: View {
    let row: RecentActivityFeedRow
    let isLast: Bool
    let canNavigate: Bool
    let onNavigate: (String) -> Void

    private let resolver = RecentActivityFeedStrings.string
    private let dotSize: CGFloat = 22

    private var tint: Color {
        RecentActivityFeedPalette.tint(row.tone)
    }

    private var title: String {
        resolver(row.titleKey, row.titleFallback)
    }

    private var timeText: String {
        row.relative.text(resolver: resolver)
    }

    private var hasLink: Bool {
        canNavigate && row.destination != nil
    }

    private var accessibilityText: String {
        RecentActivityFeedAccessibility.rowLabel(title: title, subtitle: row.subtitle, time: timeText)
    }

    var body: some View {
        rowAccessibility(
            HStack(alignment: .top, spacing: TSSpacing.md) {
                dotColumn
                contentColumn
                    .padding(.bottom, isLast ? 0 : TSSpacing.lg)
            }
        )
    }

    @ViewBuilder
    private func rowAccessibility(_ view: some View) -> some View {
        if hasLink {
            view.accessibilityElement(children: .contain)
        } else {
            view
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: accessibilityText))
        }
    }

    private var dotColumn: some View {
        ZStack(alignment: .top) {
            if !isLast {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
                    .padding(.top, dotSize)
                    .accessibilityHidden(true)
            }
            Image(systemName: row.symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: dotSize, height: dotSize)
                .background(Color.TS.surface, in: Circle())
                .overlay(Circle().strokeBorder(tint, lineWidth: 2))
                .accessibilityHidden(true)
        }
        .frame(width: dotSize)
    }

    private var contentColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                titleView
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: timeText)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .fixedSize()
            }
            if !row.subtitle.isEmpty {
                Text(verbatim: row.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var titleView: some View {
        if hasLink, let destination = row.destination {
            Button {
                onNavigate(destination)
            } label: {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: title))
            .accessibilityHint(Text(verbatim: resolver("recentActivityFeed.openHint", "Opens the linked item")))
        } else {
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.leading)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the feed when it is not live — a coloured dot + a label (`Stale` /
/// `Offline`). It is a button so VoiceOver and pointer users can re-request the entries, with an
/// explicit label.
struct RecentActivityFeedFreshnessChip: View {
    let connection: RecentActivityFeedConnection
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
        case .live: RecentActivityFeedStrings.string("recentActivityFeed.live", "Live")
        case .stale: RecentActivityFeedStrings.string("recentActivityFeed.stale", "Stale")
        case .offline: RecentActivityFeedStrings.string("recentActivityFeed.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            RecentActivityFeedStrings.string("recentActivityFeed.staleA11y", "Stale — tap to refresh")
        case .offline:
            RecentActivityFeedStrings.string(
                "recentActivityFeed.offlineA11y", "Offline — showing the last known activity"
            )
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
