//
//  DriveStatCards.Adapter.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  The testable projection core: the cached drive fields + the computed drive stats + the
//  user's display-unit / cost preferences → the eight-to-ten view-ready stat tiles.
//  Reproduces the web source
//  (features/driving/components/drive-detail/DriveStatCards.tsx) exactly:
//    • Distance  — `convertDistanceFromSI(distanceM, unit)` at 1 dp + the unit suffix.
//    • Duration  — `formatDuration(durationS / 60)` (the `Xh Ym` / `Ym` split).
//    • Max/Avg Speed — the raw `stats.maxSpd` / `stats.avgSpd` (already converted to the
//      display speed unit upstream, web `toSpeedDisplay(drive.maxSpeedMps)`) at 0 dp + unit.
//    • SOC       — `fmtInt(startBatteryPct)% → fmtInt(endBatteryPct)%` (nil → 0, web parity).
//    • Max Power — `fmtWithUnit(stats.powerMax, "kW")` at the user precision.
//    • Elev. Gain / Loss — `Math.round(stats.elev…)` at 0 dp + the ` m ↑` / ` m ↓` suffix.
//    • Trip Cost — `formatEnergyCost(energyWh / 1000)`, shown only when `energyWh > 0`.
//    • Cost / unit — `formatCurrency(costPerDistanceUnit(energyWh / 1000, distanceM) ?? 0, 3)`,
//      shown only when `energyWh > 0 && distanceM > 0`.
//  All pure + dependency-free so the projection can be unit-tested without a store, a
//  bundle, or a rendered view. The em-dash sentinel backs the resolved-but-empty state.
//

import Foundation
import SwiftUI

// MARK: - Render phase (web shell skeleton / content / empty / error branches)

/// The mutually-exclusive render branches the surface switches over. The web `DriveStatCards`
/// is purely presentational (its parent `useDriveDetailData` owns loading / error), so these
/// branches model the parent's lifecycle around the same tile grid the web renders.
public enum DriveStatCardsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Accent palette (web `IconStatCard` `color`)

/// The decorative accent a stat tile carries, mapped from the raw hex `color` the web source
/// passes to each `<IconStatCard color=… />`. Resolved to a design-token color at render time
/// so the tiles stay theme- and contrast-correct.
public enum DriveStatCardsAccent: Equatable, Sendable {
    /// Web `#00f0ff` (Distance) — the brand cyan accent.
    case cyan
    /// Web `#f59e0b` (Duration, Max Power) — the amber warning token.
    case amber
    /// Web `#a855f7` (Max Speed) — the brand chart-series purple (no semantic token).
    case purple
    /// Web `#10b981` (Avg Speed, SOC, Elev. Gain, Trip Cost) — the success token.
    case green
    /// Web `#ef4444` (Elev. Loss) — the danger token.
    case red
    /// Web `#06b6d4` (Cost / unit) — the chart-series regen teal (the canonical `#06b6d4`).
    case teal

    /// The design-token color for the accent. The semantic accents map to theme-adaptive
    /// tokens; `purple` and `teal` map to the fixed brand chart-series colors, which are the
    /// canonical equivalents of the web `#a855f7` / `#06b6d4` (there is no theme-adaptive
    /// purple/teal token).
    public var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .amber: Color.TS.statusWarning
        case .purple: Color.TS.chartSeriesPower
        case .green: Color.TS.statusSuccess
        case .red: Color.TS.statusDanger
        case .teal: Color.TS.chartSeriesRegen
        }
    }
}

// MARK: - Card projection (web `IconStatCard`)

/// One projected stat tile (web `<IconStatCard icon color value label />`). The `value` is a
/// pre-formatted string rendered verbatim — the web bakes the unit into the value (via the
/// `AnimatedNumber` suffix or the template string), so there is no separate unit subtitle.
/// `labelArgs` carries the runtime interpolation argument for the one templated label
/// (`Cost / {{unit}}`); it is empty for every other tile.
public struct DriveStatCardsItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let labelArgs: [String]
    public let value: String
    public let systemImage: String
    public let accent: DriveStatCardsAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        labelArgs: [String] = [],
        value: String,
        systemImage: String,
        accent: DriveStatCardsAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.labelArgs = labelArgs
        self.value = value
        self.systemImage = systemImage
        self.accent = accent
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection rules shared by the model and the views. No store, no bundle, no rendered
/// view — only value-typed inputs/outputs. Builds the eight always-on tiles plus the two
/// conditional cost tiles in the exact order, with the exact values, icons, and accents the
/// web source renders.
public enum DriveStatCardsProjection {
    /// The em-dash rendered for every always-on tile in the resolved-but-empty state, so the
    /// grid never renders a blank box when there is no drive data.
    public static let emDash = "—"

    /// The kilowatt unit symbol the web hardcodes for the power tile (`fmtWithUnit(_, "kW")`).
    public static let kilowattSymbol = "kW"

    /// Projects the cached drive + stats + formatting into the view-ready tiles. A `nil`
    /// `input` yields the eight always-on tiles with the em-dash sentinel and omits the two
    /// cost tiles (the web `energyWh > 0` guards are false with no data) — so the grid stays
    /// populated and intentional in the empty state.
    public static func cards(
        from input: DriveStatCardsInput?,
        formatting: DriveStatCardsFormatting
    ) -> [DriveStatCardsItem] {
        guard let input else { return emptyTiles() }
        let locale = formatting.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en-US")
        var items = baseSpecs.map { spec in
            DriveStatCardsItem(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                value: spec.value(input, formatting, locale),
                systemImage: spec.systemImage,
                accent: spec.accent
            )
        }
        items.append(contentsOf: costTiles(input, formatting, locale))
        return items
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no
    /// value yet); a resolved payload renders content; a resolved-but-empty payload renders
    /// the em-dash tiles; a failure with cached data stays content (the chip/banner flag
    /// staleness), and a failure with no cached data shows the retryable error — mirroring the
    /// web parent's lifecycle around the tile grid.
    public static func resolvePhase(_ status: DriveStatCardsLoadStatus, hasValue: Bool) -> DriveStatCardsPhase {
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

    // MARK: Tile assembly

    /// The eight always-on tiles with the em-dash sentinel (the resolved-but-empty state).
    private static func emptyTiles() -> [DriveStatCardsItem] {
        baseSpecs.map { spec in
            DriveStatCardsItem(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                value: emDash,
                systemImage: spec.systemImage,
                accent: spec.accent
            )
        }
    }

    /// The conditional cost tiles: Trip Cost when `energyWh > 0`, then Cost / unit when the
    /// drive also has positive distance (web `energyWh > 0` / `energyWh > 0 && distanceM > 0`).
    private static func costTiles(
        _ input: DriveStatCardsInput,
        _ formatting: DriveStatCardsFormatting,
        _ locale: Locale
    ) -> [DriveStatCardsItem] {
        guard input.energyWh > 0 else { return [] }
        var tiles = [tripCostTile(input, formatting, locale)]
        if input.distanceM > 0 {
            tiles.append(costPerUnitTile(input, formatting, locale))
        }
        return tiles
    }

    /// Web `<IconStatCard … value={formatEnergyCost(stats.energyWh / 1000)} label="Trip Cost" />`.
    private static func tripCostTile(
        _ input: DriveStatCardsInput,
        _ formatting: DriveStatCardsFormatting,
        _ locale: Locale
    ) -> DriveStatCardsItem {
        DriveStatCardsItem(
            id: "tripCost",
            labelKey: "driveDetail.tripCost",
            labelFallback: "Trip Cost",
            value: energyCost(kwh: input.energyWh / 1000, formatting: formatting, locale: locale),
            systemImage: "dollarsign.circle.fill",
            accent: .green
        )
    }

    /// Web `<IconStatCard … value={formatCurrency(costPerDistanceUnit(…) ?? 0, 3)}
    /// label={t('driveDetail.costPerUnit', { unit })} />`.
    private static func costPerUnitTile(
        _ input: DriveStatCardsInput,
        _ formatting: DriveStatCardsFormatting,
        _ locale: Locale
    ) -> DriveStatCardsItem {
        let perUnit = costPerDistanceUnit(
            kwh: input.energyWh / 1000,
            distanceM: input.distanceM,
            formatting: formatting
        ) ?? 0
        return DriveStatCardsItem(
            id: "costPerUnit",
            labelKey: "driveDetail.costPerUnit",
            labelFallback: "Cost / %@",
            labelArgs: [formatting.distanceUnit],
            value: currency(perUnit, decimals: 3, formatting: formatting, locale: locale),
            systemImage: "chart.line.downtrend.xyaxis",
            accent: .teal
        )
    }

    // MARK: Cost helpers (web `useFormatting`)

    /// Web `formatEnergyCost(kwh)`: `{symbol}{fmtNumber(kwh * costPerKwh, precision)}`.
    static func energyCost(kwh: Double, formatting: DriveStatCardsFormatting, locale: Locale) -> String {
        let cost = kwh * formatting.costPerKwh
        return formatting.currencySymbol
            + DriveStatCardsUnitMath.fmtNumber(cost, decimals: formatting.precision, locale: locale)
    }

    /// Web `formatCurrency(amount, decimals)`: `{symbol}{fmtNumber(amount, decimals)}`.
    static func currency(
        _ amount: Double,
        decimals: Int,
        formatting: DriveStatCardsFormatting,
        locale: Locale
    ) -> String {
        formatting.currencySymbol + DriveStatCardsUnitMath.fmtNumber(amount, decimals: decimals, locale: locale)
    }

    /// Web `costPerDistanceUnit(kwh, distanceM)`: `nil` when `distanceM <= 0`, else the cost
    /// per display distance unit, or `nil` when the converted distance is non-positive.
    static func costPerDistanceUnit(
        kwh: Double,
        distanceM: Double,
        formatting: DriveStatCardsFormatting
    ) -> Double? {
        guard distanceM > 0 else { return nil }
        let cost = kwh * formatting.costPerKwh
        let distance = DriveStatCardsUnitMath.distanceFromSI(distanceM, formatting.distanceUnit)
        return distance > 0 ? cost / distance : nil
    }

    /// Web `fmtInt(drive.startBatteryPct)` — `nil`/non-finite percent → `0` (the SOC pair).
    private static func socPart(_ pct: Double?, _ locale: Locale) -> String {
        DriveStatCardsUnitMath.fmtInt(DriveStatCardsUnitMath.safe(pct ?? 0), locale: locale)
    }

    // MARK: Tile specs (web `IconStatCard` call order)

    /// The static description of one always-on tile: its identity + presentation metadata,
    /// plus the closure that derives its pre-formatted value from the bound input/formatting.
    private struct CardSpec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let systemImage: String
        let accent: DriveStatCardsAccent
        let value: @Sendable (DriveStatCardsInput, DriveStatCardsFormatting, Locale) -> String
    }

    /// The eight always-on tiles in the exact order + with the exact value, icon, and accent
    /// the web source passes to each `<IconStatCard>`.
    private static let baseSpecs: [CardSpec] = [
        CardSpec(
            id: "distance",
            labelKey: "driveDetail.distance",
            labelFallback: "Distance",
            systemImage: "point.topleft.down.to.point.bottomright.curvepath",
            accent: .cyan,
            value: { input, fmt, locale in
                let display = DriveStatCardsUnitMath.distanceFromSI(input.distanceM, fmt.distanceUnit)
                return DriveStatCardsUnitMath.fmtNumber(display, decimals: 1, locale: locale) + " " + fmt.distanceUnit
            }
        ),
        CardSpec(
            id: "duration",
            labelKey: "driveDetail.duration",
            labelFallback: "Duration",
            systemImage: "clock",
            accent: .amber,
            value: { input, _, _ in
                DriveStatCardsUnitMath.formatDuration(minutes: input.durationS / 60)
            }
        ),
        CardSpec(
            id: "maxSpeed",
            labelKey: "driveDetail.maxSpeed",
            labelFallback: "Max Speed",
            systemImage: "speedometer",
            accent: .purple,
            value: { input, fmt, locale in
                DriveStatCardsUnitMath.fmtNumber(input.maxSpeed, decimals: 0, locale: locale) + " " + fmt.speedUnit
            }
        ),
        CardSpec(
            id: "avgSpeed",
            labelKey: "driveDetail.avgSpeed",
            labelFallback: "Avg Speed",
            systemImage: "chart.line.uptrend.xyaxis",
            accent: .green,
            value: { input, fmt, locale in
                DriveStatCardsUnitMath.fmtNumber(input.avgSpeed, decimals: 0, locale: locale) + " " + fmt.speedUnit
            }
        ),
        CardSpec(
            id: "soc",
            labelKey: "driveDetail.soc",
            labelFallback: "SOC",
            systemImage: "battery.100",
            accent: .green,
            value: { input, _, locale in
                "\(socPart(input.startBatteryPct, locale))% → \(socPart(input.endBatteryPct, locale))%"
            }
        ),
        CardSpec(
            id: "maxPower",
            labelKey: "driveDetail.maxPower",
            labelFallback: "Max Power",
            systemImage: "bolt.fill",
            accent: .amber,
            value: { input, fmt, locale in
                DriveStatCardsUnitMath.fmtNumber(input.powerMax, decimals: fmt.precision, locale: locale)
                    + " " + kilowattSymbol
            }
        ),
        CardSpec(
            id: "elevGain",
            labelKey: "driveDetail.elevGain",
            labelFallback: "Elev. Gain",
            systemImage: "location.north.fill",
            accent: .green,
            value: { input, _, locale in
                DriveStatCardsUnitMath.fmtNumber(input.elevGain.rounded(), decimals: 0, locale: locale) + " m ↑"
            }
        ),
        CardSpec(
            id: "elevLoss",
            labelKey: "driveDetail.elevLoss",
            labelFallback: "Elev. Loss",
            systemImage: "location.north.fill",
            accent: .red,
            value: { input, _, locale in
                DriveStatCardsUnitMath.fmtNumber(input.elevLoss.rounded(), decimals: 0, locale: locale) + " m ↓"
            }
        )
    ]
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a stat tile. Pure + public so the spoken content can be
/// unit-tested without rendering. The label resolves through the injected localizer (bundle-
/// free in tests); the value (which already carries the unit) is read after it, mirroring the
/// web DOM order (icon, value, label) collapsed to a single spoken element.
public enum DriveStatCardsAccessibility {
    public static func cardSummary(
        _ item: DriveStatCardsItem,
        localize: (String, String, [String]) -> String
    ) -> String {
        let label = localize(item.labelKey, item.labelFallback, item.labelArgs)
        return "\(label), \(item.value)"
    }
}
