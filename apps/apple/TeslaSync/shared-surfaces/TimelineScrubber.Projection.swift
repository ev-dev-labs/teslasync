//
//  TimelineScrubber.Projection.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The pure projection from the input snapshot to the resolved, view-ready state — the native port of
//  the web `TimelineScrubber` render. The web component is a controlled presentational track that
//  always renders; the native parity keeps that as the `content` phase and layers the P4 leaf contract
//  the web pure render has no concept of: a loading skeleton track, a friendly "nothing to scrub"
//  empty state (zero / unknown duration), an error row with retry, and the orthogonal freshness axis.
//  Precedence mirrors the leaf contract: error > loading > empty(no timeline) > content. Everything
//  here is deterministic, so every render branch is asserted without a view.
//

import Foundation

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the body region; the track fields are always
/// carried so the surface keeps its frame across phases (the loading / empty / error chrome simply
/// replaces the interactive track).
public struct TimelineScrubberResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Replay telemetry still loading → a skeleton track.
        case loading
        /// No timeline to scrub (zero / unknown duration) → a friendly empty state.
        case empty
        /// Feed failure → an error row with a retry affordance (web `QueryError` peer).
        case error(String)
        /// The web happy path — the interactive scrubber track.
        case content
    }

    public let phase: Phase
    /// The clamped 0…1 playhead position (web `clampedProgress`).
    public let progress: Double
    /// The clamped 0…1 buffered position, or `nil` when unset (web `clampedBuffered`).
    public let buffered: Double?
    /// The drive duration in seconds (web `duration`) — drives the spoken value text.
    public let durationSeconds: Double
    /// The keyframe markers, each with a clamped position.
    public let markers: [TimelineScrubberMarker]
    public let connection: TimelineScrubberConnection
    /// The spoken scrubber value ("m:ss" or "NN%"), always present so VoiceOver never reads nothing.
    public let scrubberValueText: String
    /// The numeric `aria-valuenow` percent (web `Math.round(clampedProgress * 100)`).
    public let progressPercent: Int

    public var isContent: Bool {
        phase == .content
    }

    public init(
        phase: Phase,
        progress: Double,
        buffered: Double?,
        durationSeconds: Double,
        markers: [TimelineScrubberMarker],
        connection: TimelineScrubberConnection,
        scrubberValueText: String,
        progressPercent: Int
    ) {
        self.phase = phase
        self.progress = progress
        self.buffered = buffered
        self.durationSeconds = durationSeconds
        self.markers = markers
        self.connection = connection
        self.scrubberValueText = scrubberValueText
        self.progressPercent = progressPercent
    }

    /// A neutral chrome state used before any host snapshot arrives (loading track, live connection).
    static func chrome(phase: Phase) -> TimelineScrubberResolved {
        TimelineScrubberResolved(
            phase: phase,
            progress: 0,
            buffered: nil,
            durationSeconds: 0,
            markers: [],
            connection: .live,
            scrubberValueText: "0%",
            progressPercent: 0
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. Unit tested across the leaf
/// contract precedence and the derived clamped positions / spoken value text.
public enum TimelineScrubberProjection {
    public static func resolve(_ input: TimelineScrubberInput) -> TimelineScrubberResolved {
        let progress = TimelineScrubberAdapter.clamp01(input.progress)
        let buffered = input.buffered.map(TimelineScrubberAdapter.clamp01)
        return TimelineScrubberResolved(
            phase: phase(for: input),
            progress: progress,
            buffered: buffered,
            durationSeconds: input.durationSeconds,
            markers: input.markers,
            connection: input.connection,
            scrubberValueText: TimelineScrubberAccessibility.scrubberValue(
                durationSeconds: input.durationSeconds,
                progress: progress
            ),
            progressPercent: TimelineScrubberAdapter.percent(progress)
        )
    }

    /// The leaf-contract precedence: error > loading > empty(no timeline) > content.
    static func phase(for input: TimelineScrubberInput) -> TimelineScrubberResolved.Phase {
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        if input.isLoading {
            return .loading
        }
        if !input.durationSeconds.isFinite || input.durationSeconds <= 0 {
            return .empty
        }
        return .content
    }
}
