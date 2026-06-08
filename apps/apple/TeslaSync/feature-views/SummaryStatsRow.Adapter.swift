//
//  SummaryStatsRow.Adapter.swift
//  TeslaSync — P4 feature view · 0048 · SummaryStatsRow (Apple)
//
//  The testable projection core for the security-access summary stats row — the
//  SwiftUI parity of features/admin/components/security-access/SummaryStatsRow.tsx
//  plus the two web helpers it is fed by: `timeSince` (helpers.ts) and `fmtInt`
//  (lib/numberFormat.ts). Everything here is pure + dependency-free (no store, no
//  bundle, no rendered view) so the relative-time bucketing, the locale number
//  formatting, the tile model, the responsive column math, and the VoiceOver
//  summaries are all unit tested in isolation.
//
//  i18n note: the web `timeSince` returns hardcoded English ("just now", "Nm ago").
//  Native code must not embed English literals, so this core reduces the elapsed
//  span to a semantic `SummaryRelativeTime` bucket and lets the view resolve the
//  words through the P1/S10 facade. Locale-formatted digits (the "%" value and the
//  event count) are not prose, so they are pre-formatted here and rendered verbatim.
//

import Foundation

// MARK: - Relative time (port of helpers.ts `timeSince`)

/// The bucketed elapsed-time result of the web `timeSince(iso)` ladder, reduced to
/// a semantic case so the view can localise the wording. `.none` is the web `'—'`
/// sentinel (missing/undefined timestamp, a future timestamp, or an unparseable
/// value).
public enum SummaryRelativeTime: Equatable, Sendable {
    case none
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
}

/// Pure relative-time + number formatting, ported verbatim from the web helpers so
/// the bucket boundaries and rounding match the source exactly.
public enum SummaryStatsFormat {
    /// The em-dash sentinel the web `timeSince` returns for missing/invalid input.
    public static let dash = "—"

    /// Native port of `timeSince(iso)` (helpers.ts): floors the elapsed span and
    /// buckets it as just-now / minutes / hours / days. Returns `.none` for a nil
    /// or empty string, a timestamp in the future (web `diff < 0`), or a value that
    /// cannot be parsed (the web would cascade `NaN`; the dash is the sane parity,
    /// matching the source's own missing-value branch).
    public static func relativeTime(_ iso: String?, now: Date) -> SummaryRelativeTime {
        guard let iso, !iso.isEmpty, let date = parseISO(iso) else { return .none }
        let elapsed = now.timeIntervalSince(date)
        if elapsed < 0 { return .none }
        let seconds = Int(elapsed.rounded(.down))
        if seconds < 60 { return .justNow }
        let minutes = seconds / 60
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        return .days(hours / 24)
    }

    /// Locale integer with grouping separators — native port of `fmtInt`
    /// (`fmtNumber(v, 0)`): non-finite coerces to 0 (web `safeNumber`), rounds half
    /// away from zero (web `toLocaleString` default), zero fraction digits.
    public static func integer(_ value: Double, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// The Sentry-uptime value: `${fmtInt(value)}%` (web template literal).
    public static func percent(_ value: Double, locale: Locale = .current) -> String {
        integer(value, locale: locale) + "%"
    }

    /// The total-events value. The web renders `value={totalEvents}` — the raw
    /// number coerced by React, i.e. no grouping separators — so this mirrors
    /// `String(n)` rather than `fmtInt`.
    public static func count(_ value: Int) -> String {
        String(value)
    }

    private static func parseISO(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: raw) { return date }
        if let epoch = Double(raw) { return Date(timeIntervalSince1970: epoch) }
        return nil
    }
}

// MARK: - Accent (web `MetricCard color` → brand token role)

/// The semantic accent for each tile — the native mapping of the web `MetricCard`
/// `color` prop (a `NeonColor`) onto a brand token role. ADR-006 parity is semantic,
/// not literal: the view resolves each case to a design-token `Color`, never a
/// ported Tailwind hex.
public enum SummaryStatAccent: String, Sendable, Equatable, CaseIterable {
    case secure // web 'green'
    case unsecure // web 'red'
    case lastLock // web 'cyan'
    case uptime // web 'blue'
    case events // web 'purple'
}

// MARK: - Tile model (web `<MetricCard>` props)

/// One resolved metric tile — the native mirror of a single web `<MetricCard>` with
/// its `label` / `value` / `icon` / `color`. The label is carried as an i18n key +
/// English fallback (resolved in the view), and the value is a semantic case so the
/// status wording and the relative-time wording localise at the display boundary
/// while numeric values stay pre-formatted.
public struct SummaryStatTile: Identifiable, Equatable, Sendable {
    /// The display value, kept semantic where the wording is localised.
    public enum Value: Equatable, Sendable {
        /// Status card: the view resolves `Secure` / `Unsecure` (web ternary).
        case secure(Bool)
        /// Last-lock card: the view localises the relative-time bucket.
        case relative(SummaryRelativeTime)
        /// Pre-formatted, locale-stable text (the uptime "%" and the event count).
        case text(String)
    }

    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: Value
    public let accent: SummaryStatAccent
    public let symbol: String

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: Value,
        accent: SummaryStatAccent,
        symbol: String
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.accent = accent
        self.symbol = symbol
    }
}

// MARK: - Responsive layout (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`)

/// The responsive column math, ported from the web Tailwind grid so it is unit
/// testable and identical across iPhone / iPad / Mac widths. Tailwind breakpoints
/// are CSS pixels: `sm` = 640, `lg` = 1024.
public enum SummaryStatsLayout {
    public static let smBreakpoint: CGFloat = 640
    public static let lgBreakpoint: CGFloat = 1024

    /// Columns for an available width: 1 below `sm`, 2 below `lg`, 4 at/above `lg`
    /// (web `grid-cols-1` / `sm:grid-cols-2` / `lg:grid-cols-4`).
    public static func columnCount(forWidth width: CGFloat) -> Int {
        if width >= lgBreakpoint { return 4 }
        if width >= smBreakpoint { return 2 }
        return 1
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the combined VoiceOver string for a tile ("{label}, {value}") so the
/// spoken content is asserted without rendering the view.
public enum SummaryStatsAccessibility {
    public static func tileLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}
