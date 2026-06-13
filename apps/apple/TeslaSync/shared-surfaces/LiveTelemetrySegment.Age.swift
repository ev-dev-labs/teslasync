//
//  LiveTelemetrySegment.Age.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  The native port of the web `ageSecondsLabel` helper from
//  `web/src/components/layout/status-bar/LiveTelemetrySegment.tsx`, used for the compact freshness stamp
//  (`· {ageSecondsLabel(lastMessageAt)}`) and the tooltip's "Last message {age} ago" clause. Unlike the
//  data-display `LiveIndicator`'s relative-time phrasing ("5m ago"), this segment uses the denser
//  single-unit form ("5m"):
//
//      if (!iso) return '—'
//      const ms = Date.now() - new Date(iso).getTime()
//      if (!Number.isFinite(ms) || ms < 0) return '—'
//      const sec = Math.floor(ms / 1_000)
//      if (sec < 60) return `${sec}s`
//      const min = Math.floor(sec / 60)
//      if (min < 60) return `${min}m`
//      const hr = Math.floor(min / 60)
//      return `${hr}h`
//
//  Native code holds no English / bare literals, so the unit forms resolve through the P1/S10 facade
//  (the `{{count}}` token mirrors the web i18next interpolation and shapes the digits for the locale) and
//  the null / negative case returns the shared em-dash sentinel. The clock is injected so the output is
//  deterministic under test.
//

import Foundation

/// Formats the compact "time since last message" stamp matching the web `ageSecondsLabel` thresholds,
/// with the unit forms routed through the P1/S10 facade and the null / negative case returning the
/// em-dash sentinel.
public enum LiveTelemetrySegmentAge {
    public static func label(
        for instant: Date?,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: LiveTelemetrySegmentResolve = LiveTelemetrySegmentStrings.string
    ) -> String {
        guard let instant else { return LiveTelemetrySegmentMeta.fallback }

        let milliseconds = now.timeIntervalSince(instant) * 1000
        guard milliseconds.isFinite, milliseconds >= 0 else { return LiveTelemetrySegmentMeta.fallback }

        let seconds = Int((milliseconds / 1000).rounded(.down))
        if seconds < 60 {
            return interpolate(strings("statusBar.live.age.seconds", "{{count}}s"), count: seconds, locale: locale)
        }
        let minutes = seconds / 60
        if minutes < 60 {
            return interpolate(strings("statusBar.live.age.minutes", "{{count}}m"), count: minutes, locale: locale)
        }
        let hours = minutes / 60
        return interpolate(strings("statusBar.live.age.hours", "{{count}}h"), count: hours, locale: locale)
    }

    /// Replaces the `{{count}}` token with the locale-formatted integer (the parity of the web `${sec}` /
    /// `${min}` / `${hr}` interpolation, localized for digit shaping).
    private static func interpolate(_ template: String, count: Int, locale: Locale) -> String {
        let number = count.formatted(.number.locale(locale).grouping(.never))
        return template.replacingOccurrences(of: "{{count}}", with: number)
    }
}
