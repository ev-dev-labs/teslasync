//
//  TimelineScrubber.Chrome.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The P4 leaf-contract chrome `TimelineScrubber` renders when the interactive track is not shown: the
//  loading skeleton track (shaped like the real track + thumb so the surface keeps its footprint while
//  the replay telemetry loads), the friendly empty state (no timeline to scrub — never a blank box),
//  and the error row with a retry affordance (web `QueryError` peer). Plus the orthogonal freshness
//  axis the web pure render has no concept of: a tappable chip + an inline banner shown when the feed
//  is stale / offline while the last timeline stays visible. All copy resolves through the P1/S10
//  facade; all color comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (replay telemetry resolving)

/// The initial-fetch chrome — a skeleton track + thumb matching the real scrubber's footprint, so the
/// surface keeps its shape while the page loads the drive's replay frames. Shimmer honors Reduce
/// Motion via the shared `TSSkeleton`.
struct TimelineScrubberLoadingTrack: View {
    var body: some View {
        ZStack(alignment: .leading) {
            TSSkeleton(height: 6, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 12, height: 12, cornerRadius: TSRadius.pill)
                .padding(.leading, 4)
        }
        .frame(height: 32)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: TimelineScrubberStrings.string(
            "timelineScrubber.loadingA11y", "Loading timeline"
        )))
    }
}

// MARK: - Empty (no timeline to scrub)

/// The friendly empty state — the drive resolved with no scrubable timeline (zero / unknown
/// duration), so rather than a dead track the surface shows a localized message.
struct TimelineScrubberEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(TimelineScrubberStrings.string(
                "timelineScrubber.empty.title", "Nothing to scrub"
            )),
            message: LocalizedStringKey(TimelineScrubberStrings.string(
                "timelineScrubber.empty.message", "This drive has no timeline to scrub through."
            )),
            systemImage: "play.slash"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityIdentifier("timelineScrubber-empty")
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error row with a retry affordance. The
/// message is the runtime failure reason, surfaced through the shared error display.
struct TimelineScrubberErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: message.isEmpty ? nil : LocalizedStringKey(message),
            onRetry: onRetry
        )
        .accessibilityIdentifier("timelineScrubber-error")
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the feed is not live — a colored dot + label, tappable to refresh.
struct TimelineScrubberFreshnessChip: View {
    let connection: TimelineScrubberConnection
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
        case .live: TimelineScrubberStrings.string("timelineScrubber.live", "Live")
        case .stale: TimelineScrubberStrings.string("timelineScrubber.stale", "Stale")
        case .offline: TimelineScrubberStrings.string("timelineScrubber.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: label
        case .stale: TimelineScrubberStrings.string("timelineScrubber.staleA11y", "Stale — tap to refresh")
        case .offline:
            TimelineScrubberStrings.string("timelineScrubber.offlineA11y", "Offline — showing the last position")
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
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Freshness banner (P4 connectivity axis)

/// The inline banner shown beneath the track when the feed is stale / offline — explains why the
/// timeline may be out of date while the last content stays interactive. Tappable to refresh.
struct TimelineScrubberFreshnessBanner: View {
    let connection: TimelineScrubberConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var icon: String {
        connection == .offline ? "wifi.slash" : "clock.arrow.circlepath"
    }

    private var message: String {
        switch connection {
        case .offline:
            TimelineScrubberStrings.string(
                "timelineScrubber.offlineBanner", "You're offline — showing the last cached timeline."
            )
        default:
            TimelineScrubberStrings.string(
                "timelineScrubber.staleBanner", "Showing a slightly out-of-date timeline."
            )
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tone)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(verbatim: TimelineScrubberStrings.string("timelineScrubber.refresh", "Refresh")))
    }
}
