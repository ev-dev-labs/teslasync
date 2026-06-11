//
//  PlaybackControls.Projection.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The pure projection from the input snapshot to the resolved, view-ready state, plus the
//  accessibility-label builders — split from the store for the lint length budget. Everything here is
//  deterministic and resolves its copy through the injected `PlaybackControlsResolve` seam (P1/S10),
//  so every render branch is asserted without a view or a bundle.
//
//  The web `PlaybackControls` is a controlled presentational bar that always renders the transport
//  row; the native parity keeps that as the `content` phase and layers the P4 leaf contract the web
//  pure render has no concept of: a loading skeleton bar, a friendly "nothing to replay" empty state,
//  an error row with retry, and the orthogonal freshness axis. Precedence mirrors the leaf contract:
//  error > loading > empty(no timeline) > content.
//

import Foundation

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the body region; the playback fields are always
/// carried so the bar keeps its frame across phases (the loading / empty / error chrome simply
/// replaces the interactive row).
public struct PlaybackControlsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Replay telemetry still loading → a skeleton transport bar.
        case loading
        /// No timeline to replay (zero / unknown duration) → a friendly empty state.
        case empty
        /// Feed failure → an error row with a retry affordance (web `QueryError` peer).
        case error(String)
        /// The web happy path — the interactive transport bar.
        case content
    }

    public let phase: Phase
    public let isPlaying: Bool
    public let speed: PlaybackControlsSpeed
    public let progress: Double
    public let elapsed: String
    public let total: String
    public let durationMs: Double?
    public let markers: [PlaybackControlsMarker]
    public let enableKeyboardShortcuts: Bool
    public let connection: PlaybackControlsConnection
    /// The combined "elapsed / total" readout the web renders on the right (web `{elapsed} / {total}`).
    public let timeReadout: String
    /// The spoken scrubber value ("m:ss"), or `nil` when the duration is unknown (web `aria-valuetext`).
    public let scrubberValueText: String?

    public var isContent: Bool {
        phase == .content
    }

    public init(
        phase: Phase,
        isPlaying: Bool,
        speed: PlaybackControlsSpeed,
        progress: Double,
        elapsed: String,
        total: String,
        durationMs: Double?,
        markers: [PlaybackControlsMarker],
        enableKeyboardShortcuts: Bool,
        connection: PlaybackControlsConnection,
        timeReadout: String,
        scrubberValueText: String?
    ) {
        self.phase = phase
        self.isPlaying = isPlaying
        self.speed = speed
        self.progress = progress
        self.elapsed = elapsed
        self.total = total
        self.durationMs = durationMs
        self.markers = markers
        self.enableKeyboardShortcuts = enableKeyboardShortcuts
        self.connection = connection
        self.timeReadout = timeReadout
        self.scrubberValueText = scrubberValueText
    }

    /// A neutral chrome state used before any host snapshot arrives (loading bar, live connection).
    static func chrome(phase: Phase) -> PlaybackControlsResolved {
        PlaybackControlsResolved(
            phase: phase,
            isPlaying: false,
            speed: .x1,
            progress: 0,
            elapsed: "0:00",
            total: "0:00",
            durationMs: nil,
            markers: [],
            enableKeyboardShortcuts: false,
            connection: .live,
            timeReadout: "0:00 / 0:00",
            scrubberValueText: nil
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `PlaybackControls` render. Unit tested across the leaf contract precedence and the derived
/// time-readout / scrubber value text.
public enum PlaybackControlsProjection {
    public static func resolve(
        _ input: PlaybackControlsInput,
        strings _: PlaybackControlsResolve = PlaybackControlsStrings.string
    ) -> PlaybackControlsResolved {
        PlaybackControlsResolved(
            phase: phase(for: input),
            isPlaying: input.isPlaying,
            speed: input.speed,
            progress: input.progress,
            elapsed: input.elapsed,
            total: input.total,
            durationMs: input.durationMs,
            markers: input.markers,
            enableKeyboardShortcuts: input.enableKeyboardShortcuts,
            connection: input.connection,
            timeReadout: "\(input.elapsed) / \(input.total)",
            scrubberValueText: timeText(durationMs: input.durationMs, progress: input.progress)
        )
    }

    /// The leaf-contract precedence: error > loading > empty(no timeline) > content.
    static func phase(for input: PlaybackControlsInput) -> PlaybackControlsResolved.Phase {
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        if input.isLoading {
            return .loading
        }
        if (input.durationMs ?? 0) <= 0 {
            return .empty
        }
        return .content
    }

    /// Formats a normalized position into the web "m:ss" readout, or `nil` when the duration is
    /// unknown / non-positive (matching the web `ariaValueText` guard).
    static func timeText(durationMs: Double?, progress: Double) -> String? {
        guard let durationMs, durationMs > 0, durationMs.isFinite else { return nil }
        let totalSeconds = durationMs / 1000
        let clamped = max(0, min(1, progress))
        let seconds = Int((totalSeconds * clamped).rounded())
        return "\(seconds / 60):" + String(format: "%02d", seconds % 60)
    }
}

// MARK: - Accessibility (labels)

/// Pure accessibility-label builders — kept here so the spoken copy is unit tested directly and the
/// views stay declarative. All copy resolves through the injected facade (P1/S10).
public enum PlaybackControlsAccessibility {
    /// The play / pause button label, mirroring the web `aria-label` toggle.
    public static func playPauseLabel(isPlaying: Bool, strings: PlaybackControlsResolve) -> String {
        isPlaying
            ? strings("replay.controls.pause", "Pause")
            : strings("replay.controls.play", "Play")
    }

    /// One marker read with its position, e.g. "Charge started, at 42%" or "regen peak 42%" — the
    /// native parity of the web marker `aria-label`.
    public static func markerLabel(_ marker: PlaybackControlsMarker, strings: PlaybackControlsResolve) -> String {
        let pct = Int((marker.at * 100).rounded())
        let atPct = strings("replay.markers.atPercent", "at {{pct}}%")
            .replacingOccurrences(of: "{{pct}}", with: "\(pct)")
        if let label = marker.label, !label.isEmpty {
            return "\(label), \(atPct)"
        }
        let kind = strings("replay.markers.\(marker.kind.rawValue)", marker.kind.rawValue)
        return "\(kind) \(pct)%"
    }

    /// The time-readout read as "elapsed of total" rather than the visual "elapsed / total".
    public static func timeReadoutLabel(
        elapsed: String,
        total: String,
        strings: PlaybackControlsResolve
    ) -> String {
        let template = strings("replay.controls.timeReadout", "{{elapsed}} of {{total}}")
        return template
            .replacingOccurrences(of: "{{elapsed}}", with: elapsed)
            .replacingOccurrences(of: "{{total}}", with: total)
    }
}
