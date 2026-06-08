//
//  CostSummaryCards.Adapter.swift
//  TeslaSync — P4 feature view · 0111 · CostSummaryCards (Apple)
//
//  The testable projection core: the cached `CostSummaryStats` (the aggregated `CoreStats`)
//  + the `CostSummaryUnitContext` (gas price, distance unit, currency symbol, gas unit,
//  locale) → the six view-ready `CostSummaryCardModel` tiles. Reproduces the web source
//  (features/charging/components/cost-analysis/CostSummaryCards.tsx) exactly: the
//  `useFormatting().formatCurrency` (currency symbol + `fmtNumber`), the
//  `lib/numberFormat.ts` `fmtNumber` / `fmtInt` / `fmtWithUnit` (locale-aware grouping at a
//  fixed precision, with the `safeNumber` non-finite → 0 guard), the `gas_unit` label
//  (`'L'` / `'gal'`), and the `coreStats?.field ?? 0` zero fallback (the web renders zeroed
//  tiles, never em-dashes, when the query is empty). All pure + dependency-free (the i18n
//  lookup is an injected closure) so the projection can be unit-tested without a store, a
//  bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Render phase (web shell loading / content / empty / error branches)

/// The mutually-exclusive render branches the surface switches over, mirroring the web shell:
/// the parent's `isLoading` skeleton, the resolved cards, the "no sessions" empty rendering
/// (the web still renders the six zeroed cards), and a fetch failure.
public enum CostSummaryPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Accent palette (web `StatBox` icon tint)

/// The icon tint a tile carries, mapped from the web `text-{color}-400` class the source
/// passes to each lucide glyph. Resolved to a design-token color at render time so the tiles
/// stay theme- and contrast-correct. `green` and `emerald` both resolve to the success token
/// (there is no separate emerald token) but stay distinct cases to preserve the web source's
/// per-tile distinction.
public enum CostAccent: Equatable, Sendable {
    case cyan
    case yellow
    case blue
    case green
    case red
    case emerald

    /// The design-token color for the accent: `cyan` → accent/info, `yellow` → warning,
    /// `blue` → the brand speed-series blue (the canonical equivalent of web `blue-400`,
    /// which has no theme-adaptive semantic token), `green`/`emerald` → success, `red` →
    /// danger.
    public var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .yellow: Color.TS.statusWarning
        case .blue: Color.TS.chartSeriesSpeed
        case .green: Color.TS.statusSuccess
        case .red: Color.TS.statusDanger
        case .emerald: Color.TS.statusSuccess
        }
    }
}

// MARK: - Panel glow (web `GlassPanel` `glow`)

/// The decorative panel glow the web `StatBox` forwards to `GlassPanel` (`'cyan'` / `'green'`
/// / `'none'`). The web shows it only on hover; with no hover on touch platforms it renders
/// as a persistent, understated tinted border so the emphasized tiles still read as
/// emphasized (Apple-idiomatic adaptation of the web hover glow).
public enum CostGlow: Equatable, Sendable {
    case cyan
    case green
    case none

    /// The tint color for the glow border, or `nil` for the neutral border.
    public var color: Color? {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .none: nil
        }
    }
}

// MARK: - Card projection (web `StatBox`)

/// One projected tile (web `<StatBox icon label value sub glow />`). The `label` / `value` /
/// `subtitle` are fully-resolved, render-ready strings (localized words already substituted,
/// numbers already formatted); the view renders them verbatim.
public struct CostSummaryCardModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let subtitle: String
    public let systemImage: String
    public let accent: CostAccent
    public let glow: CostGlow

    public init(
        id: String,
        label: String,
        value: String,
        subtitle: String,
        systemImage: String,
        accent: CostAccent,
        glow: CostGlow
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.accent = accent
        self.glow = glow
    }
}

// MARK: - Number / currency formatting (web parity)

/// Pure number/currency formatters reproducing the web `lib/numberFormat.ts` +
/// `useFormatting` helpers so every platform shows identical strings. `fmtNumber` mirrors the
/// JS `toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })` with the
/// `safeNumber` non-finite → 0 guard; `currency` prepends the currency symbol exactly as
/// `useFormatting().formatCurrency` does.
public enum CostFormat {
    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals, locale)`: locale-aware grouped formatting at a fixed number
    /// of fraction digits, with the `safeNumber` non-finite → 0 guard. `locale` defaults to
    /// en-US (the web default global locale).
    public static func fmtNumber(
        _ value: Double,
        decimals: Int,
        locale: String? = nil
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = resolvedLocale(locale)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Web `fmtInt(v)` = `fmtNumber(v, 0)` — locale-grouped integer.
    public static func fmtInt(_ value: Double, locale: String? = nil) -> String {
        fmtNumber(value, decimals: 0, locale: locale)
    }

    /// Web `fmtWithUnit(v, unit, decimals)` = `"{fmtNumber(v, decimals)} {unit}"`.
    public static func fmtWithUnit(
        _ value: Double,
        unit: String,
        decimals: Int,
        locale: String? = nil
    ) -> String {
        "\(fmtNumber(value, decimals: decimals, locale: locale)) \(unit)"
    }

    /// Web `useFormatting().formatCurrency(amount, decimals)` = `"{symbol}{fmtNumber(...)}"`.
    public static func currency(
        _ amount: Double,
        decimals: Int,
        symbol: String,
        locale: String? = nil
    ) -> String {
        "\(symbol)\(fmtNumber(amount, decimals: decimals, locale: locale))"
    }

    /// Web `` `${fmtNumber(v, decimals)}%` `` — the savings-percent value.
    public static func percent(_ value: Double, decimals: Int, locale: String? = nil) -> String {
        "\(fmtNumber(value, decimals: decimals, locale: locale))%"
    }

    /// Resolves a BCP-47 tag to a `Locale`, falling back to en-US for a nil/blank tag — the
    /// web `setGlobalLocale` "empty/invalid → en-US" rule.
    private static func resolvedLocale(_ locale: String?) -> Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en-US")
        }
        return Locale(identifier: locale)
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection rules shared by the model and the views. No store, no bundle, no rendered
/// view — only value-typed inputs/outputs plus an injected `localize(key, fallback)` closure
/// (the production app passes the P1/S10 facade; tests pass an echo). Builds the six tiles in
/// the exact order, with the exact stats, units, icons, accents, and glows the web source
/// renders.
public enum CostSummaryProjection {
    /// The kilowatt-hour unit symbol the web hardcodes for the energy tile.
    public static let kilowattHourSymbol = "kWh"

    /// Projects the cached stats + context into the six view-ready tiles. A `nil` `stats`
    /// (web `coreStats === null`) projects the all-zero snapshot, matching the web
    /// `coreStats?.field ?? 0` guard — so the grid renders zeroed tiles, never blanks.
    public static func cards(
        from stats: CostSummaryStats?,
        context: CostSummaryUnitContext,
        localize: (String, String) -> String
    ) -> [CostSummaryCardModel] {
        let core = stats ?? .zero
        return specs.map { spec in
            CostSummaryCardModel(
                id: spec.id,
                label: spec.label(context, localize),
                value: spec.value(core, context),
                subtitle: spec.subtitle(core, context, localize),
                systemImage: spec.systemImage,
                accent: spec.accent,
                glow: spec.glow
            )
        }
    }

    // MARK: Tile specs (web `StatBox` call order)

    /// The static description of one tile: its identity + presentation metadata, plus the
    /// closures that derive its localized label, formatted value, and composed subtitle from
    /// the bound stats + context (the value formatters need no i18n; the label + subtitle take
    /// the injected `localize`).
    private struct CardSpec {
        let id: String
        let systemImage: String
        let accent: CostAccent
        let glow: CostGlow
        let label: @Sendable (CostSummaryUnitContext, (String, String) -> String) -> String
        let value: @Sendable (CostSummaryStats, CostSummaryUnitContext) -> String
        let subtitle: @Sendable (CostSummaryStats, CostSummaryUnitContext, (String, String) -> String) -> String
    }

    /// The six tiles in the exact order + with the exact stat, format, unit, icon, accent, and
    /// glow the web source passes to each `<StatBox>`.
    private static let specs: [CardSpec] = [
        CardSpec(
            id: "totalCost",
            systemImage: "dollarsign.circle.fill",
            accent: .cyan,
            glow: .cyan,
            label: { _, loc in loc("costAnalysis.stats.totalCost", "Total Cost") },
            value: { core, ctx in currency(core.totalCost, 2, ctx) },
            subtitle: { core, ctx, loc in
                "\(CostFormat.fmtInt(Double(core.count), locale: ctx.locale)) "
                    + loc("costAnalysis.stats.sessions", "sessions")
            }
        ),
        CardSpec(
            id: "avgPerKwh",
            systemImage: "bolt.fill",
            accent: .yellow,
            glow: .none,
            label: { _, loc in loc("costAnalysis.stats.avgPerKwh", "Avg $/kWh") },
            value: { core, ctx in currency(core.avgCostPerKwh, 3, ctx) },
            subtitle: { _, _, loc in loc("costAnalysis.stats.blendedRate", "blended rate") }
        ),
        CardSpec(
            id: "costPerDist",
            systemImage: "car.fill",
            accent: .blue,
            glow: .none,
            label: { ctx, loc in
                let word = ctx.isMiles
                    ? loc("costAnalysis.stats.unitMile", "Mile")
                    : loc("costAnalysis.stats.unitKm", "km")
                return String(format: loc("costAnalysis.stats.costPerDist", "Cost Per %@"), word)
            },
            value: { core, ctx in currency(core.costPerDist, 3, ctx) },
            subtitle: { _, ctx, loc in
                String(format: loc("costAnalysis.stats.perUnit", "per %@"), ctx.distanceUnit)
            }
        ),
        CardSpec(
            id: "totalEnergy",
            systemImage: "bolt.fill",
            accent: .green,
            glow: .green,
            label: { _, loc in loc("costAnalysis.stats.totalEnergy", "Total Energy") },
            value: { core, ctx in
                CostFormat.fmtWithUnit(core.totalEnergy, unit: kilowattHourSymbol, decimals: 1, locale: ctx.locale)
            },
            subtitle: { core, ctx, loc in
                CostFormat.fmtWithUnit(
                    core.gallonsEquiv,
                    unit: loc("costAnalysis.stats.galEquiv", "gal equiv"),
                    decimals: 1,
                    locale: ctx.locale
                )
            }
        ),
        CardSpec(
            id: "gasSavings",
            systemImage: "fuelpump.fill",
            accent: .red,
            glow: .green,
            label: { _, loc in loc("costAnalysis.stats.gasSavings", "Gas Savings $") },
            value: { core, ctx in currency(core.savings, 2, ctx) },
            subtitle: { _, ctx, loc in
                let price = currency(ctx.gasPrice, 2, ctx)
                let unit = loc(ctx.gasUnit.labelKey, ctx.gasUnit.labelFallback)
                return String(format: loc("costAnalysis.stats.vsRate", "vs %@/%@"), price, unit)
            }
        ),
        CardSpec(
            id: "savingsPercent",
            systemImage: "chart.line.downtrend.xyaxis",
            accent: .emerald,
            glow: .green,
            label: { _, loc in loc("costAnalysis.stats.savingsPercent", "Savings %") },
            value: { core, ctx in CostFormat.percent(core.savingsPercent, decimals: 1, locale: ctx.locale) },
            subtitle: { _, _, loc in loc("costAnalysis.stats.vsGasoline", "vs gasoline") }
        )
    ]

    /// Web `useFormatting().formatCurrency(amount, decimals)` bound to the context's currency
    /// symbol + locale.
    private static func currency(_ amount: Double, _ decimals: Int, _ context: CostSummaryUnitContext) -> String {
        CostFormat.currency(amount, decimals: decimals, symbol: context.currencySymbol, locale: context.locale)
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no
    /// value yet); a resolved payload renders content; a resolved-but-empty payload renders
    /// the zeroed cards; a failure with cached data stays content (the chip/banner flag
    /// staleness), and a failure with no cached data shows the retryable error — mirroring the
    /// web shell.
    public static func resolvePhase(_ status: CostSummaryLoadStatus, hasValue: Bool) -> CostSummaryPhase {
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
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a tile. Pure + public so the spoken content can be
/// unit-tested without rendering. Reads label, then value, then subtitle (web `StatBox`
/// visual order).
public enum CostSummaryAccessibility {
    public static func cardSummary(_ card: CostSummaryCardModel) -> String {
        "\(card.label), \(card.value) \(card.subtitle)"
    }
}
