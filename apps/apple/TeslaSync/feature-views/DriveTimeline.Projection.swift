//
//  DriveTimeline.Projection.swift
//  TeslaSync — P4 feature view · 0140 · DriveTimeline (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's per-element
//  rendering: `formatTime(startTs)`, `formatDuration(durationS / 60)`, and the
//  `endTs ? formatTime(endTs) : t('driveDetail.inProgress')` fork) plus the per-state
//  presentation resolver. Pure value logic — no SwiftUI, no networking — so every
//  render branch is unit-testable. Mirrors
//  features/driving/components/drive-detail/DriveTimeline.tsx and its
//  drive-detail/helpers.ts `formatDuration`.
//

import Foundation

// MARK: - Formatting (ports of web lib/dateFormat.ts + drive-detail/helpers.ts)

/// The time + duration formatting the web timeline renders, ported verbatim so the
/// native projection produces the same strings. Pure + locale/zone-injectable for
/// deterministic tests.
public enum DriveTimelineFormat {
    /// The em-dash the web `formatTime` returns for a missing / invalid instant
    /// (`if (!iso) return '—'`).
    public static let emDash = "—"

    /// `formatTime(iso)` — locale-aware wall-clock time (web
    /// `toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })`). A nil
    /// instant collapses to the em-dash. Uses the short time style, the idiomatic
    /// locale-aware equivalent of the web's 2-digit hour/minute template.
    public static func time(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// `formatDuration(min)` from drive-detail/helpers.ts, fed the web's
    /// `drive.durationS / 60` (seconds → minutes). Reproduces the exact arithmetic:
    /// `h = floor(min / 60)`, `m = round(min % 60)`, then `h > 0 ? "{h}h {m}m" :
    /// "{m}m"`. The unit tokens resolve through the P1/S10 catalog (native chrome)
    /// rather than the web's hardcoded `h`/`m` literals.
    public static func duration(seconds: Double, locale _: Locale = .current) -> String {
        let safeSeconds = seconds.isFinite ? seconds : 0
        let minutes = safeSeconds / 60.0
        let hours = Int((minutes / 60.0).rounded(.down))
        let remainder = minutes.truncatingRemainder(dividingBy: 60)
        let mins = Int(remainder.rounded())
        if hours > 0 {
            return DriveTimelineStrings.format(
                "driveDetail.timeline.durationHM",
                "{{hours}}h {{minutes}}m",
                ["hours": "\(hours)", "minutes": "\(mins)"]
            )
        }
        return DriveTimelineStrings.format(
            "driveDetail.timeline.durationM",
            "{{minutes}}m",
            ["minutes": "\(mins)"]
        )
    }
}

// MARK: - Projection output value type

/// The fully-resolved render model for the content timeline (web's three spans + the
/// progress bar). Pure value type so the formatting is unit-tested without rendering
/// the view.
public struct DriveTimelineProjection: Equatable, Sendable {
    /// `formatTime(drive.startTs)` — the green start-flag label.
    public let startText: String
    /// `formatDuration(drive.durationS / 60)` — the muted middle label.
    public let durationText: String
    /// `drive.endTs ? formatTime(drive.endTs) : t('driveDetail.inProgress')` — the
    /// red end-flag label, already resolved to the localized "In progress" copy when
    /// the drive is still running.
    public let endText: String
    /// Whether the drive is still running (web `drive.endTs == null`). Drives the
    /// end-flag tone + the accessibility phrasing.
    public let isInProgress: Bool

    public init(startText: String, durationText: String, endText: String, isInProgress: Bool) {
        self.startText = startText
        self.durationText = durationText
        self.endText = endText
        self.isInProgress = isInProgress
    }
}

// MARK: - Projection build (cached → projection)

public extension DriveTimelineProjection {
    /// Builds the projection from the cached drive, reproducing the web render: the
    /// start time, the `durationS / 60` duration, and the end time / "In progress"
    /// fork. The "In progress" copy resolves through the source's single i18n key
    /// `driveDetail.inProgress`.
    static func make(
        from drive: DriveTimelineDrive,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> DriveTimelineProjection {
        let endText = drive.isInProgress
            ? DriveTimelineStrings.string("driveDetail.inProgress", "In progress")
            : DriveTimelineFormat.time(drive.endTs, locale: locale, timeZone: timeZone)
        return DriveTimelineProjection(
            startText: DriveTimelineFormat.time(drive.startTs, locale: locale, timeZone: timeZone),
            durationText: DriveTimelineFormat.duration(seconds: drive.durationS, locale: locale),
            endText: endText,
            isInProgress: drive.isInProgress
        )
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the corner chip (web freshness indicator). The web leaf
/// has no freshness UI; this is the native chrome the P4 auto-refreshing-surface
/// contract requires, layered so cached values stay visible.
public enum DriveTimelineFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content). The
/// web leaf only ever renders content (the parent page owns loading / error / empty);
/// this superset adds the prompt's required chrome while keeping a cached drive on
/// screen behind a refresh or transient failure.
public enum DriveTimelinePresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(DriveTimelineProjection, freshness: DriveTimelineFreshness, refreshing: Bool)
}

public extension DriveTimelinePresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a render-ready
    /// presentation. Keeps any cached drive visible behind a refresh / error; a
    /// resolved-but-absent drive becomes the friendly empty state.
    static func resolve(
        state: DriveTimelineLoadState<DriveTimelineDrive>,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> DriveTimelinePresentation {
        func project(_ drive: DriveTimelineDrive) -> DriveTimelineProjection {
            DriveTimelineProjection.make(from: drive, locale: locale, timeZone: timeZone)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(drive, stale):
            return .content(project(drive), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, project: project)
        }
    }

    private static func resolveFailure(
        _ error: DriveTimelineError,
        cached: DriveTimelineDrive?,
        stale: Bool,
        project: (DriveTimelineDrive) -> DriveTimelineProjection
    ) -> DriveTimelinePresentation {
        if error == .offline {
            guard let cached else { return .offlineNoData }
            return .content(project(cached), freshness: .offline, refreshing: false)
        }
        if let cached {
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
        }
        return .error(retryable: error.isRetryable)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver content spoken for the timeline. Pure + public so the a11y
/// summary can be unit-tested without rendering the view.
public enum DriveTimelineAccessibility {
    /// The combined VoiceOver phrase for the timeline. A completed drive reads
    /// "Drive from {start} to {end}, duration {duration}"; an in-progress drive reads
    /// "Drive started {start}, in progress, {duration} so far". Pure string assembly
    /// over the localized templates.
    public static func summary(for projection: DriveTimelineProjection) -> String {
        if projection.isInProgress {
            return DriveTimelineStrings.format(
                "driveDetail.timeline.a11y.inProgress",
                "Drive started {{start}}, in progress, {{duration}} so far",
                ["start": projection.startText, "duration": projection.durationText]
            )
        }
        return DriveTimelineStrings.format(
            "driveDetail.timeline.a11y.completed",
            "Drive from {{start}} to {{end}}, duration {{duration}}",
            ["start": projection.startText, "end": projection.endText, "duration": projection.durationText]
        )
    }
}
