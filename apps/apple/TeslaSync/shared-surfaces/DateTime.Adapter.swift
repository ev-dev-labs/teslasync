//
//  DateTime.Adapter.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The testable, dependency-light core for the datetime renderer — the SwiftUI parity of
//  `web/src/components/data-display/format/DateTime.tsx` and the pure helpers it wraps
//  (`web/src/lib/dateFormat.ts`, `web/src/lib/timezone.ts`, `web/src/lib/locale.ts`). Everything here
//  is pure (Foundation only): the value model (the native mirror of the web `string | Date | null`),
//  the variant + timezone-mode enums (web `DateTimeVariant` / `TzMode`), the verbatim ports of the
//  five formatters (`full` → `formatDateTime`, `date` → `formatDate`, `time` → `formatTime`,
//  `relative` → `formatRelativeTime`, `short` → `formatDateShort`), the `resolveTimezone` /
//  `resolveLocale` rules, the canonical-ISO title builder (the web hover `title`), the DST-aware tz
//  abbreviation (`tzAbbreviation`), and the composed VoiceOver strings. No store, no bundle, no
//  rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web component renders the formatted value in a `<span>` whose `title` carries the
//  canonical ISO string, optionally followed by a small muted tz abbreviation; a null / invalid value
//  collapses to the universal "—" fallback. This core reproduces that exact data + the read-time
//  formatting; the leaf-state gating + chrome live in the projection (Model) and the views.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias DateTimeResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Variant (web `DateTimeVariant`)

/// Which rendering the timestamp uses — the native mirror of the web
/// `'full' | 'date' | 'time' | 'relative' | 'short'`. Each maps to one of the five `dateFormat.ts`
/// helpers the web component dispatches to in `renderSpan`.
public enum DateTimeVariant: String, Sendable, Equatable, CaseIterable {
    case full
    case date
    case time
    case relative
    case short
}

// MARK: - Timezone mode (web `TzMode`)

/// The display timezone mode — the native mirror of the web `TzMode`
/// (`'vehicle' | 'user' | 'utc'`), resolved against the active vehicle's IANA zone and the user's
/// optional override by ``DateTimeFormatting/resolveTimeZone(mode:vehicleTimeZone:userOverride:device:)``.
public enum TimeZoneMode: String, Sendable, Equatable, CaseIterable {
    case vehicle
    case user
    case utc
}

// MARK: - Value (web `string | Date | null | undefined`)

/// The timestamp being rendered — the native mirror of the web `value` union. `absent` is the
/// `null | undefined` case (→ "—"); `iso` carries a raw backend ISO-8601 string (which may itself be
/// unparseable → "—"); `date` carries an already-parsed instant.
public enum DateTimeValue: Sendable, Equatable {
    case date(Date)
    case iso(String)
    case absent
}

// MARK: - Pure formatting core (verbatim port of the web helpers)

/// The locale + zone + clock context for a single render — groups the formatting inputs so the
/// formatter entry point stays within the parameter budget. `now` anchors the relative clock (the
/// web `Date.now()`); defaulting it keeps absolute call sites terse.
public struct DateTimeFormatContext: Sendable, Equatable {
    public let locale: String
    public let timeZone: String?
    public let now: Date

    public init(locale: String, timeZone: String?, now: Date = Date()) {
        self.locale = locale
        self.timeZone = timeZone
        self.now = now
    }
}

/// The pure formatting core — the native port of `dateFormat.ts` + `timezone.ts` + `locale.ts`. Every
/// function is deterministic (the relative clock is injected) and language-neutral copy resolves
/// through the injected `DateTimeResolve` seam, so the rendered text is asserted without a view or a
/// bundle.
public enum DateTimeFormatting {
    /// The universal fallback every formatter returns for nullish / unparseable input — the web
    /// `FALLBACK = '—'`. Language-neutral (a typographic em-dash), so it carries no localized copy.
    public static let fallback = "—"

    // MARK: Parsing

    /// Parses a value into an instant, or `nil` when absent / unparseable — the web
    /// `new Date(iso)` + `isNaN(d.getTime())` guard. Accepts ISO-8601 with or without fractional
    /// seconds (the two shapes the backend emits).
    public static func parse(_ value: DateTimeValue) -> Date? {
        switch value {
        case let .date(date):
            return date
        case let .iso(raw):
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return makeISO(fractional: true).date(from: trimmed) ?? makeISO(fractional: false).date(from: trimmed)
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
    /// the verbatim port of the web `resolveTimezone`. `device` stands in for the web
    /// `browserTimezone()` (defaults to the device zone; injected in tests for determinism).
    public static func resolveTimeZone(
        mode: TimeZoneMode,
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

    // MARK: Display

    /// Renders the value per variant, or the fallback for absent / unparseable input — the web
    /// `renderSpan` switch.
    public static func display(
        value: DateTimeValue,
        variant: DateTimeVariant,
        context: DateTimeFormatContext,
        strings: DateTimeResolve
    ) -> String {
        guard let date = parse(value) else { return fallback }
        if variant == .relative {
            return relative(date, context: context, strings: strings)
        }
        return absolute(date, variant: variant, context: context)
    }

    /// Builds an absolute label via `Date.FormatStyle` honoring the resolved locale + zone — the
    /// locale-aware `toLocaleString` family the web helpers call. The `.relative` case is the web
    /// `formatRelativeTime` >24h fallback (month/day + time).
    static func absolute(_ date: Date, variant: DateTimeVariant, context: DateTimeFormatContext) -> String {
        var style = Date.FormatStyle(locale: Locale(identifier: context.locale))
        if let timeZone = context.timeZone, let zone = TimeZone(identifier: timeZone) { style.timeZone = zone }
        switch variant {
        case .full:
            return style.year().month(.abbreviated).day().hour().minute().format(date)
        case .date:
            return style.year().month(.abbreviated).day().format(date)
        case .short:
            return style.month(.abbreviated).day().format(date)
        case .time:
            return style.hour().minute().format(date)
        case .relative:
            return style.month(.abbreviated).day().hour().minute().format(date)
        }
    }

    /// Relative label — the verbatim port of `formatRelativeTime`: "Just now", "{{count}}m ago",
    /// "{{count}}h ago", else the absolute month/day + time fallback. The first three phrases resolve
    /// through the i18n seam with `{{count}}` interpolation.
    static func relative(_ date: Date, context: DateTimeFormatContext, strings: DateTimeResolve) -> String {
        let diffMinutes = Int((context.now.timeIntervalSince(date) / 60).rounded(.down))
        if diffMinutes < 1 { return strings("format.dateTime.relative.justNow", "Just now") }
        if diffMinutes < 60 {
            return interpolate(strings("format.dateTime.relative.minutesAgo", "{{count}}m ago"), count: diffMinutes)
        }
        let diffHours = diffMinutes / 60
        if diffHours < 24 {
            return interpolate(strings("format.dateTime.relative.hoursAgo", "{{count}}h ago"), count: diffHours)
        }
        return absolute(date, variant: .relative, context: context)
    }

    // MARK: Canonical ISO title (web hover `title`)

    /// The canonical ISO-8601 title — the web `d.toISOString()` (+ " (tz)" when a zone is resolved).
    /// Returns `nil` for absent / unparseable values, exactly as the web omits `title` then.
    public static func isoTitle(_ value: DateTimeValue, timeZone: String?) -> String? {
        guard let date = parse(value) else { return nil }
        let iso = makeISO(fractional: false).string(from: date)
        if let timeZone, !timeZone.isEmpty { return "\(iso) (\(timeZone))" }
        return iso
    }

    // MARK: Timezone abbreviation (web `tzAbbreviation`)

    /// The DST-aware short zone abbreviation (e.g. "PST" / "PDT") — the web `tzAbbreviation`. Returns
    /// "" for an absent / unparseable value or an unknown zone, matching the web empty-string guard.
    public static func abbreviation(_ value: DateTimeValue, timeZone: String?) -> String {
        guard let date = parse(value), let timeZone, TimeZone(identifier: timeZone) != nil else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timeZone)
        formatter.dateFormat = "zzz"
        return formatter.string(from: date)
    }

    // MARK: Interpolation (web i18next `{{count}}`)

    /// Substitutes the single `{{count}}` token — the native parity of i18next interpolation.
    static func interpolate(_ template: String, count: Int) -> String {
        template.replacingOccurrences(of: "{{count}}", with: String(count))
    }

    // MARK: Private formatters

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
/// asserted without rendering the view. The web renders the value in a `<span>` with an ISO `title`;
/// the native parity speaks the formatted value (plus the zone abbreviation when shown) and offers
/// the canonical instant as the accessibility hint.
public enum DateTimeAccessibility {
    /// The spoken value label: the formatted display followed by the zone abbreviation when present.
    public static func valueLabel(display: String, abbreviation: String?) -> String {
        guard let abbreviation, !abbreviation.isEmpty else { return display }
        return "\(display) \(abbreviation)"
    }
}
