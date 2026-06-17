//
//  MediaPlayerHistoryTable.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple) — Playback history
//
//  The playback-history panel (web GlassPanel 9 / `DataTable`): a sortable header
//  row (Time · Track · Artist · Source · Volume · Status) over the newest-first
//  reading rows, with a record-count badge. The Volume cell shows
//  `volume / max`; the Status cell shows the Playing / Paused / Stopped badge.
//  Loading shows a redacted skeleton; an empty window shows a
//  `ContentUnavailableView` — never a blank region.
//

import SwiftUI

// MARK: - Sort model (web tableSortKey / tableSortDir)

/// The sortable columns (web column `key`s).
enum MediaHistorySortKey: String, CaseIterable, Identifiable, Equatable {
    case time
    case track
    case artist
    case source
    case volume
    case status

    var id: String { rawValue }

    /// Localized column header (web `Column.header`).
    var header: String {
        switch self {
        case .time: return String(localized: "translation.Time", defaultValue: "Time")
        case .track: return String(localized: "translation.Track", defaultValue: "Track")
        case .artist: return String(localized: "translation.Artist", defaultValue: "Artist")
        case .source: return String(localized: "translation.Source", defaultValue: "Source")
        case .volume: return String(localized: "translation.Volume", defaultValue: "Volume")
        case .status: return String(localized: "translation.Status", defaultValue: "Status")
        }
    }
}

// MARK: - GlassPanel 9 — Playback history panel

/// The playback-history panel (web GlassPanel 9): header (icon + title +
/// record-count badge) over the table, a skeleton while reloading, and the
/// period-empty state when the window holds no readings.
struct MediaPlaybackHistoryPanel: View {
    let rows: [MediaPlayerSnapshot]
    let isLoading: Bool

    var body: some View {
        MediaPlayerCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if isLoading {
                    tableSkeleton
                } else if rows.isEmpty {
                    emptyState
                } else {
                    MediaPlaybackHistoryTable(rows: rows)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "music.note.list")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(String(localized: "translation.Playback History", defaultValue: "Playback History"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            recordsBadge
        }
    }

    /// Web `{filtered.length} {t('records')}` neutral badge.
    private var recordsBadge: some View {
        let records = String(localized: "translation.records", defaultValue: "records")
        return Text("\(rows.count) \(records)")
            .font(Font.TS.label)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.textMuted.opacity(0.12), in: Capsule())
            .accessibilityLabel(Text("\(rows.count) \(records)"))
    }

    /// Period-specific empty state (web `No playback history for this period`).
    private var emptyState: some View {
        ContentUnavailableView(
            String(
                localized: "translation.No playback history for this period",
                defaultValue: "No playback history for this period"
            ),
            systemImage: "music.note"
        )
        .frame(maxWidth: .infinity)
    }

    private var tableSkeleton: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 6, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.sm)
                    .fill(Color.TS.surface)
                    .frame(height: 28)
            }
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the table loading state
    }
}

// MARK: - The sortable table (web `DataTable`)

/// The reusable sortable table (web `DataTable`). Holds its own sort state
/// (web `tableSortKey` / `tableSortDir`, default `time` desc) and renders the
/// `No playback history` empty message when handed no rows — the faithful peer of
/// the web `DataTable emptyMessage` prop.
struct MediaPlaybackHistoryTable: View {
    let rows: [MediaPlayerSnapshot]

    @State private var sortKey: MediaHistorySortKey = .time
    @State private var sortAscending = false

    private var sortedRows: [MediaPlayerSnapshot] {
        rows.sorted(by: comparator)
    }

    var body: some View {
        if sortedRows.isEmpty {
            ContentUnavailableView(
                String(localized: "translation.No playback history", defaultValue: "No playback history"),
                systemImage: "music.note"
            )
            .frame(maxWidth: .infinity)
        } else {
            ScrollView(.horizontal, showsIndicators: true) {
                table
            }
        }
    }

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.xl, verticalSpacing: TSSpacing.sm) {
            GridRow {
                ForEach(MediaHistorySortKey.allCases) { key in
                    headerButton(key)
                }
            }
            Divider().gridCellColumns(MediaHistorySortKey.allCases.count)
            ForEach(sortedRows) { row in
                GridRow {
                    timeCell(row)
                    trackCell(row)
                    artistCell(row)
                    sourceCell(row)
                    volumeCell(row)
                    statusCell(row)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }

    // MARK: Header

    private func headerButton(_ key: MediaHistorySortKey) -> some View {
        Button {
            toggleSort(key)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(key.header)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                if sortKey == key {
                    Image(systemName: sortAscending ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color.TS.accent)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(key.header))
        .sortHeaderTrait(active: sortKey == key)
    }

    private func toggleSort(_ key: MediaHistorySortKey) {
        if key == sortKey {
            sortAscending.toggle()
        } else {
            sortKey = key
            sortAscending = false
        }
    }

    // MARK: Cells

    private func timeCell(_ row: MediaPlayerSnapshot) -> some View {
        Text(MediaPlayerFormat.dateTime(row.createdAt))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
    }

    private func trackCell(_ row: MediaPlayerSnapshot) -> some View {
        Text(row.nowPlayingTitle.flatMap { $0.isEmpty ? nil : $0 } ?? "—")
            .font(Font.TS.bodySm)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .frame(maxWidth: 220, alignment: .leading)
    }

    private func artistCell(_ row: MediaPlayerSnapshot) -> some View {
        Text(row.nowPlayingArtist.flatMap { $0.isEmpty ? nil : $0 } ?? "—")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .frame(maxWidth: 180, alignment: .leading)
    }

    private func sourceCell(_ row: MediaPlayerSnapshot) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if let source = row.playbackSource, !source.isEmpty {
                Image(systemName: row.sourceKind.symbol)
                    .font(Font.TS.caption)
                    .foregroundStyle(row.sourceKind.color)
                    .accessibilityHidden(true)
                Text(source)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            } else {
                Text(verbatim: "—")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    private func volumeCell(_ row: MediaPlayerSnapshot) -> some View {
        Text(volumeText(row))
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.accent)
    }

    private func statusCell(_ row: MediaPlayerSnapshot) -> some View {
        MediaPlayerStatusBadge(
            text: row.playbackState.label,
            tone: row.playbackState.tone
        )
    }

    private func volumeText(_ row: MediaPlayerSnapshot) -> String {
        let volume = row.audioVolume.map { MediaPlayerFormat.number($0) } ?? "—"
        let maximum = row.audioVolumeMax.map { MediaPlayerFormat.number($0) } ?? "—"
        return "\(volume)/\(maximum)"
    }

    // MARK: Sorting

    private func comparator(_ lhs: MediaPlayerSnapshot, _ rhs: MediaPlayerSnapshot) -> Bool {
        let ascending = sortAscending
        switch sortKey {
        case .time:
            return ascending ? lhs.createdAt < rhs.createdAt : lhs.createdAt > rhs.createdAt
        case .volume:
            let left = lhs.audioVolume ?? 0
            let right = rhs.audioVolume ?? 0
            return ascending ? left < right : left > right
        case .track:
            return compareStrings(lhs.nowPlayingTitle, rhs.nowPlayingTitle, ascending: ascending)
        case .artist:
            return compareStrings(lhs.nowPlayingArtist, rhs.nowPlayingArtist, ascending: ascending)
        case .source:
            return compareStrings(lhs.playbackSource, rhs.playbackSource, ascending: ascending)
        case .status:
            return compareStrings(lhs.playbackStatus, rhs.playbackStatus, ascending: ascending)
        }
    }

    private func compareStrings(_ lhs: String?, _ rhs: String?, ascending: Bool) -> Bool {
        let left = lhs ?? ""
        let right = rhs ?? ""
        let order = left.localizedCaseInsensitiveCompare(right)
        return ascending ? order == .orderedAscending : order == .orderedDescending
    }
}

// MARK: - Accessibility helper

private extension View {
    /// Adds the `.isSelected` trait when a header is the active sort column.
    @ViewBuilder
    func sortHeaderTrait(active: Bool) -> some View {
        if active {
            accessibilityAddTraits(.isSelected)
        } else {
            self
        }
    }
}
