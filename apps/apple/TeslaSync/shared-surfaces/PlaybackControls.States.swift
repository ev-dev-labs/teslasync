//
//  PlaybackControls.States.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The P4 leaf-contract chrome `PlaybackControls` renders when the transport row is not interactive:
//  the loading skeleton bar (a transport row shaped like the real one while the replay telemetry
//  loads), the friendly empty state (no timeline to replay — never a blank box), and the error row
//  with a retry affordance (web `QueryError` peer). All copy resolves through the P1/S10 facade; all
//  color comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (replay telemetry resolving)

/// The initial-fetch chrome — skeleton transport controls + a skeleton track matching the real bar's
/// footprint, so the surface keeps its shape while the page loads the drive's replay frames. The
/// shimmer honors Reduce Motion via the shared `TSSkeleton`.
struct PlaybackControlsLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(width: 32, height: 32, cornerRadius: TSRadius.sm)
            }
            TSSkeleton(width: 44, height: 32, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 6, cornerRadius: TSRadius.pill)
                .frame(maxWidth: .infinity)
            TSSkeleton(width: 76, height: 12)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: PlaybackControlsStrings.string(
            "replay.loadingA11y", "Loading replay"
        )))
    }
}

// MARK: - Empty (no timeline to replay)

/// The friendly empty state — the drive resolved with no replayable timeline (zero / unknown
/// duration), so rather than a dead transport bar the surface shows a localized message.
struct PlaybackControlsEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(PlaybackControlsStrings.string(
                "replay.empty.title", "Nothing to replay"
            )),
            message: LocalizedStringKey(PlaybackControlsStrings.string(
                "replay.empty.message", "This drive has no timeline to play back."
            )),
            systemImage: "play.slash"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityIdentifier("playbackControls-empty")
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error row with a retry affordance. The
/// message is the runtime failure reason, surfaced through the shared error display.
struct PlaybackControlsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: message.isEmpty ? nil : LocalizedStringKey(message),
            onRetry: onRetry
        )
        .accessibilityIdentifier("playbackControls-error")
    }
}
