//
//  TimeStamp.Adapter.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  The testable, dependency-light core for the timestamp renderer — the SwiftUI parity of
//  `web/src/components/data-display/TimeStamp.tsx` and the two hooks + pure helpers it wraps
//  (`web/src/hooks/useTimeFormatPreference.ts`, `web/src/hooks/useDateFormat.ts`,
//  `web/src/lib/dateFormat.ts`, `web/src/lib/timezone.ts`). Everything here is pure (Foundation only):
//  the value model (the native mirror of the web `string | number | Date | null | undefined` union),
//  the visible-format + preference enums (web `TimeStampFormat` / the `useTimeFormatPreference`
//  result), the verbatim ports of the two formatters the component flips between
//  (`formatRelative` → the relative body, `formatDateTime` → the absolute body) plus the
//  `formatDate` >7-day fallback, the `resolveLocale` / `resolveTimezone` rules (web `useDateFormat`'s
//  context), the primary/secondary pair derivation (the visible body + the tooltip alternate), and
//  the composed VoiceOver strings. No store, no bundle, no rendered view, so each piece is unit
//  tested in isolation.
//
//  Parity note: the web component renders ONE format in the visible `<span>` (relative or absolute,
//  picked by `format` defaulting to the user's `time_format_default` preference) and ALWAYS shows the
//  OTHER format in a hover `Tooltip`, so power users can flip perspectives without leaving the page. A
//  null / undefined / unparseable value collapses to the universal "—" placeholder with NO tooltip.
//  This core reproduces that exact data + the read-time formatting; the leaf-state gating + chrome
//  live in the projection (Model) and the views.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias TimeStampResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Visible format (web `TimeStampFormat`)

/// Which format the visible body uses — the native mirror of the web
/// `'relative' | 'absolute' | 'auto'`. `auto` (the web default) honors the user's
/// `time_format_default` preference; explicit `relative` / `absolute` override it for one surface.
public enum TimeStampFormat: String, Sendable, Equatable, CaseIterable {
    case relative
    case absolute
    case auto
}

// MARK: - Format preference (web `useTimeFormatPreference` result)

/// The user's globally preferred default format — the native mirror of the web
/// `useTimeFormatPreference` return (`'relative' | 'absolute'`, defaulting to `relative`). `auto`
/// resolves to this; it is never itself `auto`.
public enum TimeStampPreference: String, Sendable, Equatable, CaseIterable {
    case relative
    case absolute
}

// MARK: - Timezone mode (web `TzMode`)

/// The display timezone mode — the native mirror of the web `TzMode`
/// (`'vehicle' | 'user' | 'utc'`), the `in` prop `useDateFormat` resolves against the active
/// vehicle's IANA zone and the user's optional override. Kept surface-local (per-surface
/// self-contained types) so the renderer type-checks + unit-tests in isolation.
public enum TimeStampTzMode: String, Sendable, Equatable, CaseIterable {
    case vehicle
    case user
    case utc
}

// MARK: - Value (web `string | number | Date | null | undefined`)

/// The timestamp being rendered — the native mirror of the web `value` union. `absent` is the
/// `null | undefined` case (→ "—"); `iso` carries a raw backend ISO-8601 string (which may itself be
/// unparseable → "—"); `epochMillis` carries a Unix-epoch millisecond count (the web `number` case,
/// which `new Date(number)` reads as milliseconds); `date` carries an already-parsed instant.
public enum TimeStampValue: Sendable, Equatable {
    case date(Date)
    case iso(String)
    case epochMillis(Double)
    case absent
}

// MARK: - Format context (locale + zone + clock)

/// The locale + zone + clock context for a single render — groups the formatting inputs so the
/// formatter entry points stay within the parameter budget. `now` anchors the relative clock (the
/// web `Date.now()`); defaulting it keeps absolute call sites terse.
public struct TimeStampFormatContext: Sendable, Equatable {
    public let locale: String
    public let timeZone: String?
    public let now: Date

    public init(locale: String, timeZone: String?, now: Date = Date()) {
        self.locale = locale
        self.timeZone = timeZone
        self.now = now
    }
}

// MARK: - Primary / secondary pair (web visible body + tooltip alternate)

/// The two rendered strings for a parseable value — `primary` is the visible body and `secondary` is
/// the tooltip alternate (always the OTHER format), exactly as the web component computes them.
public struct TimeStampPair: Sendable, Equatable {
    /// The visible body — the chosen format (web `primary`).
    public let primary: String
    /// The tooltip alternate — always the other format (web `secondary`).
    public let secondary: String

    public init(primary: String, secondary: String) {
        self.primary = primary
        self.secondary = secondary
    }
}

// MARK: - Pure formatting core (verbatim port of the web helpers)

/// The pure formatting core — the native port of `useTimeFormatPreference` + `useDateFormat` +
/// `dateFormat.ts` (`formatRelative` / `formatDateTime` / `formatDate`) + `timezone.ts`
/// (`resolveTimezone`). Every function is deterministic (the relative clock is injected) and
/// language-neutral copy resolves through the injected `TimeStampResolve` seam, so the rendered text
/// is asserted without a view or a bundle.
public enum TimeStampFormatting {
    /// The universal fallback for nullish / unparseable input — the web `FALLBACK = '—'`.
    /// Language-neutral (a typographic em-dash), so it carries no localized copy.
    public static let fallback = "—"

    // MARK: Parsing

    /// Parses a value into an instant, or `nil` when absent / unparseable — the web
    /// `new Date(value)` + `isNaN(d.getTime())` guard. Accepts ISO-8601 with or without fractional
    /// seconds (the two shapes the backend emits) and epoch milliseconds (the web `number` case).
    public static func parse(_ value: TimeStampValue) -> Date? {
        switch value {
        case let .date(date):
            return date
        case let .iso(raw):
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return makeISO(fractional: true).date(from: trimmed) ?? makeISO(fractional: false).date(from: trimmed)
        case let .epochMillis(millis):
            guard millis.isFinite else { return nil }
            return Date(timeIntervalSince1970: millis / 1000)
        case .absent:
            return nil
        }
    }

    // MARK: Locale + timezone resolution

    /// Resolves a BCP-47 locale, degrading empty / whitespace input to `en-US` — the web
    /// `resolveLocale`, which guards against `Intl.*` throwing on an empty language tag.
    public static func resolveLocale(_ locale: String?) -> String {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else { return "en-US" }
        return locale
    }

    /// Resolves the IANA timezone from a mode + the vehicle's reported zone + the user's override —
    /// the verbatim port of the web `resolveTimezone` (which `useDateFormat` feeds the formatters).
    /// `device` stands in for the web `browserTimezone()` (defaults to the device zone; injected in
    /// tests for determinism).
    public static func resolveTimeZone(
        mode: TimeStampTzMode,
        vehicleTimeZone: String?,
        userOverride: String?,
        device: String = TimeZone.current.identifier
    ) -> String {
        if mode == .utc { return "UTC" }
        let trimmedOverride = userOverride?.trimmingCharacters(in: .whitespaces)
        let userTz: String = if let trimmedOverride, !trimmedOverride.isEmpty { trimmedOverride } else { device }
        if mode == .user { return userTz }
        guard let vehicleTimeZone, !vehicleTimeZone.isEmpty, vehicleTimeZone != "UTC" else { return userTz }
        return vehicleTimeZone
    }

    // MARK: Effective format (web `format === 'auto' ? pref : format`)

    /// Resolves the effective format — the web `format === 'auto' ? pref : format`. `auto` collapses
    /// to the user's preference; an explicit format wins.
    public static func effective(_ format: TimeStampFormat, preference: TimeStampPreference) -> TimeStampPreference {
        switch format {
        case .auto: preference
        case .relative: .relative
        case .absolute: .absolute
        }
    }

    // MARK: Primary / secondary derivation (web visible body + tooltip alternate)

    /// Derives the visible body + the tooltip alternate, or `nil` for an absent / unparseable value
    /// (web: "—" with no tooltip). The web always computes BOTH the relative and absolute strings and
    /// assigns the chosen one to the body and the other to the tooltip.
    public static func pair(
        value: TimeStampValue,
        format: TimeStampFormat,
        preference: TimeStampPreference,
        context: TimeStampFormatContext,
        strings: TimeStampResolve
    ) -> TimeStampPair? {
        guard let date = parse(value) else { return nil }
        let relativeText = relative(date, context: context, strings: strings)
        let absoluteText = absolute(date, context: context)
        switch effective(format, preference: preference) {
        case .relative:
            return TimeStampPair(primary: relativeText, secondary: absoluteText)
        case .absolute:
            return TimeStampPair(primary: absoluteText, secondary: relativeText)
        }
    }

    // MARK: Display formatters

    /// The absolute label — the web `formatDateTime` ("Apr 4, 2026, 2:30 AM"): full date + time built
    /// via `Date.FormatStyle` honoring the resolved locale + zone (the locale-aware `toLocaleString`
    /// the web helper calls).
    static func absolute(_ date: Date, context: TimeStampFormatContext) -> String {
        styled(context).year().month(.abbreviated).day().hour().minute().format(date)
    }

    /// The date-only label — the web `formatDate` ("Apr 4, 2026"): the >7-day fallback the relative
    /// formatter degrades to, built via the same locale- + zone-aware `Date.FormatStyle`.
    static func dateOnly(_ date: Date, context: TimeStampFormatContext) -> String {
        styled(context).year().month(.abbreviated).day().format(date)
    }

    /// The relative label — the verbatim port of `formatRelative`: "just now", "{{count}}m ago",
    /// "{{count}}h ago", "{{count}}d ago", else the absolute date-only fallback beyond a week. The
    /// first four phrases resolve through the i18n seam with `{{count}}` interpolation; a future
    /// instant (negative delta) reads as "just now", exactly as the web `seconds < 60` guard does.
    static func relative(_ date: Date, context: TimeStampFormatContext, strings: TimeStampResolve) -> String {
        let seconds = Int((context.now.timeIntervalSince(date)).rounded(.down))
        if seconds < 60 { return strings("format.timeStamp.relative.justNow", "just now") }
        let minutes = seconds / 60
        if minutes < 60 {
            return interpolate(strings("format.timeStamp.relative.minutesAgo", "{{count}}m ago"), count: minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return interpolate(strings("format.timeStamp.relative.hoursAgo", "{{count}}h ago"), count: hours)
        }
        let days = hours / 24
        if days < 7 {
            return interpolate(strings("format.timeStamp.relative.daysAgo", "{{count}}d ago"), count: days)
        }
        return dateOnly(date, context: context)
    }

    // MARK: Interpolation (web i18next `{{count}}`)

    /// Substitutes the single `{{count}}` token — the native parity of i18next interpolation.
    static func interpolate(_ template: String, count: Int) -> String {
        template.replacingOccurrences(of: "{{count}}", with: String(count))
    }

    // MARK: Private formatters

    /// Builds the locale- + zone-aware `Date.FormatStyle` shared by the absolute + date-only labels.
    private static func styled(_ context: TimeStampFormatContext) -> Date.FormatStyle {
        var style = Date.FormatStyle(locale: Locale(identifier: context.locale))
        if let timeZone = context.timeZone, let zone = TimeZone(identifier: timeZone) { style.timeZone = zone }
        return style
    }

    /// Builds a fresh ISO-8601 formatter — created per call rather than cached, since
    /// `ISO8601DateFormatter` is not `Sendable` and these paths are not perf-critical (the hot
    /// absolute formatting uses `Date.FormatStyle`).
    private static func makeISO(fractional: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractional
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings from already-formatted parts, so the spoken content is
/// asserted without rendering the view. The web renders the visible body in a `<span>` whose tooltip
/// (the alternate format) is wired to the trigger via `aria-describedby`; the native parity speaks the
/// visible body as the value and offers the alternate format as the accessibility hint, so the
/// precise alternate is always recoverable.
public enum TimeStampAccessibility {
    /// The spoken value label — the visible body (web `primary`).
    public static func valueLabel(primary: String) -> String {
        primary
    }

    /// The spoken hint announcing the tooltip alternate (web `secondary`), phrased through the i18n
    /// seam so it carries no hardcoded English. Returns `nil` when there is no alternate to announce.
    public static func alternateHint(secondary: String?, strings: TimeStampResolve) -> String? {
        guard let secondary, !secondary.isEmpty else { return nil }
        return strings("format.timeStamp.alternateA11y", "Also {{value}}")
            .replacingOccurrences(of: "{{value}}", with: secondary)
    }
}
