//
//  CostSavingsPanel.Tiles.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  The resolved-tile projection for the drive-detail cost & savings panel — the
//  native port of the web component's grid cells and their visibility branches:
//  Trip Cost always; Cost/unit when `distanceM > 0`; and the gas-equivalent /
//  savings / savings-% trio when `savings != nil && savings > 0`. Pure +
//  Foundation-only; it composes the formatting + arithmetic from
//  `CostSavingsPanel.Adapter.swift`, so each cell's value, tone, and interpolation
//  arguments are unit tested without a view.
//

import Foundation

// MARK: - Resolved stat tile (the web grid cells)

/// The semantic accent the web assigns each value (`text-green/cyan/red/emerald`),
/// kept token-free so this core stays SwiftUI-free; the view maps each case to a
/// design token. green/emerald both collapse to `positive` (savings tone).
public enum CostSavingsTone: String, Sendable, Equatable, CaseIterable {
    case positive
    case accent
    case negative
}

/// One resolved grid cell — a localized label (key + fallback, plus an optional
/// `%@` argument for `Cost / {unit}`), a pre-formatted value, the value's semantic
/// tone, and an optional sub-label carried as key + fallback + already-formatted
/// arguments so the view owns the localized `String(format:)` while the numbers
/// stay tested here.
public struct CostSavingsTile: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable, CaseIterable {
        case tripCost
        case costPerUnit
        case gasEquiv
        case gasSavings
        case savingsPct
    }

    public let id: String
    public let kind: Kind
    public let labelKey: String
    public let labelFallback: String
    public let labelArgument: String?
    public let value: String
    public let tone: CostSavingsTone
    public let subLabelKey: String?
    public let subLabelFallback: String?
    public let subLabelArguments: [String]

    public init(
        kind: Kind,
        labelKey: String,
        labelFallback: String,
        labelArgument: String? = nil,
        value: String,
        tone: CostSavingsTone,
        subLabelKey: String? = nil,
        subLabelFallback: String? = nil,
        subLabelArguments: [String] = []
    ) {
        id = kind.rawValue
        self.kind = kind
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.labelArgument = labelArgument
        self.value = value
        self.tone = tone
        self.subLabelKey = subLabelKey
        self.subLabelFallback = subLabelFallback
        self.subLabelArguments = subLabelArguments
    }

    /// Whether this tile carries a sub-label line (web cells 1 & 3).
    public var hasSubLabel: Bool {
        subLabelKey != nil
    }
}

// MARK: - Tile builder (the web render branches, in order)

/// Builds the ordered visible tiles — the native port of the component's JSX. A
/// drive with neither energy nor distance yields no tiles, so the surface shows its
/// friendly empty state instead of a row of zeroes.
public enum CostSavingsTiles {
    public static func build(config: CostSavingsConfig, inputs: CostSavingsInputs) -> [CostSavingsTile] {
        guard inputs.energyWh > 0 || inputs.distanceM > 0 else { return [] }
        var tiles = [tripCostTile(config: config, inputs: inputs)]
        if inputs.distanceM > 0 {
            tiles.append(costPerUnitTile(config: config, inputs: inputs))
        }
        tiles.append(contentsOf: gasTrioTiles(config: config, inputs: inputs))
        return tiles
    }

    /// Cell 1 — web `formatEnergyCost(stats.energyWh / 1000)` + the `at {sym}{rate}/kWh` note.
    private static func tripCostTile(config: CostSavingsConfig, inputs: CostSavingsInputs) -> CostSavingsTile {
        let cost = CostSavingsMath.tripCost(energyWh: inputs.energyWh, costPerKwh: config.costPerKwh)
        let value = CostSavingsFormat.currency(
            cost,
            decimals: config.decimalPrecision,
            symbol: config.currencySymbol,
            locale: config.locale
        )
        return CostSavingsTile(
            kind: .tripCost,
            labelKey: "driveDetail.tripCost",
            labelFallback: "Trip Cost",
            value: value,
            tone: .positive,
            subLabelKey: "driveDetail.atRate",
            subLabelFallback: "at %1$@%2$@/kWh",
            subLabelArguments: [
                config.currencySymbol,
                CostSavingsFormat.plain(config.costPerKwh, locale: config.locale)
            ]
        )
    }

    /// Cell 2 — web `formatCurrency(costPerDistanceUnit(...) ?? 0, 3)`, gated on `distanceM > 0`.
    private static func costPerUnitTile(config: CostSavingsConfig, inputs: CostSavingsInputs) -> CostSavingsTile {
        let perUnit = CostSavingsMath.costPerDistanceUnit(
            energyWh: inputs.energyWh,
            costPerKwh: config.costPerKwh,
            distanceM: inputs.distanceM,
            unit: config.distanceUnit
        ) ?? 0
        let value = CostSavingsFormat.currency(
            perUnit,
            decimals: CostSavingsConstants.costPerUnitPrecision,
            symbol: config.currencySymbol,
            locale: config.locale
        )
        return CostSavingsTile(
            kind: .costPerUnit,
            labelKey: "driveDetail.costPerUnit",
            labelFallback: "Cost / %@",
            labelArgument: config.distanceUnit.rawValue,
            value: value,
            tone: .accent
        )
    }

    /// Cells 3–5 — web gas-equivalent / savings / savings-% trio, shown only when
    /// `savings != nil && savings > 0`.
    private static func gasTrioTiles(config: CostSavingsConfig, inputs: CostSavingsInputs) -> [CostSavingsTile] {
        let evCost = CostSavingsMath.tripCost(energyWh: inputs.energyWh, costPerKwh: config.costPerKwh)
        let gasCost = CostSavingsMath.estimateGasCost(
            distanceM: inputs.distanceM,
            mpg: config.gasEfficiencyMpg,
            gasPrice: config.gasPricePerUnit,
            gasUnit: config.gasUnit
        )
        guard
            let gasCost,
            let savings = CostSavingsMath.savings(gasCost: gasCost, evCost: evCost),
            savings > 0
        else {
            return []
        }
        let symbol = config.currencySymbol
        let precision = config.decimalPrecision
        let locale = config.locale
        return [
            CostSavingsTile(
                kind: .gasEquiv,
                labelKey: "driveDetail.gasCostEquiv",
                labelFallback: "Gas Cost (equiv)",
                value: CostSavingsFormat.currency(gasCost, decimals: precision, symbol: symbol, locale: locale),
                tone: .negative,
                subLabelKey: "driveDetail.atMpg",
                subLabelFallback: "at %@ MPG",
                subLabelArguments: [CostSavingsFormat.plain(config.gasEfficiencyMpg, locale: locale)]
            ),
            CostSavingsTile(
                kind: .gasSavings,
                labelKey: "driveDetail.gasSavings",
                labelFallback: "vs Gas Savings",
                value: CostSavingsFormat.currency(savings, decimals: precision, symbol: symbol, locale: locale),
                tone: .positive
            ),
            CostSavingsTile(
                kind: .savingsPct,
                labelKey: "driveDetail.savingsPct",
                labelFallback: "Savings %",
                value: CostSavingsFormat.number(savings / gasCost * 100, decimals: 0, locale: locale) + "%",
                tone: .positive
            )
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a tile from already-localized parts.
public enum CostSavingsAccessibility {
    public static func tileLabel(label: String, value: String, detail: String? = nil) -> String {
        if let detail, !detail.isEmpty {
            return "\(label), \(value), \(detail)"
        }
        return "\(label), \(value)"
    }
}
