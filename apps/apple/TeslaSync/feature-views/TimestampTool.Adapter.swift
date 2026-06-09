//
//  TimestampTool.Adapter.swift
//  TeslaSync — P4 feature view · 0021 · TimestampTool (Apple)
//
//  Pure, SwiftUI-free projection logic — the native parity of the web tool's
//  `useMemo` parsing + the `formatDateTime` / `getRelativeTime` helpers used by
//  features/admin/components/devtools/tools/TimestampTool.tsx.
//
//  Kept Foundation-only so the model + adapter compile and run on a plain host
//  (the SwiftUI chrome layers on top in TimestampTool.swift). There is no network
//  here — this surface is a synchronous client-side tool, mirroring the web source
//  whose only hook is `useTranslation`.
//
//  Cross-platform VALUE parity (not a "corrected" version): the integer parse, the
//  `length > 10 ? ms : s` rule, the floored unix seconds, the always-"ago" relative
//  buckets, and the UTC ISO-8601 string all reproduce the web output byte-for-byte
//  for realistic timestamp inputs.
//

import Foundation

// MARK: - JS number parsing (web `parseInt(str, 10)`)

/// Faithful port of JavaScript's `parseInt(value, 10)` for the radix-10 case, as
/// used by the web tool (`parseInt(unix, 10)`). It skips leading
/// `StrWhiteSpace`, accepts an optional sign, consumes the leading run of ASCII
/// digits and ignores any trailing characters — returning `nil` (the JS `NaN`)
/// when no digits are present. The result is a `Double` so it mirrors JS's
/// number type (parseInt of a very long digit run loses precision past 2^53 in
/// both runtimes).
public enum JSNumber {
    /// JS `StrWhiteSpace` leading-trim set (space, tab, newlines, form feed,
    /// vertical tab, NBSP). A pragmatic superset is fine — realistic inputs use
    /// at most spaces.
    private static let whitespace = Set<Character>([
        " ", "\t", "\n", "\r", "\u{0B}", "\u{0C}", "\u{A0}"
    ])

    /// Parses the leading base-10 integer from `raw`, or `nil` for `NaN`.
    public static func parseInt10(_ raw: String) -> Double? {
        var index = raw.startIndex
        let end = raw.endIndex

        while index < end, whitespace.contains(raw[index]) {
            index = raw.index(after: index)
        }

        var sign = 1.0
        if index < end, raw[index] == "+" || raw[index] == "-" {
            if raw[index] == "-" { sign = -1.0 }
            index = raw.index(after: index)
        }

        var digits = ""
        while index < end, raw[index].isASCII, raw[index].isNumber {
            digits.append(raw[index])
            index = raw.index(after: index)
        }

        guard let magnitude = Double(digits) else { return nil }
        return sign * magnitude
    }
}

// MARK: - Date math (web `new Date(ms)` validity bounds)

/// The native parity of `new Date(ms)` and the formatting helpers. Foundation's
/// `Date` is unbounded, so the JS ±8.64e15 ms validity window is enforced here so
/// out-of-range inputs project to `nil` exactly as the web (`isNaN` → `null`).
public enum TimestampMath {
    /// The largest absolute time value (in milliseconds) a JS `Date` accepts:
    /// ±100,000,000 days from the epoch (ECMAScript time-clip).
    public static let maxValidMilliseconds: Double = 8_640_000_000_000_000

    /// Builds a `Date` from a millisecond value, or `nil` when the value is not
    /// finite or falls outside the JS `Date` range (web `isNaN(d.getTime())`).
    public static func date(fromMilliseconds milliseconds: Double) -> Date? {
        guard milliseconds.isFinite else { return nil }
        guard abs(milliseconds) <= maxValidMilliseconds else { return nil }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }

    /// Floored unix seconds for a date — web `Math.floor(getTime() / 1000)`.
    /// `floor` matches JS for negative (pre-epoch) instants too.
    public static func unixSeconds(_ date: Date) -> Int {
        Int(floor(date.timeIntervalSince1970))
    }
}

// MARK: - Parsing (web `useMemo` blocks)

/// The two parse routines the web tool runs in its `useMemo`s: one for the Unix
/// field (integer + the `length > 10` ms/s heuristic) and one for the ISO field
/// (`new Date(iso)`). Both return `nil` for input the web would treat as falsy or
/// `Invalid Date`.
public enum TimestampParser {
    /// Web:
    /// ```
    /// if (!unix) return null
    /// const ms = unix.length > 10 ? parseInt(unix, 10) : parseInt(unix, 10) * 1000
    /// const d = new Date(ms); return isNaN(d.getTime()) ? null : d
    /// ```
    /// The `length` test reads the RAW string length (including any sign/space/
    /// trailing junk), reproduced verbatim.
    public static func parseUnix(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        guard let value = JSNumber.parseInt10(raw) else { return nil }
        let milliseconds = raw.count > 10 ? value : value * 1000
        return TimestampMath.date(fromMilliseconds: milliseconds)
    }

    /// Web: `if (!iso) return null; const d = new Date(iso); …`. JS `new Date`
    /// accepts a wide grammar; the realistic inputs for this devtools field are
    /// ISO-8601, so native parses that grammar robustly: an internet date-time
    /// (with or without fractional seconds and with an explicit offset), a
    /// timezone-less date-time (interpreted in `timeZone`, like JS local time),
    /// and a bare calendar date (UTC midnight, like JS). Anything else → `nil`
    /// (the web `Invalid Date`).
    public static func parseISO(_ raw: String, timeZone: TimeZone) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Formatters are constructed per call: `ISO8601DateFormatter` /
        // `DateFormatter` are not `Sendable`, so sharing them as static state
        // would break Swift-6 strict concurrency. Construction is cheap relative
        // to this devtools surface's interaction rate.
        if let date = isoFormatter(fractional: true).date(from: trimmed) { return date }
        if let date = isoFormatter(fractional: false).date(from: trimmed) { return date }
        if let date = fixed("yyyy-MM-dd'T'HH:mm:ss", trimmed, timeZone) { return date }
        if let date = fixed("yyyy-MM-dd'T'HH:mm", trimmed, timeZone) { return date }
        if let date = fixed("yyyy-MM-dd", trimmed, TimeZone(identifier: "UTC") ?? timeZone) {
            return date
        }
        return nil
    }

    private static func isoFormatter(fractional: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractional
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter
    }

    private static func fixed(_ format: String, _ value: String, _ timeZone: TimeZone) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        return formatter.date(from: value)
    }
}

// MARK: - Formatting (web `toISOString` / `formatDateTime` / `getRelativeTime`)

/// The display formatters the web renders for every parsed date. `iso8601` and
/// `unixSeconds` are timezone-independent (UTC / epoch); `local` honours the
/// caller's locale + timezone (web `toLocaleString`); `relative` is the compact
/// "ago" bucketing.
public enum TimestampFormatter {
    /// Web `date.toISOString()` — UTC, millisecond precision, trailing `Z`
    /// (`yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`).
    public static func iso8601(_ date: Date) -> String {
        isoStringFormatter().string(from: date)
    }

    /// Web `Math.floor(getTime() / 1000)`.
    public static func unixSeconds(_ date: Date) -> Int {
        TimestampMath.unixSeconds(date)
    }

    /// Web `formatDateTime(date)` →
    /// `toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric',
    /// hour:'2-digit', minute:'2-digit' })`. Reproduced with a locale-reordered
    /// template so the field set matches while the order/separators localize.
    public static func local(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }

    /// Web `getRelativeTime(date)`:
    /// ```
    /// diff = |now - date|; s = floor(diff/1000)
    /// s<60 → `${s}s ago`; m=floor(s/60) <60 → `${m}m ago`
    /// h=floor(m/60) <24 → `${h}h ago`; d=floor(h/24) → `${d}d ago`
    /// ```
    /// The unit suffixes are returned as a ``RelativeTime`` value so the view can
    /// localize them through the P1/S10 facade (the web hardcodes them; native
    /// keeps the identical English default but stays translatable).
    public static func relative(from date: Date, now: Date) -> RelativeTime {
        let diffSeconds = abs(now.timeIntervalSince1970 - date.timeIntervalSince1970)
        let seconds = Int(floor(diffSeconds))
        if seconds < 60 { return RelativeTime(unit: .seconds, value: seconds) }
        let minutes = seconds / 60
        if minutes < 60 { return RelativeTime(unit: .minutes, value: minutes) }
        let hours = minutes / 60
        if hours < 24 { return RelativeTime(unit: .hours, value: hours) }
        return RelativeTime(unit: .days, value: hours / 24)
    }

    /// UTC, millisecond-precision ISO formatter (web `toISOString` shape). Built
    /// per call to stay Sendable-safe under Swift-6 strict concurrency.
    private static func isoStringFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter
    }
}

/// A bucketed relative duration ("`value``unit` ago"), mirroring the web
/// `getRelativeTime` output. Kept as data (not a baked string) so the localized
/// rendering happens at the view boundary while the adapter stays presentation-free.
public struct RelativeTime: Equatable, Sendable {
    public enum Unit: String, Sendable {
        case seconds, minutes, hours, days
    }

    public let unit: Unit
    public let value: Int

    public init(unit: Unit, value: Int) {
        self.unit = unit
        self.value = value
    }

    /// The web-identical compact string ("5s ago", "2m ago", …) used as the
    /// localization default and in adapter tests.
    public var defaultText: String {
        switch unit {
        case .seconds: "\(value)s ago"
        case .minutes: "\(value)m ago"
        case .hours: "\(value)h ago"
        case .days: "\(value)d ago"
        }
    }
}

// MARK: - Projections (the rendered output rows)

/// The always-on live header — web `Math.floor(now/1000)` + `now.toISOString()`.
public struct TimestampNow: Equatable, Sendable {
    public let unixSeconds: Int
    public let iso: String

    public init(unixSeconds: Int, iso: String) {
        self.unixSeconds = unixSeconds
        self.iso = iso
    }
}

/// The rows the web shows under the Unix field when `fromUnix` is truthy:
/// Iso / Local / Relative.
public struct UnixInterpretation: Equatable, Sendable {
    public let date: Date
    public let iso: String
    public let local: String
    public let relative: RelativeTime

    public init(date: Date, iso: String, local: String, relative: RelativeTime) {
        self.date = date
        self.iso = iso
        self.local = local
        self.relative = relative
    }
}

/// The rows the web shows under the ISO field when `fromIso` is truthy:
/// Unix / Local / Relative.
public struct IsoInterpretation: Equatable, Sendable {
    public let date: Date
    public let unixSeconds: Int
    public let local: String
    public let relative: RelativeTime

    public init(date: Date, unixSeconds: Int, local: String, relative: RelativeTime) {
        self.date = date
        self.unixSeconds = unixSeconds
        self.local = local
        self.relative = relative
    }
}

/// Assembles the three rendered projections (live now + the two field
/// interpretations) from raw inputs, the current `now`, and the display locale +
/// timezone. Pure and deterministic given its arguments — the live-clock `now`
/// is injected so the projection is fully testable.
public enum TimestampProjector {
    /// The live header values for the current instant.
    public static func now(_ now: Date) -> TimestampNow {
        TimestampNow(
            unixSeconds: TimestampFormatter.unixSeconds(now),
            iso: TimestampFormatter.iso8601(now)
        )
    }

    /// The Unix-field interpretation, or `nil` when the input is empty/invalid
    /// (web `fromUnix` falsy → the block is hidden).
    public static func fromUnix(
        _ raw: String,
        now: Date,
        locale: Locale,
        timeZone: TimeZone
    ) -> UnixInterpretation? {
        guard let date = TimestampParser.parseUnix(raw) else { return nil }
        return UnixInterpretation(
            date: date,
            iso: TimestampFormatter.iso8601(date),
            local: TimestampFormatter.local(date, locale: locale, timeZone: timeZone),
            relative: TimestampFormatter.relative(from: date, now: now)
        )
    }

    /// The ISO-field interpretation, or `nil` when the input is empty/invalid
    /// (web `fromIso` falsy → the block is hidden).
    public static func fromISO(
        _ raw: String,
        now: Date,
        locale: Locale,
        timeZone: TimeZone
    ) -> IsoInterpretation? {
        guard let date = TimestampParser.parseISO(raw, timeZone: timeZone) else { return nil }
        return IsoInterpretation(
            date: date,
            unixSeconds: TimestampFormatter.unixSeconds(date),
            local: TimestampFormatter.local(date, locale: locale, timeZone: timeZone),
            relative: TimestampFormatter.relative(from: date, now: now)
        )
    }
}
