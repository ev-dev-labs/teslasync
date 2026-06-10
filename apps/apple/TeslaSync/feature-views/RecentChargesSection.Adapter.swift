//
//  RecentChargesSection.Adapter.swift
//  TeslaSync — P4 feature view · 0296 · RecentChargesSection (Apple)
//
//  The testable projection core for the Recent Charges section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/RecentChargesSection.tsx plus the web helpers its
//  `useChargeColumns` cells are fed by: formatDateTime (lib/dateFormat.ts), fmtNumber / fmtInt
//  (lib/numberFormat.ts), convertEnergyFromSI (lib/unitConversion.ts), useFormatting.formatCurrency
//  (hooks/useFormatting.ts) and the local durationStr helper. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view), so the per-cell formatting and the
//  five-column row projection are all unit tested alone.
//
//  Parity notes (presentational leaf — formats verbatim, never rescales upstream):
//  the energy cell reads SI Wh, converts to kWh (wh / 1000) and renders at the GLOBAL number
//  precision (web fmtNumber default = 2) with a trailing " kWh"; the duration cell ports
//  durationStr (h = floor(min/60) raw, m = fmtInt(min % 60), "{h}h {m}m" / "{m}m"); the cost cell
//  is the currency symbol + fmtNumber at the USER precision, or the em-dash when null (web
//  `cost != null ? … : '—'`); the battery cell interpolates the raw SOC numbers JS-style
//  (`{start}% → {end}%` / `{start}%`); the date cell formats start_ts (em-dash when nil/invalid,
//  web `if (!iso || isNaN) return '—'`). SI Wh is read directly; conversion happens at the cell.
//

import Foundation

// MARK: - Reading (web `ChargingSession` fields the section consumes)

/// The charging-session fields the section renders — the native mirror of the web
/// `ChargingSession` prop (only the members `useChargeColumns` reads). `total_energy_added_wh`
/// is SI watt-hours; `duration_min` is minutes (the web column name); SOC values are percent.
/// Optionality matches the web API contract (`start_ts?`, `cost?`, `end_soc_pct | null`).
public struct RecentChargesSession: Identifiable, Equatable, Sendable {
    public let id: Int
    /// Web `s.start_ts` — the ISO timestamp `formatDateTime` renders (`'—'` when nil/invalid).
    public var startTs: String?
    /// Web `s.total_energy_added_wh` (SI Wh); the web coalesces `?? 0` at the cell.
    public var totalEnergyAddedWh: Double?
    /// Web `s.duration_min` (minutes) — the `durationStr` input.
    public var durationMin: Double
    /// Web `s.cost` — `formatCurrency(cost)` when present, else the em-dash.
    public var cost: Double?
    /// Web `s.start_soc_pct` (percent, non-null in the API contract).
    public var startSocPct: Double
    /// Web `s.end_soc_pct` (percent, nullable) — drives the `start → end` vs `start` battery cell.
    public var endSocPct: Double?

    public init(
        id: Int,
        startTs: String? = nil,
        totalEnergyAddedWh: Double? = nil,
        durationMin: Double = 0,
        cost: Double? = nil,
        startSocPct: Double = 0,
        endSocPct: Double? = nil
    ) {
        self.id = id
        self.startTs = startTs
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.durationMin = durationMin
        self.cost = cost
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
    }
}

// MARK: - Formatting prefs (the `useFormatting` + fmtNumber/global slices this surface needs)

/// The slice of the user's formatting preferences the section needs — the currency symbol +
/// user precision (web `useFormatting`: `settings.currency_symbol ?? '$'`, `decimal_precision ?? 2`),
/// the global number precision the energy cell uses (web `fmtNumber` default = 2), and the locale +
/// time zone the date / number formatters resolve against. Defaults reproduce the web defaults.
public struct RecentChargesFormatting: Equatable, Sendable {
    /// Web `useFormatting` currency symbol (`settings.currency_symbol` trimmed, else `'$'`).
    public var currencySymbol: String
    /// Web `useFormatting` user precision (`settings.decimal_precision ?? 2`) — the cost cell.
    public var currencyPrecision: Int
    /// Web `fmtNumber` default precision (`_globalPrecision = 2`) — the energy cell.
    public var numberPrecision: Int
    /// Display locale tag (web `setGlobalLocale`); empty/invalid falls back to `en_US`.
    public var locale: String?
    /// Display time zone identifier for the date cell; `nil` resolves to the device zone
    /// (the web `new Date(iso).toLocaleString()` browser-local behaviour).
    public var timeZoneIdentifier: String?

    public init(
        currencySymbol: String = "$",
        currencyPrecision: Int = 2,
        numberPrecision: Int = RecentChargesFormat.defaultNumberPrecision,
        locale: String? = nil,
        timeZoneIdentifier: String? = nil
    ) {
        self.currencySymbol = currencySymbol
        self.currencyPrecision = currencyPrecision
        self.numberPrecision = numberPrecision
        self.locale = locale
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    /// The web defaults (`$`, precision 2, device locale + zone).
    public static let `default` = RecentChargesFormatting()

    /// The resolved formatting locale — the configured tag, else `en_US` (the web
    /// `setGlobalLocale` fallback for empty/invalid tags).
    var resolvedLocale: Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en_US")
        }
        return Locale(identifier: locale)
    }

    /// The resolved date-rendering zone — the configured identifier, else the device zone.
    var resolvedTimeZone: TimeZone {
        guard let timeZoneIdentifier, let zone = TimeZone(identifier: timeZoneIdentifier) else {
            return .current
        }
        return zone
    }
}

// MARK: - Cell formatting (ports of the web helpers `useChargeColumns` calls)

/// Pure cell formatting ported from the web helpers so the rounding, grouping separators, unit
/// suffixes, SI energy conversion, duration composition and SOC interpolation match the source
/// exactly. All members are locale-aware where the web is and locale-independent where the web
/// uses a JS template literal (the raw SOC numbers).
public enum RecentChargesFormat {
    /// The em-dash the web renders for a missing date / cost (`formatDateTime` / the cost column).
    public static let dash = "—"
    /// The energy unit suffix (web `… kWh`, a space before it).
    public static let energyUnit = "kWh"
    /// The percent suffix the battery cell appends (web `${n}%`).
    public static let percent = "%"
    /// The arrow between the start and end SOC (web `${start}% → ${end}%`).
    public static let socArrow = "→"
    /// The hours suffix in `durationStr` (web `${h}h`).
    public static let hoursSuffix = "h"
    /// The minutes suffix in `durationStr` (web `${m}m`).
    public static let minutesSuffix = "m"
    /// Web `_globalPrecision` (the `fmtNumber` default the energy cell uses).
    public static let defaultNumberPrecision = 2

    /// Native port of `fmtNumber(value, decimals, locale)`: locale grouping, fixed fraction
    /// digits, half-away-from-zero rounding (the `Intl.NumberFormat`/`toLocaleString` default).
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value.isFinite ? value : 0)) ?? "0"
    }

    /// Native port of `fmtInt(value)` (`fmtNumber(value, 0)`).
    public static func integer(_ value: Double, locale: Locale) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Native port of a JS template-literal number (`${n}`): always a `.` decimal, no grouping,
    /// integers without a fraction (the raw SOC interpolation `${s.start_soc_pct}`).
    public static func jsNumber(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded(.towardZero), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    /// Web energy cell: `${fmtNumber(convertEnergyFromSI(wh ?? 0,'kWh'))} kWh` — Wh → kWh (÷1000)
    /// at the global number precision, with a space before the unit.
    public static func energyKWh(wh: Double?, formatting: RecentChargesFormatting) -> String {
        let kwh = (wh ?? 0) / 1000
        let text = number(kwh, decimals: formatting.numberPrecision, locale: formatting.resolvedLocale)
        return "\(text) \(energyUnit)"
    }

    /// Web `durationStr(minutes)`: `h = floor(min/60)` (raw), `m = fmtInt(min % 60)`;
    /// `h > 0 ? "{h}h {m}m" : "{m}m"`. The `h`/`m` suffixes are carried verbatim (web literals).
    public static func duration(minutes: Double, locale: Locale) -> String {
        let hours = Int((minutes / 60).rounded(.down))
        let mins = integer(minutes.truncatingRemainder(dividingBy: 60), locale: locale)
        if hours > 0 {
            return "\(hours)\(hoursSuffix) \(mins)\(minutesSuffix)"
        }
        return "\(mins)\(minutesSuffix)"
    }

    /// Web cost cell: `cost != null ? formatCurrency(cost) : '—'`; `formatCurrency` is the
    /// currency symbol directly followed by `fmtNumber(amount, userPrecision)` (no space).
    public static func currency(amount: Double?, formatting: RecentChargesFormatting) -> String {
        guard let amount else { return dash }
        let text = number(amount, decimals: formatting.currencyPrecision, locale: formatting.resolvedLocale)
        return "\(formatting.currencySymbol)\(text)"
    }

    /// Web battery cell: `end != null ? "{start}% → {end}%" : "{start}%"`, the SOC numbers
    /// interpolated JS-style (no grouping, integers without a fraction).
    public static func battery(startSocPct: Double, endSocPct: Double?) -> String {
        let start = "\(jsNumber(startSocPct))\(percent)"
        guard let endSocPct else { return start }
        return "\(start) \(socArrow) \(jsNumber(endSocPct))\(percent)"
    }

    /// Web `formatDateTime(iso)`: `'—'` when nil/empty/unparseable, else a locale-aware
    /// year · abbreviated-month · day · hour · minute string (the `Intl` options
    /// `{year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}`).
    public static func dateTime(iso: String?, formatting: RecentChargesFormatting) -> String {
        guard let iso, !iso.trimmingCharacters(in: .whitespaces).isEmpty else { return dash }
        guard let date = parseISO(iso) else { return dash }
        let formatter = DateFormatter()
        formatter.locale = formatting.resolvedLocale
        formatter.timeZone = formatting.resolvedTimeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }

    /// Parses an ISO-8601 timestamp (with or without fractional seconds), the web `new Date(iso)`.
    static func parseISO(_ value: String) -> Date? {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }
}

// MARK: - Column (the five web `useChargeColumns` entries)

/// The five columns the section renders, in web composition order. The case drives the i18n
/// header label, the per-row cell text, whether the column is sortable (web `sortable: true`
/// is set on `energy` alone) and — for the sortable column — the numeric sort key.
public enum RecentChargesColumn: String, CaseIterable, Sendable {
    case date
    case energy
    case duration
    case cost
    case battery

    /// The i18n key for the header (web `t(key, default)`), reusing the web `common.*` namespace.
    public var labelKey: String {
        switch self {
        case .date: "common.date"
        case .energy: "common.energy"
        case .duration: "common.duration"
        case .cost: "common.cost"
        case .battery: "common.battery"
        }
    }

    /// The web English fallback for the header.
    public var labelFallback: String {
        switch self {
        case .date: "Date"
        case .energy: "Energy"
        case .duration: "Duration"
        case .cost: "Cost"
        case .battery: "Battery"
        }
    }

    /// Whether the column header offers sorting (web sets `sortable: true` on `energy` only).
    public var isSortable: Bool {
        self == .energy
    }

    /// The pre-formatted cell text for a projected row.
    public func cell(_ row: RecentChargesRow) -> String {
        switch self {
        case .date: row.date
        case .energy: row.energy
        case .duration: row.duration
        case .cost: row.cost
        case .battery: row.battery
        }
    }

    /// The numeric sort key for a row (the underlying SI Wh on `energy`; `nil` for the
    /// non-sortable columns), so the shared table sorts on the value, not the formatted text.
    public func sortKey(_ row: RecentChargesRow) -> Double? {
        self == .energy ? row.energySortKey : nil
    }

    /// The stable comparator the shared `TSColumn` takes — present only for the sortable column.
    public func makeComparator() -> ((RecentChargesRow, RecentChargesRow) -> ComparisonResult)? {
        guard isSortable else { return nil }
        return { lhs, rhs in
            let left = sortKey(lhs) ?? 0
            let right = sortKey(rhs) ?? 0
            if left < right { return .orderedAscending }
            if left > right { return .orderedDescending }
            return .orderedSame
        }
    }
}

// MARK: - Row (one projected session: id + the five pre-formatted cells)

/// The view-ready projection of one charging session — its stable id (web `keyExtractor = s.id`)
/// and the five pre-formatted cell strings, plus the numeric energy sort key the sortable column
/// orders on. `Identifiable` over the session id so the table is stable.
public struct RecentChargesRow: Identifiable, Equatable, Sendable {
    public let id: Int
    public let date: String
    public let energy: String
    /// The underlying SI Wh, so the sortable energy header orders by value, not the "X kWh" text.
    public let energySortKey: Double
    public let duration: String
    public let cost: String
    public let battery: String

    public init(
        id: Int,
        date: String,
        energy: String,
        energySortKey: Double,
        duration: String,
        cost: String,
        battery: String
    ) {
        self.id = id
        self.date = date
        self.energy = energy
        self.energySortKey = energySortKey
        self.duration = duration
        self.cost = cost
        self.battery = battery
    }
}

// MARK: - Projection (web render values for the DataTable rows)

/// The resolved, view-ready set of table rows — a pure function of the sessions + the user's
/// formatting preferences, reproducing each web cell renderer. The view feeds `rows` straight to
/// the shared table, so it holds no formatting logic.
public struct RecentChargesProjection: Equatable, Sendable {
    public let rows: [RecentChargesRow]

    public init(rows: [RecentChargesRow]) {
        self.rows = rows
    }

    /// Builds one row per session, porting the five web cell expressions (date · energy · duration
    /// · cost · battery). The energy sort key carries the raw SI Wh (`?? 0`, the web cell default).
    public static func make(
        sessions: [RecentChargesSession],
        formatting: RecentChargesFormatting
    ) -> RecentChargesProjection {
        let locale = formatting.resolvedLocale
        let rows = sessions.map { session in
            RecentChargesRow(
                id: session.id,
                date: RecentChargesFormat.dateTime(iso: session.startTs, formatting: formatting),
                energy: RecentChargesFormat.energyKWh(wh: session.totalEnergyAddedWh, formatting: formatting),
                energySortKey: session.totalEnergyAddedWh ?? 0,
                duration: RecentChargesFormat.duration(minutes: session.durationMin, locale: locale),
                cost: RecentChargesFormat.currency(amount: session.cost, formatting: formatting),
                battery: RecentChargesFormat.battery(startSocPct: session.startSocPct, endSocPct: session.endSocPct)
            )
        }
        return RecentChargesProjection(rows: rows)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a row from its column labels + already-resolved cell
/// strings, pairing each label with its value so the spoken row reads "Date …, Energy …, …".
/// Pure + public so the spoken content is asserted without rendering; empty fragments are dropped
/// so the phrase never reads a stray comma.
public enum RecentChargesAccessibility {
    public static func rowSummary(labels: [String], values: [String]) -> String {
        zip(labels, values)
            .map { label, value in [label, value].filter { !$0.isEmpty }.joined(separator: " ") }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
