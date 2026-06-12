//
//  RangePicker.Adapter.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The Foundation-only core for the single-trigger date-range filter — the SwiftUI parity of
//  `components/forms/RangePicker.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam (the native shape of the web `t(key, default)`), the committed-range value type
//  (``RangePickerValue``, the web `RangePickerValue` `{ start, end }`), the connectivity axis
//  (``RangePickerConnection``), and the pure ISO date arithmetic the rest of the surface derives from —
//  the verbatim ports of the web module's `isoFromDate` / `dateFromIso` / `diffDaysInclusive` /
//  `formatRange`. No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum RangePickerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RangePicker"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias RangePickerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - RangePickerValue (web `RangePickerValue`)

/// A committed, inclusive ISO date range (`YYYY-MM-DD` strings) — the native peer of the web
/// `RangePickerValue`. A value type so the view, the state-holder, the source seam, and the pure projection
/// all agree on one shape and so `.onChange` can detect a commit cheaply.
public struct RangePickerValue: Sendable, Equatable {
    /// Inclusive start day (`YYYY-MM-DD`, web `start`).
    public let start: String
    /// Inclusive end day (`YYYY-MM-DD`, web `end`).
    public let end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }
}

// MARK: - RangePickerConnection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached selection). The web
/// component has no such axis; it is the native surface's always-render connectivity chip.
public enum RangePickerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - RangePickerDates (web `isoFromDate` / `dateFromIso` / `diffDaysInclusive` / `formatRange`)

/// The pure ISO date arithmetic the surface derives from — verbatim ports of the web module's local-day
/// helpers. Local-calendar construction (a fixed noon anchor) keeps `YYYY-MM-DD` from shifting across
/// timezones, exactly as the web `dateFromIso` builds `new Date(y, m-1, d)` from local fields.
public enum RangePickerDates {
    /// A Gregorian calendar in the supplied zone (default the user's). The single source of calendar truth so
    /// presets, the month grid, and the formatters all agree; tests inject a fixed zone for determinism.
    public static func gregorian(timeZone: TimeZone = .current) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// `YYYY-MM-DD` from a date's local calendar fields (web `isoFromDate`).
    public static func iso(from date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }

    /// A local-noon `Date` for a `YYYY-MM-DD` string (web `dateFromIso`); `nil` when the string is malformed.
    /// Noon anchoring means a day never rolls into its neighbour under a DST transition.
    public static func date(from iso: String, calendar: Calendar) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return calendar.date(from: components)
    }

    /// Inclusive day span between two ISO days, floored at 1 (web `diffDaysInclusive`).
    public static func diffDaysInclusive(start: String, end: String, calendar: Calendar) -> Int {
        guard let from = date(from: start, calendar: calendar),
              let to = date(from: end, calendar: calendar) else { return 1 }
        let fromDay = calendar.startOfDay(for: from)
        let toDay = calendar.startOfDay(for: to)
        let span = calendar.dateComponents([.day], from: fromDay, to: toDay).day ?? 0
        return max(1, span + 1)
    }

    /// A compact human range label (web `formatRange`): a single day shows once with its year; a span shows
    /// `start – end`, dropping the start year only when both ends share it.
    public static func formatRange(start: String, end: String, locale: Locale, calendar: Calendar) -> String {
        guard let from = date(from: start, calendar: calendar),
              let to = date(from: end, calendar: calendar) else { return start }
        if start == end { return monthDay(from, locale: locale, withYear: true) }
        let sameYear = calendar.component(.year, from: from) == calendar.component(.year, from: to)
        let head = monthDay(from, locale: locale, withYear: !sameYear)
        let tail = monthDay(to, locale: locale, withYear: true)
        return "\(head) – \(tail)"
    }

    /// `Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year? })` (web `fmt`).
    private static func monthDay(_ date: Date, locale: Locale, withYear: Bool) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate(withYear ? "MMMdyyyy" : "MMMd")
        return formatter.string(from: date)
    }
}
