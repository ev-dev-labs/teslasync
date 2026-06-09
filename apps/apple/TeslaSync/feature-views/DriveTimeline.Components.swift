//
//  DriveTimeline.Components.swift
//  TeslaSync — P4 feature view · 0140 · DriveTimeline (Apple)
//
//  The Apple-idiomatic view pieces the surface composes: the timeline content (the
//  web start-flag / duration / end-flag row + the emerald→cyan progress bar), the
//  freshness + refresh accessory, the empty / error / offline states (web
//  `EmptyState` / `QueryError`), and the loading skeleton. All strings resolve
//  through the P1/S10 facade; all colors / spacing come from the P1/S9 tokens. The
//  surface shell lives in `DriveTimeline.swift`.
//

import SwiftUI

// MARK: - Localization facade SwiftUI helper (web `t(key, default)`)

extension DriveTimelineStrings {
    /// `Text` for a per-surface key with the web English fallback (kept here so the
    /// Foundation facade in `DriveTimeline.Model.swift` stays SwiftUI-free).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Palette (web Tailwind stops with no exact design token)

/// The one web gradient stop without an exact design-system token. The emerald start
/// maps to `Color.TS.statusSuccess` (an EXACT match for Tailwind `emerald-500`
/// `#10b981`); the cyan end is Tailwind `cyan-400` `#22d3ee`, kept as a verbatim sRGB
/// value so the bar reproduces the web `from-emerald-500 to-cyan-400` gradient.
enum DriveTimelinePalette {
    static let cyan400 = Color(.sRGB, red: 0.133, green: 0.827, blue: 0.933, opacity: 1)
}

// MARK: - Timeline content (web start-flag / duration / end-flag row + progress bar)

/// The content timeline — a faithful port of the web composition: a `text-xs`
/// space-between row of [green start flag + start time] · [muted duration] · [red end
/// flag + end time / "In progress"], above the full-width emerald→cyan progress bar.
/// The whole element is a single VoiceOver group reading the combined drive summary.
struct DriveTimelineContent: View {
    let projection: DriveTimelineProjection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                flag(projection.startText, tone: .success)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: projection.durationText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                flag(projection.endText, tone: .danger)
            }
            DriveTimelineBar()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DriveTimelineAccessibility.summary(for: projection)))
    }

    /// One flag span: the web `<Flag className="h-3 w-3" />{time}` with its semantic
    /// tone (green start / red end). The icon is decorative — the combined group
    /// label carries the spoken content.
    private func flag(_ value: String, tone: TSTone) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "flag.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: value)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .font(Font.TS.caption)
        .foregroundStyle(tone.color)
    }
}

/// The full-width drive progress bar (web `h-3 rounded-full … from-emerald-500
/// to-cyan-400`). Decorative — hidden from VoiceOver since the timeline group already
/// speaks the drive span.
struct DriveTimelineBar: View {
    var body: some View {
        Capsule(style: .continuous)
            .fill(
                LinearGradient(
                    colors: [Color.TS.statusSuccess, DriveTimelinePalette.cyan400],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: 12)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip + status accessory (live / stale / offline)

/// Corner chip flagging live / stale / offline data (web freshness indicator).
struct DriveTimelineFreshnessChip: View {
    let freshness: DriveTimelineFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: DriveTimelineStrings.string("driveDetail.timeline.live", "Live")
        case .stale: DriveTimelineStrings.string("driveDetail.timeline.stale", "Stale")
        case .offline: DriveTimelineStrings.string("driveDetail.timeline.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Freshness chip + an in-flight spinner + a refresh control (web refetch).
struct DriveTimelineStatusAccessory: View {
    let freshness: DriveTimelineFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            DriveTimelineFreshnessChip(freshness: freshness)
            if refreshing {
                ProgressView().controlSize(.mini)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(DriveTimelineStrings.text("driveDetail.timeline.refresh", "Refresh"))
        }
    }
}

// MARK: - Retry affordance (web `QueryError` retry button)

/// Capsule retry button shared by the error + offline states.
struct DriveTimelineRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            DriveTimelineStrings.text("driveDetail.timeline.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(DriveTimelineStrings.text("driveDetail.timeline.retry", "Retry"))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The in-place empty state (no drive resolved). Built over `ContentUnavailableView`
/// with facade `Text` so the copy resolves with its English fallback.
struct DriveTimelineEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DriveTimelineStrings.text("driveDetail.timeline.empty.title", "No drive timeline")
            } icon: {
                Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
            }
        } description: {
            DriveTimelineStrings.text(
                "driveDetail.timeline.empty.message",
                "Select a drive to see its start, duration, and finish."
            )
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}

// MARK: - Error + offline states

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct DriveTimelineErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            DriveTimelineStrings.text("driveDetail.timeline.errorTitle", "Couldn't load drive timeline")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if retryable {
                DriveTimelineRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state (web offline fallback) with retry.
struct DriveTimelineOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
            DriveTimelineStrings.text(
                "driveDetail.timeline.offlineMessage",
                "Offline — showing last known drive timeline"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            DriveTimelineRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web `Skeleton`)

/// Skeleton chrome shown during the initial fetch (web `Skeleton`); reproduces the
/// timeline shape (a label row + the progress bar) and labels itself "Loading drive
/// timeline…" for VoiceOver.
struct DriveTimelineLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 60, height: 12, cornerRadius: TSRadius.sm)
                Spacer(minLength: TSSpacing.sm)
                TSSkeleton(width: 44, height: 12, cornerRadius: TSRadius.sm)
                Spacer(minLength: TSSpacing.sm)
                TSSkeleton(width: 60, height: 12, cornerRadius: TSRadius.sm)
            }
            TSSkeleton(height: 12, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(DriveTimelineStrings.text("driveDetail.timeline.loading", "Loading drive timeline…"))
    }
}
