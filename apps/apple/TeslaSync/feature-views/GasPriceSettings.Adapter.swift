//
//  GasPriceSettings.Adapter.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  The testable projection core for the Gas Price Auto-Poll settings surface — the
//  SwiftUI parity of features/settings/components/GasPriceSettings.tsx and the web
//  helpers it is fed by: `formatCurrency` (hooks/useFormatting.ts → numberFormat.ts
//  `fmtNumber`), the `gas_unit` → `'L' | 'gal'` label, and `formatDateTime`
//  (lib/dateFormat.ts). Everything here is pure and dependency-free (no store, no
//  bundle, no rendered view) so the poll-interval catalogue, the currency / unit
//  rendering, the Go zero-time "Never" sentinel, and the VoiceOver summaries are all
//  unit tested in isolation.
//
//  Parity note: the web panel reads the `GasPriceStatus` envelope (`/gas-price/status`
//  via api/hooks/useSettings.ts) — `enabled`, `poll_interval`, `current_price`,
//  `last_poll_time` — and renders the price as `${formatCurrency(current_price)}/${unit}`
//  (falling back to `—` when the price is falsy) and the timestamp through
//  `formatDateTime` (falling back to `Never` for a missing value or the Go zero-time
//  `0001-01-01T00:00:00Z`). This core reproduces that shaping verbatim; the values are
//  read SI-free strings/numbers from the API, so no unit conversion applies here.
//

import Foundation

// MARK: - Poll interval (web `<Select>` options: daily / 7d / 15d / 30d)

/// The four poll cadences offered by the web `<Select>` — the native mirror of its
/// option values. The raw value is the exact wire token the API stores
/// (`poll_interval`); `daily` is the literal `"daily"`, the others are day counts.
public enum GasPollInterval: String, Sendable, Equatable, CaseIterable, Identifiable {
    case daily
    case weekly = "7d"
    case biweekly = "15d"
    case monthly = "30d"

    public var id: String {
        rawValue
    }

    /// Defensive parse for the loosely-typed `poll_interval` string. Mirrors the web
    /// `gasPriceStatus?.poll_interval || '7d'`: a missing / unknown token collapses to
    /// the weekly (`7d`) default.
    public static func parse(_ value: String?) -> GasPollInterval {
        GasPollInterval(rawValue: value ?? "") ?? .weekly
    }

    /// The i18n key for this option's label (web `t(key, default)`).
    public var labelKey: String {
        switch self {
        case .daily: "gas.daily"
        case .weekly: "gas.weekly"
        case .biweekly: "gas.biweekly"
        case .monthly: "gas.monthly"
        }
    }

    /// The web English fallback for this option's label.
    public var labelFallback: String {
        switch self {
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .biweekly: "Bi-weekly"
        case .monthly: "Monthly"
        }
    }
}

// MARK: - Gas-price record (web `GasPriceStatus` from useSettings.ts)

/// One resolved gas-price status snapshot — the native mirror of the web
/// `GasPriceStatus`. `enabled` / `pollInterval` back the controls; `currentPrice` is
/// the EIA average in the user's currency per gas unit; `lastPollTime` is the
/// envelope's `last_poll_time` parsed to a `Date` (nil when never polled or the Go
/// zero-time sentinel).
public struct GasPriceRecord: Equatable, Sendable {
    public var enabled: Bool
    public var pollInterval: GasPollInterval
    public var currentPrice: Double
    public var lastPollTime: Date?

    public init(
        enabled: Bool = false,
        pollInterval: GasPollInterval = .weekly,
        currentPrice: Double = 0,
        lastPollTime: Date? = nil
    ) {
        self.enabled = enabled
        self.pollInterval = pollInterval
        self.currentPrice = currentPrice
        self.lastPollTime = lastPollTime
    }
}

// MARK: - Formatting context (web `useFormatting` + `useSettings` inputs)

/// The display-formatting context the projection needs — the native mirror of the web
/// `useFormatting()` (`currencySymbol`, `decimal_precision`) and `useSettings()`
/// (`gas_unit`). Injected so the rendered output is deterministic under test. These
/// are presentation preferences, not telemetry, so no SI conversion is involved.
public struct GasPriceFormatting: Equatable, Sendable {
    public var currencySymbol: String
    public var gasUnit: String
    public var decimals: Int

    public init(currencySymbol: String = "$", gasUnit: String = "gallon", decimals: Int = 2) {
        self.currencySymbol = currencySymbol
        self.gasUnit = gasUnit
        self.decimals = decimals
    }

    /// The per-unit suffix (web `settings.gas_unit === 'liter' ? 'L' : 'gal'`).
    public var unitLabel: String {
        gasUnit.lowercased() == "liter" ? "L" : "gal"
    }
}

// MARK: - Formatting (ports of formatCurrency / fmtNumber / formatDateTime + sentinels)

/// Pure string shaping ported from the web source so the currency rendering, the unit
/// suffix, the `—` price fallback, the "Never" timestamp sentinel, and the date
/// wording match exactly. Locale + time zone are injectable for deterministic tests.
public enum GasPriceFormat {
    /// The em-dash sentinel the web renders for a falsy current price.
    public static let dash = "—"

    /// The Go zero-time the API emits when gas prices have never been polled; the web
    /// treats it (and a missing value) as "Never".
    public static let zeroTime = "0001-01-01T00:00:00Z"

    /// Native port of `formatCurrency(amount)` (useFormatting.ts → `fmtNumber`): the
    /// currency glyph prepended to a grouped, fixed-fraction number. Mirrors
    /// `toLocaleString` (grouping on, `minimumFractionDigits == maximumFractionDigits`).
    public static func currency(
        _ amount: Double,
        formatting: GasPriceFormatting,
        locale: Locale = .current
    ) -> String {
        let decimals = max(0, formatting.decimals)
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        let safe = amount.isFinite ? amount : 0
        let number = formatter.string(from: NSNumber(value: safe)) ?? "0"
        return "\(formatting.currencySymbol)\(number)"
    }

    /// The current-price cell (web `current_price ? \`${formatCurrency(price)}/${unit}\` : '—'`).
    /// A non-positive / non-finite price renders the em-dash, exactly like the web's
    /// falsy check.
    public static func price(
        _ amount: Double,
        formatting: GasPriceFormatting,
        locale: Locale = .current
    ) -> String {
        guard amount.isFinite, amount > 0 else { return dash }
        return "\(currency(amount, formatting: formatting, locale: locale))/\(formatting.unitLabel)"
    }

    /// Native port of `formatDateTime` (dateFormat.ts): a locale-aware "abbreviated
    /// month, day, year, time" string (the web `toLocaleString` template `yMMMdjmm`).
    public static func dateTime(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }

    /// Parses the API `last_poll_time` into a `Date`, reproducing the web "Never" check:
    /// a nil / empty value, or the Go zero-time sentinel, yields `nil`; any other valid
    /// RFC 3339 / ISO 8601 timestamp parses to its `Date`.
    public static func parseTimestamp(_ raw: String?) -> Date? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty, trimmed != zeroTime
        else {
            return nil
        }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the info cells, the auto-poll toggle, and the help
/// trigger from already-localised parts, so the spoken content is asserted without
/// rendering the view.
public enum GasPriceAccessibility {
    /// The per-cell spoken label: "{label}, {value}".
    public static func infoLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }

    /// The auto-poll toggle spoken label: "{label}, {state}".
    public static func toggleLabel(label: String, state: String) -> String {
        "\(label), \(state)"
    }

    /// The help trigger's spoken label: "{format} → Help for {field}" (web `aria-label`).
    public static func helpLabel(format: String, field: String) -> String {
        String(format: format, field)
    }
}
