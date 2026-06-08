//
//  EfficiencyPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0102 · EfficiencyPanel (Apple)
//
//  The pure cached → metric-grid projection (no SwiftUI, no networking) for the
//  Charging Efficiency surface — the native port of
//  features/charging/components/charging-list/EfficiencyPanel.tsx and the
//  `EfficiencyStats` shape its parent computes in ./helpers.ts. The web component
//  is a presentational leaf fed a non-null `stats` prop; this file reproduces the
//  exact numbers it renders — `fmtPercent` (avg / best / worst), `fmtWithUnit(…,
//  'kWh')` (wall loss), `fmtNumber` (used → added), and `formatDateTime` (best /
//  worst session timestamps) — at the web default precision (2 fraction digits,
//  en-US locale). All formatting is dependency-free so it can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Render phase (web shell loading / content / empty / error branches)

/// The mutually-exclusive render branches the surface switches over. The web source
/// only renders the resolved panel (its parent renders it solely when `stats` is
/// non-null), so the loading / empty / error branches are the Apple HIG states
/// contract layered over that single web rendering.
public enum EfficiencyPanelPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Accent (semantic only — mapped to a `Color.TS` token at the view layer)

/// The semantic accent for a metric tile's value, mirroring the web per-tile text
/// color (`text-cyan-300` / `text-emerald-300` / `text-rose-300` / `text-amber-300`).
/// Kept free of SwiftUI so the projection stays pure; `EfficiencyPanel.Views` maps
/// each case to a `Color.TS` design token.
public enum EfficiencyMetricAccent: Sendable, Equatable {
    case cyan
    case emerald
    case rose
    case amber
}

// MARK: - Tile footer (web per-card third row)

/// The bottom row of a metric tile. The web average tile renders a proportional bar
/// (`width: min(avg, 100)%`); the best / worst / wall-loss tiles render a muted
/// detail line (a formatted timestamp, or the `used → added` energy summary).
public enum EfficiencyMetricFooter: Sendable, Equatable {
    /// Proportional bar (web `bg-neon-cyan` fill), `fraction` already clamped to 0…1.
    case progress(fraction: Double)
    /// Muted detail line (web `formatDateTime(...)` or the `used → added` summary).
    case detail(String)
}

// MARK: - Metric tile (one of the four cells)

/// One resolved metric tile (web inner `GlassPanel` cell). Strings are already
/// localized + formatted; `accessibilityLabel` is the composed VoiceOver summary;
/// `accent` is mapped to a design-token color at the view layer.
public struct EfficiencyMetricModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let footer: EfficiencyMetricFooter
    public let accent: EfficiencyMetricAccent
    public let accessibilityLabel: String

    public init(
        id: String,
        label: String,
        value: String,
        footer: EfficiencyMetricFooter,
        accent: EfficiencyMetricAccent,
        accessibilityLabel: String
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.footer = footer
        self.accent = accent
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Stats input (web `EfficiencyStats` subset the panel reads)

/// The cached efficiency summary the panel renders (web `EfficiencyStats`). Only the
/// fields the four tiles read are modeled. The web computes these in
/// `computeEfficiencyStats`; here they arrive pre-computed from the bound state
/// holder, so the projection only formats them — exactly like the web leaf.
public struct EfficiencyPanelInput: Sendable, Equatable {
    public var count: Int
    public var avgEfficiency: Double
    public var bestEfficiency: Double
    public var bestDate: Date?
    public var worstEfficiency: Double
    public var worstDate: Date?
    public var wallLoss: Double
    public var totalUsed: Double
    public var totalAdded: Double

    public init(
        count: Int,
        avgEfficiency: Double,
        bestEfficiency: Double,
        bestDate: Date?,
        worstEfficiency: Double,
        worstDate: Date?,
        wallLoss: Double,
        totalUsed: Double,
        totalAdded: Double
    ) {
        self.count = count
        self.avgEfficiency = avgEfficiency
        self.bestEfficiency = bestEfficiency
        self.bestDate = bestDate
        self.worstEfficiency = worstEfficiency
        self.worstDate = worstDate
        self.wallLoss = wallLoss
        self.totalUsed = totalUsed
        self.totalAdded = totalAdded
    }
}

// MARK: - Formatting (web `lib/numberFormat.ts` + `lib/dateFormat.ts` parity)

/// Pure formatters reproducing the web helpers the panel uses, at the web defaults
/// (`_globalPrecision = 2`, `_globalLocale = 'en-US'`). `safe()` guards non-finite
/// values exactly like the web `safeNumber`, and `fmtNumber` uses the JS
/// `toLocaleString` half-away-from-zero rounding + grouping separators.
public enum EfficiencyFormat {
    /// The em-dash the web renders for an absent value (`'—'`).
    public static let dash = "—"
    /// The energy unit symbol the web hardcodes for the wall-loss tile (`'kWh'`).
    public static let kilowattHourSymbol = "kWh"
    /// The arrow the web renders between the used and added energy (`'→'`).
    public static let flowArrow = "→"
    /// The web default fraction-digit precision (`_globalPrecision = 2`).
    public static let defaultPrecision = 2

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed
    /// number of fraction digits, with `toLocaleString` half-away-from-zero rounding
    /// and the `safeNumber` non-finite → 0 guard. `locale` defaults to en-US.
    public static func fmtNumber(
        _ value: Double,
        decimals: Int = defaultPrecision,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Web `fmtPercent(v)`: `fmtNumber(v)` with a trailing `%`.
    public static func fmtPercent(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        "\(fmtNumber(value, locale: locale))%"
    }

    /// Web `fmtWithUnit(v, unit)`: `fmtNumber(v)` with a trailing unit symbol.
    public static func fmtWithUnit(
        _ value: Double,
        unit: String,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        "\(fmtNumber(value, locale: locale)) \(unit)"
    }

    /// Web `formatDateTime(iso)`: a localized medium date + short time, with the
    /// `'—'` fallback when the timestamp is absent (the web nil / invalid guard).
    public static func formatDateTime(
        _ date: Date?,
        locale: Locale = Locale(identifier: "en-US"),
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Projection (web render branches → the four tiles + header)

/// Projects the cached efficiency stats into the four localized, pre-formatted tiles
/// and the header session count. An absent input (`nil`) reproduces a friendly empty
/// rendering — em-dash values and a zero-width bar — so the grid never reads blank.
public enum EfficiencyProjection {
    /// The header session count (web `stats.count`), or `nil` when there is no data.
    public static func headerCount(from input: EfficiencyPanelInput?) -> Int? {
        input?.count
    }

    /// Builds the four tiles in the exact web order (average / best / worst / wall
    /// loss). `localize` is the P1/S10 `t(key, fallback)` facade; passing an echo
    /// (returns the fallback) yields the web English labels.
    public static func metrics(
        from input: EfficiencyPanelInput?,
        localize: (String, String) -> String,
        locale: Locale = Locale(identifier: "en-US"),
        timeZone: TimeZone = .current
    ) -> [EfficiencyMetricModel] {
        [
            averageTile(input, localize, locale),
            bestTile(input, localize, locale, timeZone),
            worstTile(input, localize, locale, timeZone),
            wallLossTile(input, localize, locale)
        ]
    }

    /// Resolves the render phase. The skeleton shows only on the initial fetch (no
    /// cached stats); a resolved payload renders content; a resolved-but-empty payload
    /// renders the em-dash tiles; a failure with cached data stays content (the chip /
    /// banner flag staleness), and a failure with no cached data shows the retryable
    /// error — mirroring the web shell + the Apple HIG states contract.
    public static func resolvePhase(
        _ status: EfficiencyPanelLoadStatus,
        hasValue: Bool
    ) -> EfficiencyPanelPhase {
        switch status {
        case .loading:
            hasValue ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasValue ? .content : .empty
        case let .failed(message):
            hasValue ? .content : .error(message)
        }
    }

    // MARK: Tiles (web `<GlassPanel>` cells, in source order)

    /// Average Efficiency (web `fmtPercent(stats.avgEfficiency)` + the proportional
    /// bar at `min(avgEfficiency, 100)%`).
    private static func averageTile(
        _ input: EfficiencyPanelInput?,
        _ localize: (String, String) -> String,
        _ locale: Locale
    ) -> EfficiencyMetricModel {
        let label = localize("charging.efficiency.average", "Average Efficiency")
        let value = input.map { EfficiencyFormat.fmtPercent($0.avgEfficiency, locale: locale) }
            ?? EfficiencyFormat.dash
        let fraction = input.map { min(max(EfficiencyFormat.safe($0.avgEfficiency), 0), 100) / 100 } ?? 0
        return EfficiencyMetricModel(
            id: "average",
            label: label,
            value: value,
            footer: .progress(fraction: fraction),
            accent: .cyan,
            accessibilityLabel: "\(label), \(value)"
        )
    }

    /// Best Session (web `fmtPercent(stats.best.efficiency)` + `formatDateTime`).
    private static func bestTile(
        _ input: EfficiencyPanelInput?,
        _ localize: (String, String) -> String,
        _ locale: Locale,
        _ timeZone: TimeZone
    ) -> EfficiencyMetricModel {
        let label = localize("charging.efficiency.best", "Best Session")
        let value = input.map { EfficiencyFormat.fmtPercent($0.bestEfficiency, locale: locale) }
            ?? EfficiencyFormat.dash
        let detail = EfficiencyFormat.formatDateTime(input?.bestDate, locale: locale, timeZone: timeZone)
        return EfficiencyMetricModel(
            id: "best",
            label: label,
            value: value,
            footer: .detail(detail),
            accent: .emerald,
            accessibilityLabel: "\(label), \(value), \(detail)"
        )
    }

    /// Worst Session (web `fmtPercent(stats.worst.efficiency)` + `formatDateTime`).
    private static func worstTile(
        _ input: EfficiencyPanelInput?,
        _ localize: (String, String) -> String,
        _ locale: Locale,
        _ timeZone: TimeZone
    ) -> EfficiencyMetricModel {
        let label = localize("charging.efficiency.worst", "Worst Session")
        let value = input.map { EfficiencyFormat.fmtPercent($0.worstEfficiency, locale: locale) }
            ?? EfficiencyFormat.dash
        let detail = EfficiencyFormat.formatDateTime(input?.worstDate, locale: locale, timeZone: timeZone)
        return EfficiencyMetricModel(
            id: "worst",
            label: label,
            value: value,
            footer: .detail(detail),
            accent: .rose,
            accessibilityLabel: "\(label), \(value), \(detail)"
        )
    }

    /// Wall-to-Battery Loss (web `fmtWithUnit(stats.wallLoss, 'kWh')` + the
    /// `fmtNumber(totalUsed) kWh → fmtNumber(totalAdded) kWh` summary line).
    private static func wallLossTile(
        _ input: EfficiencyPanelInput?,
        _ localize: (String, String) -> String,
        _ locale: Locale
    ) -> EfficiencyMetricModel {
        let label = localize("charging.efficiency.wallLoss", "Wall-to-Battery Loss")
        let value = input.map {
            EfficiencyFormat.fmtWithUnit($0.wallLoss, unit: EfficiencyFormat.kilowattHourSymbol, locale: locale)
        } ?? EfficiencyFormat.dash
        let detail = input.map { summary($0, locale) } ?? EfficiencyFormat.dash
        return EfficiencyMetricModel(
            id: "wallLoss",
            label: label,
            value: value,
            footer: .detail(detail),
            accent: .amber,
            accessibilityLabel: "\(label), \(value), \(detail)"
        )
    }

    /// The `used → added` energy summary (web `${fmtNumber(totalUsed)} kWh → ${…} kWh`).
    private static func summary(_ input: EfficiencyPanelInput, _ locale: Locale) -> String {
        let used = EfficiencyFormat.fmtNumber(input.totalUsed, locale: locale)
        let added = EfficiencyFormat.fmtNumber(input.totalAdded, locale: locale)
        let unit = EfficiencyFormat.kilowattHourSymbol
        return "\(used) \(unit) \(EfficiencyFormat.flowArrow) \(added) \(unit)"
    }
}
