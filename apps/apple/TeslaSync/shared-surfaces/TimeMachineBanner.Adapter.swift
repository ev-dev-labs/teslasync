//
//  TimeMachineBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  The testable, dependency-light core for the historical "viewing data as of …" banner — the SwiftUI
//  parity of `components/feedback/TimeMachineBanner.tsx` (+ its `useAsOfDate` hook and the
//  `formatDateTime` / `toLocalDatetimeStr` date helpers). The web banner is visible whenever the SPA is
//  operating in time-machine mode (the `?as_of=` RFC 3339 query parameter is set) so users — and
//  especially diagnostics operators reconstructing post-incident state — never lose track of the fact
//  that they are looking at a historical snapshot rather than live data. It also exposes an inline
//  date-time picker so the historical anchor can be revealed AND changed without leaving the page.
//
//  This file holds only pure, Foundation-only values: the localized copy keys (web
//  `timeMachine.banner.*`), the title `{when}` interpolation (web i18next `{{when}}`), the RFC 3339
//  validation / parse / format contract (web `looksLikeIso` + `localInputToRfc3339` + the URL state),
//  the locale-aware display formatter (web `formatDateTime`), the picker seed (web "yesterday at
//  noon"), and the VoiceOver label builder. No store, no bundle, no rendered view — each piece is unit
//  tested in isolation. Tint / colour is applied at the view boundary (P1/S9 tokens), never here.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias TimeMachineResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Copy (web `timeMachine.banner.*`)

/// The localized copy keys for the banner — the verbatim port of the web `TimeMachineBanner` strings.
/// Every key mirrors the web source (`timeMachine.banner.title` / `.body` / `.pickPrompt` / `.pick` /
/// `.returnToLive` / `.submit` / `.cancel` / `.inputLabel`); the title fallback carries the native
/// `{when}` token the title builder substitutes (web i18next `{{when}}`). Pure (key, fallback) values
/// resolved through the P1/S10 facade at the view boundary.
public enum TimeMachineCopy {
    public static let titleKey = "timeMachine.banner.title"
    public static let titleFallback = "Viewing data as of {when}"

    public static let bodyKey = "timeMachine.banner.body"
    public static let bodyFallback = "Read-only point-in-time mode."

    public static let pickPromptKey = "timeMachine.banner.pickPrompt"
    public static let pickPromptFallback = "Pick a point in time to view historical data."

    public static let pickKey = "timeMachine.banner.pick"
    public static let pickFallback = "Pick a date"

    public static let returnToLiveKey = "timeMachine.banner.returnToLive"
    public static let returnToLiveFallback = "Return to live"

    public static let submitKey = "timeMachine.banner.submit"
    public static let submitFallback = "View as of date"

    public static let cancelKey = "timeMachine.banner.cancel"
    public static let cancelFallback = "Cancel"

    public static let inputLabelKey = "timeMachine.banner.inputLabel"
    public static let inputLabelFallback = "Date and time"
}

// MARK: - Title interpolation (web i18next `{{when}}`)

/// Builds the banner title from the localized template + the already-formatted anchor — the native
/// parity of the web `t('timeMachine.banner.title', { when })` interpolation. Pure string work,
/// asserted without rendering. Trims a dangling separator so the live-mode picker edge (an empty
/// `when`) reads cleanly instead of leaving a trailing space.
public enum TimeMachineTitle {
    /// The token the localized title template carries for the formatted anchor.
    public static let whenToken = "{when}"

    /// Substitutes the formatted anchor into the localized title template. Tolerates a template
    /// missing the token (the surviving text is returned unchanged).
    public static func text(when: String, template: String) -> String {
        template
            .replacingOccurrences(of: whenToken, with: when)
            .trimmingCharacters(in: .whitespaces)
    }
}

// MARK: - RFC 3339 contract (web `useAsOfDate` validation + `localInputToRfc3339`)

/// The RFC 3339 round-trip the as-of anchor flows through — the native parity of the web `looksLikeIso`
/// sniff (which drops pasted garbage before it reaches the wire), the `localInputToRfc3339` submit
/// conversion, and the URL `?as_of=` serialization. Pure, Foundation-only, so the persistence seam and
/// the model can validate without a bundle and tests assert the contract directly.
public enum TimeMachineRfc3339 {
    /// The strict RFC 3339 shape the web `ISO_RFC3339_RE` accepts: a date, a `T`, an `HH:mm` with an
    /// optional `:ss(.fraction)`, and a `Z` or numeric offset.
    static let pattern =
        "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})$"

    /// Whether the string is a well-formed RFC 3339 timestamp that also names a real instant — the
    /// native parity of the web `looksLikeIso` (regex shape + `Date.parse` finiteness).
    public static func isValid(_ value: String) -> Bool {
        guard value.range(of: pattern, options: .regularExpression) != nil else { return false }
        return parse(value) != nil
    }

    /// Parses a validated RFC 3339 string into an instant, or `nil` when it is malformed — the native
    /// parity of the web parser dropping garbage rather than propagating it.
    public static func parse(_ value: String) -> Date? {
        guard value.range(of: pattern, options: .regularExpression) != nil else { return nil }
        let optionSets: [ISO8601DateFormatter.Options] = [
            [.withInternetDateTime, .withFractionalSeconds],
            [.withInternetDateTime]
        ]
        for options in optionSets {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = options
            if let date = formatter.date(from: value) { return date }
        }
        // RFC 3339 permits omitting the seconds (web regex allows it); ISO8601DateFormatter requires
        // them, so inject a ":00" seconds field for the minute-resolution form and re-parse.
        let secondsInjected = value.replacingOccurrences(
            of: "^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2})(Z|[+-]\\d{2}:\\d{2})$",
            with: "$1:00$2",
            options: .regularExpression
        )
        guard secondsInjected != value else { return nil }
        let normalized = ISO8601DateFormatter()
        normalized.formatOptions = [.withInternetDateTime]
        return normalized.date(from: secondsInjected)
    }

    /// Serializes an instant to a UTC RFC 3339 string — the native parity of the web
    /// `date.toISOString()` the picker submit writes to the `?as_of=` URL state.
    public static func format(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}

// MARK: - Display formatting (web `formatDateTime`)

/// Formats the anchor for the banner title — the native parity of the web `formatDateTime`
/// (`toLocaleString` with a numeric year/day, an abbreviated month, and a 2-digit hour/minute). Locale
/// + time-zone are injected so the output is deterministic under test.
public enum TimeMachineFormat {
    public static func dateTime(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }
}

// MARK: - Picker seed (web `TIME_MACHINE_OPEN_PICKER_EVENT` default)

/// The default historical anchor the picker pre-fills when there is no active as-of — the native parity
/// of the web "yesterday at noon" seed, which lands the user inside the supported lookback window
/// without requiring a click. Calendar + `now` are injected so the rule is asserted deterministically.
public enum TimeMachineSeed {
    public static func defaultAnchor(now: Date = Date(), calendar: Calendar = .current) -> Date {
        let yesterday = calendar.date(byAdding: .day, value: -1, to: now) ?? now
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: yesterday) ?? yesterday
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view (web `role="status"` + `aria-live="polite"` banner).
public enum TimeMachineAccessibility {
    /// Joins the banner's title + body into one VoiceOver sentence, never doubling a terminal period
    /// when the title already ends in one.
    public static func bannerLabel(title: String, body: String) -> String {
        guard !title.isEmpty else { return body }
        guard !body.isEmpty else { return title }
        let endsWithTerminal = title.last.map { ".!?".contains($0) } ?? false
        return title + (endsWithTerminal ? " " : ". ") + body
    }
}
