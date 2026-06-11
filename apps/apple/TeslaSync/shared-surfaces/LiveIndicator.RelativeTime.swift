//
//  LiveIndicator.RelativeTime.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  The native port of `formatRelativeTime` from `web/src/lib/dateFormat.ts`, used by the pill
//  variant's freshness stamp (`· {formatRelativeTime(lastMessageAt)}`). The web helper hard-codes its
//  English phrases ("Just now", "{n}m ago", "{n}h ago") and falls back to an absolute, locale-aware
//  short date for anything older than a day:
//
//      if (!iso) return '—'
//      const diffMin = floor((now - d) / 60_000)
//      if (diffMin < 1) return 'Just now'
//      if (diffMin < 60) return `${diffMin}m ago`
//      const diffHrs = floor(diffMin / 60)
//      if (diffHrs < 24) return `${diffHrs}h ago`
//      return d.toLocaleDateString(locale, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
//
//  Native code holds no English literals, so the three relative phrases resolve through the P1/S10
//  facade (the `{{count}}` token mirrors the web i18next interpolation) and the absolute branch is
//  produced with a locale-aware `Date.FormatStyle`. The clock is injected so the output is
//  deterministic under test.
//

import Foundation

/// Formats a "time since last message" stamp matching the web `formatRelativeTime` thresholds, with
/// the relative phrases routed through the P1/S10 facade and the absolute fallback localized.
public enum LiveIndicatorRelativeTime {
    public static func string(
        for instant: Date?,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: LiveIndicatorResolve = LiveIndicatorStrings.string
    ) -> String {
        guard let instant else { return LiveIndicatorMeta.fallback }

        let diffMinutes = Int((now.timeIntervalSince(instant) / 60).rounded(.down))
        if diffMinutes < 1 {
            return strings("live.relative.justNow", "Just now")
        }
        if diffMinutes < 60 {
            return interpolate(
                strings("live.relative.minutesAgo", "{{count}}m ago"),
                count: diffMinutes,
                locale: locale
            )
        }
        let diffHours = diffMinutes / 60
        if diffHours < 24 {
            return interpolate(strings("live.relative.hoursAgo", "{{count}}h ago"), count: diffHours, locale: locale)
        }
        return absolute(instant, locale: locale)
    }

    /// Replaces the `{{count}}` token with the locale-formatted integer (the parity of the web
    /// `${diffMin}` interpolation, localized for digit shaping).
    private static func interpolate(_ template: String, count: Int, locale: Locale) -> String {
        let number = count.formatted(.number.locale(locale).grouping(.never))
        return template.replacingOccurrences(of: "{{count}}", with: number)
    }

    /// The absolute fallback (older than a day) — a locale-aware "MMM d, h:mm a" style omitting the
    /// year, matching the web `toLocaleDateString` field set (`month: 'short', day: 'numeric',
    /// hour / minute`).
    private static func absolute(_ instant: Date, locale: Locale) -> String {
        instant.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
                .hour()
                .minute()
                .locale(locale)
        )
    }
}
