//
//  LocationFavoritesWidget.RankedList.swift
//  TeslaSync — P4 dashboard widget · 0059 · LocationFavoritesWidget (Apple)
//
//  The native subviews that compose the surface: the current-location status
//  badge (web emoji + `Badge`), the favorites ranked list (web
//  `WidgetRankedList`), and the freshness chip. They lean on the shared design
//  tokens + `TSTone` so they read identically to the rest of the app.
//

import SwiftUI

// MARK: - Status badge (web emoji span + `Badge`)

/// The current-location status badge: the presence emoji next to a tinted chip
/// carrying the localized label. Mirrors the web header row
/// (`<span role="img">{emoji}</span> <Badge>{label}</Badge>`).
struct LocationStatusBadge: View {
    let presence: LocationPresence
    var emojiFont: Font = .TS.section

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: presence.emoji)
                .font(emojiFont)
                .accessibilityHidden(true)
            LocationStatusChip(presence: presence)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LocationFavoritesStrings.label(for: presence)))
    }
}

/// The tinted capsule label for a presence, styled with the same tokens as the
/// shared `TSBadge` (the shared badge takes a `LocalizedStringKey`, so it can't
/// resolve this surface's per-table string — hence the small specialization).
struct LocationStatusChip: View {
    let presence: LocationPresence

    var body: some View {
        Text(verbatim: LocationFavoritesStrings.label(for: presence))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(presence.tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(presence.tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(presence.tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders.
struct LocationFreshnessChip: View {
    let connection: LocationFavoritesConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = LocationFavoritesStrings.string("widget.locationFavorites.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = LocationFavoritesStrings.string("widget.locationFavorites.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = LocationFavoritesStrings.string("widget.locationFavorites.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Ranked favorites list (web `WidgetRankedList`)

/// The favorites ranked list — a native port of the web `WidgetRankedList`. The
/// rows arrive already sorted + sliced by the projection; this view sizes each
/// row's relative background bar against the visible maximum.
struct LocationFavoritesRankedList: View {
    let items: [LocationRankedItem]
    var showBars = true

    private var maxValue: Int {
        items.map(\.value).max() ?? 0
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: TSSpacing.xs) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    LocationRankedRow(
                        rank: index + 1,
                        item: item,
                        fraction: maxValue > 0 ? Double(item.value) / Double(maxValue) : 0,
                        showBar: showBars
                    )
                }
            }
        }
    }
}

/// One favorites row: rank · label · "`12× · 3d ago`", over a relative-width
/// background bar (web `bg-blue-400` at 15% opacity). Honors the web 44pt min
/// hit target.
struct LocationRankedRow: View {
    let rank: Int
    let item: LocationRankedItem
    let fraction: Double
    let showBar: Bool

    var body: some View {
        ZStack(alignment: .leading) {
            if showBar, fraction > 0 {
                GeometryReader { proxy in
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .fill(Color.TS.chartSeriesSpeed.opacity(0.15))
                        .frame(width: max(0, proxy.size.width * fraction))
                }
                .accessibilityHidden(true)
            }
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: "\(rank)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 20, alignment: .trailing)
                Text(verbatim: item.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: item.formattedValue)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let rankPart = LocationFavoritesStrings.count("widget.locationFavorites.rankA11y", "Rank %lld", rank)
        return "\(rankPart). \(item.label). \(item.formattedValue)"
    }
}
