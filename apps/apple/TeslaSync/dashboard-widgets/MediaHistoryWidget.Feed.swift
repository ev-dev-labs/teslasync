//
//  MediaHistoryWidget.Feed.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  The surface's internal composition: the compact single-track row (web
//  CompactView), the scrollable event feed (web WidgetEventFeed), one feed row
//  (web TimelineItem), and the shared empty state (web EmptyState). Built over
//  the shared design tokens — no exported view but `MediaHistoryWidget` itself.
//

import SwiftUI

// MARK: - Empty state (web EmptyState — "No tracks played")

/// The full-size "no tracks" empty view, shared by the surface's empty phase
/// and the feed's defensive empty branch (never a blank panel).
struct MediaEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                MediaHistoryStrings.text("widget.noMediaPlayed", "No tracks played")
            } icon: {
                Image(systemName: "music.note.list")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Compact (1×2) — web CompactView

/// The single-line "now/last played" row shown at `cols <= 1`. Falls back to an
/// inline empty row when there is no real track (web `title !== '—'`).
struct MediaCompactView: View {
    let track: MediaTrack?

    var body: some View {
        if let track, track.hasTrack {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "music.note")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: track.titleLine)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: MediaHistoryAccessibility.rowLabel(for: track)))
        } else {
            MediaCompactEmptyRow()
        }
    }
}

/// The inline empty row used by the compact layout (the compact analogue of the
/// web `EmptyState`, sized to the single-row chrome).
private struct MediaCompactEmptyRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "music.note.list")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            MediaHistoryStrings.text("widget.noMediaPlayed", "No tracks played")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Feed (≥2 cols) — web WidgetEventFeed

/// The scrollable recently-played feed. Rows are already sorted newest-first and
/// capped by the model; an empty list still renders the shared empty state.
struct MediaFeedView: View {
    let tracks: [MediaTrack]

    var body: some View {
        if tracks.isEmpty {
            MediaEmptyState()
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(tracks.enumerated()), id: \.element.id) { offset, track in
                        MediaFeedRow(track: track, isLast: offset == tracks.count - 1)
                    }
                }
            }
        }
    }
}

// MARK: - Feed row — web TimelineItem

/// One feed entry: a playback-tinted music marker on a connected timeline rail,
/// the "{title} — {artist}" line, an optional source label, and a relative time.
struct MediaFeedRow: View {
    let track: MediaTrack
    var isLast = false

    private var tone: TSTone {
        track.isPlaying ? .success : .neutral
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            rail
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    Text(verbatim: track.titleLine)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: relativeLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .layoutPriority(1)
                }
                if let source = track.sourceLabel {
                    Text(verbatim: source)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.md)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MediaHistoryAccessibility.rowLabel(for: track)))
    }

    private var rail: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle().fill(tone.color.opacity(0.15)).frame(width: 24, height: 24)
                Image(systemName: "music.note")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tone.color)
            }
            if !isLast {
                Rectangle().fill(Color.TS.border).frame(width: 2).frame(maxHeight: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    private var relativeLabel: String {
        MediaHistoryStrings.relativeTimeLabel(MediaHistoryBuilder.relativeTime(for: track.timestamp))
    }
}
