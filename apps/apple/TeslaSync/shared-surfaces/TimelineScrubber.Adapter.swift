//
//  TimelineScrubber.Adapter.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The Foundation-only "data adapter" for the timeline scrubber: the deterministic math + formatting
//  that turns raw normalized positions and the cached input snapshot into the values the view and
//  VoiceOver read — clamping, percent rounding, the web "m:ss" time text, and the drag-emit throttle
//  decision (web `SCRUB_INTERVAL_MS`). Split from the projection so every rule is unit tested without
//  a view, a clock, or a bundle. All user-facing copy resolves through the injected P1/S10 facade.
//

import Foundation

// MARK: - Numeric helpers (web clamp + percent + time text)

/// Pure numeric helpers mirroring the web scrubber's inline math. Kept as a namespaced enum so the
/// projection, the view, and the tests share one source of truth.
public enum TimelineScrubberAdapter {
    /// Clamps a normalized value into 0…1 (web `Math.max(0, Math.min(1, x))`). Non-finite → 0.
    public static func clamp01(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return max(0, min(1, value))
    }

    /// The integer percent for a normalized position (web `Math.round(x * 100)`), clamped to 0…100.
    public static func percent(_ value: Double) -> Int {
        Int((clamp01(value) * 100).rounded())
    }

    /// Formats a normalized position into the web "m:ss" readout, or `nil` when the duration is
    /// unknown / non-positive (matching the web `ariaValueText` guard:
    /// `Number.isFinite(duration) && duration > 0`).
    public static func timeText(durationSeconds: Double, progress: Double) -> String? {
        guard durationSeconds.isFinite, durationSeconds > 0 else { return nil }
        let seconds = Int((durationSeconds * clamp01(progress)).rounded())
        return "\(seconds / 60):" + String(format: "%02d", seconds % 60)
    }

    /// The drag-emit throttle decision — emit an intermediate seek only once `interval` seconds have
    /// elapsed since the last emit (web `now - lastEmitRef.current >= SCRUB_INTERVAL_MS`). The first
    /// drag sample (`last == .distantPast`) always emits.
    public static func shouldEmit(
        now: Date,
        last: Date,
        interval: Double = TimelineScrubberMeta.scrubInterval
    ) -> Bool {
        now.timeIntervalSince(last) >= interval
    }
}

// MARK: - Accessibility (labels)

/// Pure accessibility-label builders — kept here so the spoken copy is unit tested directly and the
/// views stay declarative. All copy resolves through the injected facade (P1/S10).
public enum TimelineScrubberAccessibility {
    /// The spoken scrubber value: the "m:ss" playback time when the duration is known, else the bare
    /// percent (web `aria-valuetext` falls back to `aria-valuenow` when the time is unavailable).
    public static func scrubberValue(durationSeconds: Double, progress: Double) -> String {
        if let time = TimelineScrubberAdapter.timeText(durationSeconds: durationSeconds, progress: progress) {
            return time
        }
        return "\(TimelineScrubberAdapter.percent(progress))%"
    }

    /// One marker read with its position, e.g. "Regen peak, at 42%" or "regenPeak 42%" — the native
    /// parity of the web marker `aria-label` (label + `at {{pct}}%`, else kind + percent).
    public static func markerLabel(
        _ marker: TimelineScrubberMarker,
        strings: TimelineScrubberResolve
    ) -> String {
        let pct = TimelineScrubberAdapter.percent(marker.at)
        let atPct = strings("timelineScrubber.markerAtPercent", "at {{pct}}%")
            .replacingOccurrences(of: "{{pct}}", with: "\(pct)")
        if let label = marker.label, !label.isEmpty {
            return "\(label), \(atPct)"
        }
        let kind = strings("timelineScrubber.markers.\(marker.kind.rawValue)", marker.kind.rawValue)
        return "\(kind) \(pct)%"
    }

    /// The localized clustered-count suffix read after a marker label when `count > 1`, e.g.
    /// "3 events" (the spoken form of the web count badge).
    public static func markerCountLabel(_ count: Int, strings: TimelineScrubberResolve) -> String {
        strings("timelineScrubber.markerCount", "{{count}} events")
            .replacingOccurrences(of: "{{count}}", with: "\(count)")
    }
}
