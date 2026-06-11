//
//  ChartTooltip.Adapter.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  The testable, dependency-light core for the chart value readout — the SwiftUI parity of
//  `components/charts/ChartTooltip.tsx`. Everything here is pure (Foundation only): the value /
//  label payload model (the native mirror of the web `TooltipPayload` + `label`), and the
//  verbatim port of the web component's two default formatters — `defaultLabelFormatter`
//  (ISO-timestamp detection → locale + timezone-aware date/time, else pass-through) and
//  `defaultValueFormatter` (locale-aware number formatting via the `fmtNumber` contract, else
//  `String(value ?? "")`). No store, no bundle, no rendered view, so each piece is unit tested
//  in isolation.
//
//  Parity note: the web `ChartTooltip` is a Recharts custom tooltip. It renders nothing while
//  inactive or while its payload is empty (`if (!active || !payload?.length) return null`),
//  otherwise it draws a floating panel — a formatted label header over one row per series
//  (a colored dot, the series name, and the formatted value + unit). This core reproduces that
//  exact data and the read-time formatting the component performs; the gating + chrome live in
//  the projection (Model) and the views.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity-fallback
/// resolver.
public typealias ChartTooltipResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Value (web `TooltipPayload.value: unknown`)

/// One series value — the native mirror of the web payload's `unknown` value. The web default
/// formatter renders numbers through `fmtNumber` and everything else through `String(value ?? "")`,
/// so the three cases here capture exactly the branches that matter: a finite number, an
/// already-stringified value, and the nullish case that renders as an empty string.
public enum ChartTooltipValue: Sendable, Equatable {
    case number(Double)
    case text(String)
    case empty
}

// MARK: - Label (web `label?: string | number`)

/// The tooltip's label (web `label`) — the x-axis category or timestamp the hovered point sits
/// on. `absent` is the web `undefined`; `text` is a string label (possibly an ISO timestamp);
/// `number` is a numeric category. The default formatter ISO-detects only the string case.
public enum ChartTooltipLabel: Sendable, Equatable {
    case absent
    case text(String)
    case number(Double)
}

// MARK: - Series (web `TooltipPayload`)

/// One payload row — the native mirror of a web `TooltipPayload`: the series `name`, its `value`,
/// an optional `unit`, and a palette `colorIndex` (the index-stable native parity of the web
/// `color || fill` swatch, which the design tokens resolve identically across platforms). `id`
/// is the stable identity the row list keys on (the web `${name}-${i}` key).
public struct ChartTooltipSeries: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let value: ChartTooltipValue
    public let unit: String?
    public let colorIndex: Int

    public init(id: String, name: String, value: ChartTooltipValue, unit: String? = nil, colorIndex: Int = 0) {
        self.id = id
        self.name = name
        self.value = value
        self.unit = unit
        self.colorIndex = colorIndex
    }
}

// MARK: - Formatting (verbatim port of the web default formatters)

/// The pure formatting core — the native port of the web component's `isIsoTimestamp`,
/// `defaultLabelFormatter`, and `defaultValueFormatter`. Every function is deterministic and
/// dependency-light so the rendered output is asserted without a view. Defaults match the web
/// `numberFormat` globals (precision 2, `en-US` locale) so the surface formats identically to
/// the web out of the box; the production app threads the user's locale + vehicle timezone in.
public enum ChartTooltipFormat {
    /// Web `numberFormat._globalPrecision` default.
    public static let defaultPrecision = 2

    /// Web `numberFormat._globalLocale` default.
    public static let defaultLocaleIdentifier = "en_US"

    /// Heuristic mirror of the web `ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/`: the value must
    /// begin with at least `YYYY-MM-DDTHH:MM` so plain date strings like "Apr 4" or "HH:MM"
    /// axis labels never trigger date formatting. Scans the leading ASCII bytes directly, the
    /// allocation-free equivalent of the anchored regex `test`.
    public static func isIsoTimestamp(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count >= 16 else { return false }
        func digit(_ index: Int) -> Bool {
            bytes[index] >= 0x30 && bytes[index] <= 0x39
        }
        func match(_ index: Int, _ ascii: UInt8) -> Bool {
            bytes[index] == ascii
        }
        let datePart = digit(0) && digit(1) && digit(2) && digit(3)
            && match(4, 0x2D) && digit(5) && digit(6)
            && match(7, 0x2D) && digit(8) && digit(9)
        let timePart = match(10, 0x54) && digit(11) && digit(12)
            && match(13, 0x3A) && digit(14) && digit(15)
        return datePart && timePart
    }

    /// Locale-aware number formatting — the native parity of `fmtNumber`: a fixed number of
    /// fraction digits (clamped 0...20, web `setGlobalPrecision`) with locale grouping
    /// separators, and the `safeNumber` fallback to `0` for non-finite input.
    public static func number(
        _ value: Double,
        precision: Int = defaultPrecision,
        locale: Locale = Locale(identifier: defaultLocaleIdentifier)
    ) -> String {
        let clamped = max(0, min(20, precision))
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = clamped
        formatter.maximumFractionDigits = clamped
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }

    /// Locale + timezone-aware ISO timestamp formatting — the native parity of `formatDateTime`
    /// ("Apr 4, 2026, 2:30 PM" in `en-US`). Returns `nil` when the value does not parse as a
    /// date, so the label formatter can fall back to the raw string exactly as the web does.
    public static func dateTime(
        _ iso: String,
        locale: Locale = Locale(identifier: defaultLocaleIdentifier),
        timeZone: TimeZone = .current
    ) -> String? {
        guard let date = parseISO(iso) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    /// The native parity of `defaultLabelFormatter`: `absent` → empty string (web `null` →
    /// `''`); a string label that looks like an ISO timestamp → the formatted date/time; any
    /// other string → itself; a numeric label → its plain `String(label)` form.
    public static func formatLabel(
        _ label: ChartTooltipLabel,
        locale: Locale = Locale(identifier: defaultLocaleIdentifier),
        timeZone: TimeZone = .current
    ) -> String {
        switch label {
        case .absent:
            return ""
        case let .number(value):
            return plainNumberString(value)
        case let .text(text):
            if isIsoTimestamp(text), let formatted = dateTime(text, locale: locale, timeZone: timeZone) {
                return formatted
            }
            return text
        }
    }

    /// The value portion of `defaultValueFormatter`: a number → `fmtNumber`; an already-string
    /// value → itself; the nullish case → the empty string (web `String(value ?? "")`). The unit
    /// suffix is rendered separately by the view so it can carry the web `opacity-60` styling.
    public static func valueString(
        _ value: ChartTooltipValue,
        precision: Int = defaultPrecision,
        locale: Locale = Locale(identifier: defaultLocaleIdentifier)
    ) -> String {
        switch value {
        case let .number(number):
            self.number(number, precision: precision, locale: locale)
        case let .text(text):
            text
        case .empty:
            ""
        }
    }

    // MARK: Private

    /// Plain, separator-free numeric string — the parity of JavaScript `String(Number)` for a
    /// numeric label (integers render without a decimal, fractions keep their digits).
    private static func plainNumberString(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// Parses the ISO 8601 timestamps the backend emits (web `new Date(iso)`): zoned internet
    /// date-times with or without fractional seconds, plus the zone-less `…THH:MM[:SS]` forms
    /// used by some axis labels (interpreted as UTC).
    private static func parseISO(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }

        let internet = ISO8601DateFormatter()
        internet.formatOptions = [.withInternetDateTime]
        if let date = internet.date(from: iso) { return date }

        for format in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateFormat = format
            if let date = formatter.date(from: iso) { return date }
        }
        return nil
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localized + already-formatted parts, so
/// the spoken content is asserted without rendering the view. The web panel is one `role="tooltip"`
/// element; its native parity reads the label then each "name: value unit" row as one sentence.
public enum ChartTooltipAccessibility {
    /// One row's label: "{name}: {value} {unit}", or "{name}: {value}" when the series carries
    /// no unit — so VoiceOver never lands on a bare number.
    public static func rowLabel(name: String, value: String, unit: String?) -> String {
        if let unit, !unit.isEmpty {
            return "\(name): \(value) \(unit)"
        }
        return "\(name): \(value)"
    }

    /// The whole panel's label: the formatted header label (when present) followed by the row
    /// labels, joined so the readout reads as a single coherent announcement.
    public static func summary(label: String, rows: [String]) -> String {
        let header = label.isEmpty ? "" : "\(label). "
        return header + rows.joined(separator: ", ")
    }
}
