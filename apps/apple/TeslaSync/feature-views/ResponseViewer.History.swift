//
//  ResponseViewer.History.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The recent-requests strip (web `RequestHistory`): a horizontally scrolling
//  row of replayable request chips inside a glass panel. Renders nothing when
//  the history is empty (web `if (history.length === 0) return null`).
//

import SwiftUI

// MARK: - History strip (web `RequestHistory`)

/// The recent-requests strip. Each chip replays its entry via `onReplay`.
struct RequestHistorySection: View {
    let history: [HistoryEntry]
    let onReplay: (HistoryEntry) -> Void

    var body: some View {
        if !history.isEmpty {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: ResponseViewerStrings.string("playground.history", "Recent Requests"))
                        .font(Font.TS.label)
                        .textCase(.uppercase)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityAddTraits(.isHeader)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: TSSpacing.sm) {
                            ForEach(Array(history.enumerated()), id: \.offset) { _, entry in
                                RequestHistoryChip(projection: HistoryEntryProjection.make(from: entry)) {
                                    onReplay(entry)
                                }
                            }
                        }
                        .padding(.bottom, TSSpacing.xs)
                    }
                }
            }
        }
    }
}

// MARK: - History chip (web replay button)

/// One replayable request chip: a method tag, a truncated path, the status
/// code, and the duration. The combined VoiceOver label mirrors the web chip
/// `title` (`"{method} {path} → {status} ({ms}ms)"`).
struct RequestHistoryChip: View {
    let projection: HistoryEntryProjection
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                methodTag
                Text(verbatim: projection.path)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 140, alignment: .leading)
                Text(verbatim: "\(projection.statusCode)")
                    .font(.system(.caption2, design: .monospaced).weight(.bold))
                    .foregroundStyle(projection.statusClass.tone)
                Text(verbatim: projection.durationLabel)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }

    private var methodTag: some View {
        Text(verbatim: projection.method)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(projection.methodTone.color)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(
                projection.methodTone.chipBackground,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
    }
}
