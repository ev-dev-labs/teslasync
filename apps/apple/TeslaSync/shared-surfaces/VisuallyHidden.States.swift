//
//  VisuallyHidden.States.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  The P4 leaf-contract chrome composed by `VisuallyHidden` when the surface is not in its data
//  state — the loading skeleton (the mode cards as shimmer), the empty state (the mode catalog
//  with no announcement voiced yet), and the error tile with a retry affordance — plus the
//  freshness chip (P4 connectivity axis) and the recent-announcement log shown beneath the
//  catalog. Each keeps the surface's shape so it never collapses to a blank box. All copy
//  resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — three skeleton mode cards, so the surface keeps its shape while
/// the feed resolves.
struct VisuallyHiddenLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSCard {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 90, height: 10)
                        TSSkeleton(height: 14)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VisuallyHiddenStrings.string(
            "vh.loadingA11y", "Loading visually hidden content"
        )))
    }
}

// MARK: - Empty (resolved, no announcements voiced yet)

/// The empty render (resolved, nothing voiced yet) — the full mode catalog over a friendly
/// empty-state note, never a blank box. The live regions read as not-yet-written; the hidden
/// and focusable demonstrations render in full.
struct VisuallyHiddenEmptyView: View {
    let resolved: VisuallyHiddenResolved

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VisuallyHiddenDataView(resolved: resolved)
            TSCard {
                TSEmptyState(
                    title: LocalizedStringKey(VisuallyHiddenStrings.string(
                        "vh.empty", "No announcements yet"
                    )),
                    message: LocalizedStringKey(VisuallyHiddenStrings.string(
                        "vh.emptyMessage",
                        "Live-region content will appear here as the app voices announcements."
                    )),
                    systemImage: "speaker.wave.2"
                )
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct VisuallyHiddenErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: VisuallyHiddenStrings.string(
                    "vh.errorTitle", "Couldn't load announcements"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: VisuallyHiddenStrings.string("vh.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: VisuallyHiddenStrings.string("vh.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the body when the feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct VisuallyHiddenFreshnessChip: View {
    let connection: VisuallyHiddenConnection
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
        case .live: VisuallyHiddenStrings.string("vh.live", "Live")
        case .stale: VisuallyHiddenStrings.string("vh.stale", "Stale")
        case .offline: VisuallyHiddenStrings.string("vh.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            VisuallyHiddenStrings.string("vh.staleA11y", "Stale — tap to refresh")
        case .offline:
            VisuallyHiddenStrings.string("vh.offlineA11y", "Offline — showing last known announcements")
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

// MARK: - History row + section (recent announced messages)

/// One recent-announcement row — a priority dot, the message, and a relative timestamp. The
/// whole row is one VoiceOver element whose label reads the priority then the message.
struct VisuallyHiddenHistoryRow: View {
    let message: VisuallyHiddenMessage

    private var tone: Color {
        message.priority.isInterrupting ? Color.TS.statusWarning : Color.TS.statusInfo
    }

    private var priorityWord: String {
        message.priority.isInterrupting
            ? VisuallyHiddenStrings.string("vh.region.assertive", "Assertive")
            : VisuallyHiddenStrings.string("vh.region.polite", "Polite")
    }

    private var accessibilityLabelText: String {
        VisuallyHiddenAccessibility.historyLabel(priorityWord: priorityWord, message: message.text)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Circle().fill(tone).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(verbatim: message.text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            Text(message.timestamp, style: .relative)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}

/// The recent-announcement log — a titled card listing the most-recent rows, divider separated.
struct VisuallyHiddenHistorySection: View {
    let messages: [VisuallyHiddenMessage]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: VisuallyHiddenStrings.string("vh.history.title", "Recent announcements"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            TSCard {
                VStack(spacing: 0) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if index > 0 {
                            Divider().overlay(Color.TS.border)
                        }
                        VisuallyHiddenHistoryRow(message: message)
                            .padding(.vertical, TSSpacing.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
