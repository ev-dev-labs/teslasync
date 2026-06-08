//
//  SummaryHeroCards.Adapter.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  The testable projection core for the weekly-digest "Week Summary" surface —
//  the SwiftUI parity of
//  features/analytics/components/weekly-digest/SummaryHeroCards.tsx.
//
//  Three pure pieces, all dependency-free (no Shared, no SwiftUI) so they unit-test
//  without a store, a bundle, or a rendered view:
//    • `SummaryHeroFormatting` — the `useFormatting` + `numberFormat` parity layer
//      (`fmtNumber` / `fmtInt` / `formatCurrency`), locale + precision + currency
//      symbol driven, matching the web's `toLocaleString` output.
//    • `Trend` + `TrendCalculator` — the web `helpers.trendFor` decision (percent
//      change, the `< 0.01` flat band, and the `invertPositive` good/bad polarity).
//    • `SummaryHeroProjection` — maps a `DigestSummary` (the slice of the web
//      `DigestMetrics` this surface reads) into the ordered `HighlightItem` grid,
//      appending the optional Fun Fact card exactly when the web `{funFact && …}`
//      guard holds.
//

import Foundation

// MARK: - Data (the slice of web `DigestMetrics` this surface reads)

/// The weekly-digest values `SummaryHeroCards` renders, mirroring the fields the
/// web component reads off `metrics: DigestMetrics`. Each `prev…` is the prior
/// week's value the trend chip compares against (web `metrics.prev…`).
public struct DigestSummary: Sendable, Equatable {
    public var totalDistance: Double
    public var prevDistance: Double
    public var totalDrives: Double
    public var prevDriveCount: Double
    public var energyUsed: Double
    public var prevEnergy: Double
    public var chargingCost: Double
    public var prevChargingCost: Double
    public var co2Saved: Double
    public var prevCo2: Double
    public var funFact: FunFact?

    public init(
        totalDistance: Double,
        prevDistance: Double,
        totalDrives: Double,
        prevDriveCount: Double,
        energyUsed: Double,
        prevEnergy: Double,
        chargingCost: Double,
        prevChargingCost: Double,
        co2Saved: Double,
        prevCo2: Double,
        funFact: FunFact? = nil
    ) {
        self.totalDistance = totalDistance
        self.prevDistance = prevDistance
        self.totalDrives = totalDrives
        self.prevDriveCount = prevDriveCount
        self.energyUsed = energyUsed
        self.prevEnergy = prevEnergy
        self.chargingCost = chargingCost
        self.prevChargingCost = prevChargingCost
        self.co2Saved = co2Saved
        self.prevCo2 = prevCo2
        self.funFact = funFact
    }
}

/// The "you drove ≈ N× CityA → CityB" novelty card payload (web `FunFact`). The
/// `times` field is already display-formatted by the producer (web
/// `fmtNumber(times, 1)`), so it is carried verbatim and never reformatted here.
public struct FunFact: Sendable, Equatable {
    public var from: String
    public var to: String
    public var times: String

    public init(from: String, to: String, times: String) {
        self.from = from
        self.to = to
        self.times = times
    }
}

// MARK: - Formatting (web `useFormatting` + `numberFormat`)

/// The display-formatting facade this surface binds through (P1/S8), reproducing
/// the web `useFormatting` hook over the `numberFormat` primitives. Locale +
/// precision + currency symbol come from user settings in the production app; the
/// `.standard` default mirrors the web fallbacks (`'$'`, precision `2`, `en-US`).
public struct SummaryHeroFormatting: Sendable, Equatable {
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String

    public init(currencySymbol: String = "$", precision: Int = 2, localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.localeIdentifier = localeIdentifier
    }

    /// The web default: `$`, two fraction digits, `en-US` grouping.
    public static let standard = SummaryHeroFormatting()

    /// Locale-aware fixed-fraction decimal formatting — the parity of the web
    /// `fmtNumber(v, d)` (`Number.toLocaleString(locale, { min/maxFractionDigits: d })`).
    /// A non-finite input renders as `0` formatted, matching `safeNumber`.
    public func number(_ value: Double, decimals: Int) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Integer with locale separators — web `fmtInt(v)` (`fmtNumber(v, 0)`).
    public func int(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Currency string — web `formatCurrency(amount, decimals)`
    /// (`${currencySymbol}${fmtNumber(amount, d)}`). `decimals == nil` uses the
    /// user precision, exactly like the hook's `decimals ?? userPrecision`.
    public func currency(_ amount: Double, decimals: Int? = nil) -> String {
        currencySymbol + number(amount, decimals: decimals ?? precision)
    }
}

// MARK: - Trend (web `helpers.trendFor`)

/// The arrow direction a trend chip points (web `'up' | 'down' | 'flat'`).
public enum TrendDirection: Sendable, Equatable {
    case up
    case down
    case flat
}

/// A computed week-over-week trend chip (web `trendFor` return value). `positive`
/// already folds in `invertPositive`, so it — not `direction` — drives the chip's
/// good/bad color and arrow, exactly as the web `change.positive` does.
public struct Trend: Sendable, Equatable {
    public var direction: TrendDirection
    public var value: String
    public var positive: Bool

    public init(direction: TrendDirection, value: String, positive: Bool) {
        self.direction = direction
        self.value = value
        self.positive = positive
    }
}

/// Pure week-over-week trend math, reproducing `helpers.ts` `pctChange` + `trendFor`.
public enum TrendCalculator {
    /// Web `pctChange`: `previous == 0 → (current > 0 ? 100 : 0)`, else the signed
    /// percentage change over `abs(previous)`.
    public static func pctChange(current: Double, previous: Double) -> Double {
        if previous == 0 { return current > 0 ? 100 : 0 }
        return ((current - previous) / abs(previous)) * 100
    }

    /// Web `trendFor(current, previous, invertPositive)`: a `< 0.01` absolute delta
    /// is a flat `0%`; otherwise an up/down chip whose `value` is the signed percent
    /// (`+` prefix when rising) and whose `positive` is inverted for "lower is better"
    /// metrics (energy, cost).
    public static func trend(
        current: Double,
        previous: Double,
        invertPositive: Bool = false,
        formatting: SummaryHeroFormatting = .standard
    ) -> Trend {
        let diff = current - previous
        let pct = pctChange(current: current, previous: previous)
        if abs(diff) < 0.01 {
            return Trend(direction: .flat, value: "0%", positive: true)
        }
        let isUp = diff > 0
        let sign = isUp ? "+" : ""
        return Trend(
            direction: isUp ? .up : .down,
            value: "\(sign)\(formatting.number(pct, decimals: 1))%",
            positive: invertPositive ? !isUp : isUp
        )
    }
}

// MARK: - Card view model (web `HighlightCard` props)

/// The web `HighlightCard` accent, driving the panel glow (web `glowMap`: cyan /
/// green / purple glow; amber / red none) — the per-metric color identity.
public enum SummaryHeroAccent: String, Sendable, Equatable {
    case cyan
    case green
    case purple
    case amber
    case red

    /// Whether the web `glowMap` lights this accent (cyan/green/purple) versus
    /// rendering with no glow (amber/red).
    public var hasGlow: Bool {
        switch self {
        case .cyan, .green, .purple: true
        case .amber, .red: false
        }
    }
}

/// One rendered hero card (web `<HighlightCard … />`). `value` and `subtitle` are
/// already display-formatted; `labelKey`/`labelFallback` resolve through the i18n
/// facade at render time so the model stays locale-agnostic and testable.
public struct HighlightItem: Identifiable, Sendable, Equatable {
    public let id: String
    public let systemImage: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let trend: Trend?
    public let subtitle: String?
    public let accent: SummaryHeroAccent

    public init(
        id: String,
        systemImage: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        trend: Trend?,
        subtitle: String?,
        accent: SummaryHeroAccent
    ) {
        self.id = id
        self.systemImage = systemImage
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.trend = trend
        self.subtitle = subtitle
        self.accent = accent
    }
}

// MARK: - Projection (web JSX → ordered card grid)

/// Maps a `DigestSummary` into the ordered hero-card grid, one entry per web
/// `<HighlightCard>` in source order, appending the Fun Fact card only when a
/// `funFact` is present (web `{funFact && …}`).
public enum SummaryHeroProjection {
    /// The five always-present metric cards plus the optional Fun Fact card, in
    /// the exact order, with the exact icons / accents / labels / values / trends
    /// the web source renders.
    public static func items(
        from summary: DigestSummary,
        formatting: SummaryHeroFormatting = .standard
    ) -> [HighlightItem] {
        var items = [
            distanceCard(summary, formatting),
            drivesCard(summary, formatting),
            energyCard(summary, formatting),
            costCard(summary, formatting),
            co2Card(summary, formatting)
        ]
        if let funFact = summary.funFact {
            items.append(funFactCard(funFact))
        }
        return items
    }

    /// Total Distance — web `<HighlightCard icon={Car} … color="cyan" />`.
    private static func distanceCard(
        _ summary: DigestSummary,
        _ formatting: SummaryHeroFormatting
    ) -> HighlightItem {
        HighlightItem(
            id: SummaryHeroKeys.totalDistance,
            systemImage: "car.fill",
            labelKey: SummaryHeroKeys.totalDistance,
            labelFallback: "Total Distance",
            value: "\(formatting.number(summary.totalDistance, decimals: 1)) km",
            trend: TrendCalculator.trend(
                current: summary.totalDistance,
                previous: summary.prevDistance,
                formatting: formatting
            ),
            subtitle: nil,
            accent: .cyan
        )
    }

    /// Total Drives — web `<HighlightCard icon={Activity} … color="green" />`.
    private static func drivesCard(
        _ summary: DigestSummary,
        _ formatting: SummaryHeroFormatting
    ) -> HighlightItem {
        HighlightItem(
            id: SummaryHeroKeys.totalDrives,
            systemImage: "waveform.path.ecg",
            labelKey: SummaryHeroKeys.totalDrives,
            labelFallback: "Total Drives",
            value: formatting.int(summary.totalDrives),
            trend: TrendCalculator.trend(
                current: summary.totalDrives,
                previous: summary.prevDriveCount,
                formatting: formatting
            ),
            subtitle: nil,
            accent: .green
        )
    }

    /// Energy Used — web `<HighlightCard icon={Zap} … color="purple" />` (lower is
    /// better → inverted trend polarity).
    private static func energyCard(
        _ summary: DigestSummary,
        _ formatting: SummaryHeroFormatting
    ) -> HighlightItem {
        HighlightItem(
            id: SummaryHeroKeys.energyUsed,
            systemImage: "bolt.fill",
            labelKey: SummaryHeroKeys.energyUsed,
            labelFallback: "Energy Used",
            value: "\(formatting.number(summary.energyUsed, decimals: 1)) kWh",
            trend: TrendCalculator.trend(
                current: summary.energyUsed,
                previous: summary.prevEnergy,
                invertPositive: true,
                formatting: formatting
            ),
            subtitle: nil,
            accent: .purple
        )
    }

    /// Charging Cost — web `<HighlightCard icon={Fuel} … color="amber" />` (lower is
    /// better → inverted trend polarity).
    private static func costCard(
        _ summary: DigestSummary,
        _ formatting: SummaryHeroFormatting
    ) -> HighlightItem {
        HighlightItem(
            id: SummaryHeroKeys.chargingCost,
            systemImage: "fuelpump.fill",
            labelKey: SummaryHeroKeys.chargingCost,
            labelFallback: "Charging Cost",
            value: formatting.currency(summary.chargingCost, decimals: 2),
            trend: TrendCalculator.trend(
                current: summary.chargingCost,
                previous: summary.prevChargingCost,
                invertPositive: true,
                formatting: formatting
            ),
            subtitle: nil,
            accent: .amber
        )
    }

    /// CO₂ Saved — web `<HighlightCard icon={Leaf} … color="green" />`.
    private static func co2Card(
        _ summary: DigestSummary,
        _ formatting: SummaryHeroFormatting
    ) -> HighlightItem {
        HighlightItem(
            id: SummaryHeroKeys.co2Saved,
            systemImage: "leaf.fill",
            labelKey: SummaryHeroKeys.co2Saved,
            labelFallback: "CO₂ Saved",
            value: "\(formatting.number(summary.co2Saved, decimals: 1)) kg",
            trend: TrendCalculator.trend(
                current: summary.co2Saved,
                previous: summary.prevCo2,
                formatting: formatting
            ),
            subtitle: nil,
            accent: .green
        )
    }

    /// Fun Fact — web `{funFact && <HighlightCard icon={MapPin} … color="cyan" />}`.
    private static func funFactCard(_ funFact: FunFact) -> HighlightItem {
        HighlightItem(
            id: SummaryHeroKeys.funFact,
            systemImage: "mappin.and.ellipse",
            labelKey: SummaryHeroKeys.funFact,
            labelFallback: "Fun Fact",
            value: "\(funFact.times)×",
            trend: nil,
            subtitle: SummaryHeroStrings.funFactDescription(funFact),
            accent: .cyan
        )
    }
}
