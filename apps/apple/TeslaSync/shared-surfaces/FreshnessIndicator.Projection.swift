//
//  FreshnessIndicator.Projection.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web composition (a status dot + relative-time label sized off a `timestamp`) wrapped in the P4
//  leaf contract (loading / unavailable chrome around the resolved readout). The view is a pure
//  function of this value; every branch is unit tested.
//

import Foundation

// MARK: - Source inputs (P1/S8 — the timestamp feed + its fetch lifecycle)

/// The resolution state of the timestamp feed backing the surface — the native shape of the
/// `useIsStale`/timestamp source lifecycle. `loading` shows skeleton chrome, `failed` shows the
/// retry chrome, and `resolved` lets the age decide the dot + label (a resolved-but-`nil` timestamp
/// is the "unknown"/empty readout, never a blank box).
public enum FreshnessFetchStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

/// One coalesced snapshot of the surface's inputs — the fetch lifecycle state plus the datum's
/// ISO-8601 timestamp (the web `timestamp` prop). The view binds the model over this; the resolved
/// readout is a pure function of it plus the static config and "now".
public struct FreshnessInput: Sendable, Equatable {
    public var status: FreshnessFetchStatus
    public var timestamp: String?

    public init(status: FreshnessFetchStatus = .loading, timestamp: String? = nil) {
        self.status = status
        self.timestamp = timestamp
    }
}

// MARK: - Static configuration (web non-data props)

/// The static presentation config — the web props that are not data: the age thresholds
/// (`staleThreshold`/`offlineThreshold`), whether to render the relative-time label (`showLabel`),
/// and the size variant (`size`). Defaults mirror the web defaults (120 / 600 / shown / small).
public struct FreshnessConfig: Sendable, Equatable {
    public var thresholds: FreshnessThresholds
    public var showLabel: Bool
    public var size: FreshnessSize

    public init(
        thresholds: FreshnessThresholds = .default,
        showLabel: Bool = true,
        size: FreshnessSize = .small
    ) {
        self.thresholds = thresholds
        self.showLabel = showLabel
        self.size = size
    }

    public static let `default` = FreshnessConfig()
}

// MARK: - Resolved view-state (web render output + P4 leaf contract)

/// The resolved relative-time readout — the status band, the localised relative-time label, and the
/// raw timestamp (carried for the pointer tooltip, the web `title`).
public struct FreshnessReadout: Sendable, Equatable {
    public let status: FreshnessStatus
    public let ageLabel: String
    public let timestamp: String?

    public init(status: FreshnessStatus, ageLabel: String, timestamp: String?) {
        self.status = status
        self.ageLabel = ageLabel
        self.timestamp = timestamp
    }
}

/// The resolved, view-ready state — `phase` selects the rendered body while `stale` carries the
/// `useIsStale` verdict (always computed, so a host banner can read it regardless of phase).
public struct FreshnessResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Timestamp feed still resolving (web parent has no value yet) → skeleton chrome.
        case loading
        /// Timestamp feed failed → a neutral retry chip (the `QueryError` peer).
        case unavailable
        /// Feed resolved → the dot + relative-time label (the unknown status is the empty readout).
        case ready(FreshnessReadout)
    }

    public let phase: Phase
    public let stale: FreshnessStaleReadout

    public init(phase: Phase, stale: FreshnessStaleReadout) {
        self.phase = phase
        self.stale = stale
    }

    /// The resolved status when the surface is presenting a readout, else `nil` — a convenience the
    /// model uses to detect the fresh→stale transition that arms the one-shot auto-refresh.
    public var readyStatus: FreshnessStatus? {
        if case let .ready(readout) = phase { return readout.status }
        return nil
    }
}

// MARK: - Projection (input + config + clock → resolved)

/// Pure projection from the input snapshot to the resolved view-state. The fetch status decides the
/// phase; when resolved, the age (computed from the timestamp against "now") decides the dot status
/// and the relative-time label. The `useIsStale` verdict is computed in every phase so the model can
/// surface it unconditionally.
public enum FreshnessProjection {
    public static func resolve(
        _ input: FreshnessInput,
        config: FreshnessConfig,
        now: Date,
        strings: FreshnessResolve
    ) -> FreshnessResolved {
        let age = FreshnessAge.seconds(of: input.timestamp, now: now)
        let stale = FreshnessStaleEvaluator.evaluate(age: age, thresholds: config.thresholds, strings: strings)

        let phase: FreshnessResolved.Phase = switch input.status {
        case .loading:
            .loading
        case .failed:
            .unavailable
        case .resolved:
            .ready(FreshnessReadout(
                status: FreshnessStatusResolver.status(age: age, thresholds: config.thresholds),
                ageLabel: FreshnessAgeFormatter.label(age: age, strings: strings),
                timestamp: input.timestamp
            ))
        }

        return FreshnessResolved(phase: phase, stale: stale)
    }
}
