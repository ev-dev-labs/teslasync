//
//  SoftwareUpdateHistoryWidget.Feed.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  The native subviews that compose the surface: the firmware-update event feed
//  (web `WidgetEventFeed` → `TimelineItem` rows), the compact latest-version
//  badge (web `CompactView`), the per-status chip, and the freshness chip. They
//  lean on the shared design tokens so they read identically to the rest of the
//  app. The `SoftwareUpdateTone → Color` mapping lives here (the view layer) so
//  the projection stays renderer-agnostic.
//

import SwiftUI

// MARK: - Tone → palette (web `STATUS_MAP` hex → design tokens)

extension SoftwareUpdateTone {
    /// The design-token color for this tone — the semantic mapping of the web
    /// `STATUS_MAP` hex colors onto the generated `Color.TS` palette.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .info: Color.TS.chartSeriesSpeed
        case .neutral: Color.TS.textMuted
        case .scheduled: Color.TS.chartSeriesPower
        case .current: Color.TS.chartSeriesRegen
        }
    }
}

// MARK: - Event feed (web `WidgetEventFeed`)

/// The firmware-update event feed — a native port of the web `WidgetEventFeed`.
/// The rows arrive already projected + sorted + sliced; this view stitches the
/// vertical connectors between them.
struct SoftwareUpdateFeedList: View {
    let items: [SoftwareUpdateFeedItem]

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    SoftwareUpdateFeedRow(item: item, isLast: index == items.count - 1)
                }
            }
        }
    }
}

/// One event-feed row: a tinted icon box + a vertical connector, then the
/// version, the status subtitle, and the relative time — the native port of the
/// web `TimelineItem` (`icon` box at `${color}15`, title, subtitle, time).
struct SoftwareUpdateFeedRow: View {
    let item: SoftwareUpdateFeedItem
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(spacing: 0) {
                iconBox
                if !isLast {
                    Rectangle()
                        .fill(Color.TS.border)
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                        .padding(.top, 4)
                        .accessibilityHidden(true)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: item.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: item.relativeTime)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.md)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44, alignment: .top)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SoftwareUpdateHistoryAccessibility.rowSummary(item)))
    }

    private var iconBox: some View {
        Image(systemName: item.symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(item.tone.color)
            .frame(width: 32, height: 32)
            .background(
                item.tone.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Compact latest badge (web `CompactView`)

/// The compact (1-column) summary: a download glyph + the latest version, with a
/// tinted status chip — a native port of the web `CompactView`.
struct SoftwareUpdateCompactRow: View {
    let latest: SoftwareUpdateLatest

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesRegen)
                .accessibilityHidden(true)
            Text(verbatim: latest.version)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.xs)
            SoftwareUpdateStatusChip(label: latest.statusLabel, tone: latest.tone)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SoftwareUpdateHistoryAccessibility.compactSummary(latest)))
    }
}

// MARK: - Status chip (web `Badge`)

/// The tinted capsule label for a status, styled with the same tokens as the
/// shared `TSBadge` (which takes a `LocalizedStringKey`, so it cannot resolve
/// this surface's per-table string — hence the small specialization).
struct SoftwareUpdateStatusChip: View {
    let label: String
    let tone: SoftwareUpdateTone

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .lineLimit(1)
    }
}

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders.
struct SoftwareUpdateFreshnessChip: View {
    let connection: SoftwareUpdateHistoryConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SoftwareUpdateHistoryStrings.string("widget.softwareUpdateHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SoftwareUpdateHistoryStrings.string("widget.softwareUpdateHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SoftwareUpdateHistoryStrings.string("widget.softwareUpdateHistory.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
