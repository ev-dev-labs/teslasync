//
//  SavingsCalculator.Models.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  Domain value types ported from the web source's data contract
//  (web/src/features/charging/components/cost-analysis/{types,constants}.ts and
//  the gas-vs-electric math the parent hook computes in `useCostAnalysisData.ts`,
//  L175-200). Three pure pieces:
//
//    • `SavingsCalculatorData`        — the resolved, display-ready charging
//      aggregates the surface compares (the slice the web parent feeds into the
//      `gasComparison` memo). The P1/S8 source projects these at the
//      cache/facade boundary (energy in kWh, cost + distance already in the
//      user's display units), so the view stays unit-agnostic.
//    • `SavingsCalculatorAssumptions` — the three interactive inputs (gas price,
//      MPG, electricity rate) with the web defaults + the exact `Number()||0` /
//      `Number()||1` parse guards the source `<Input>`s apply.
//    • `GasComparison`               — the computed comparison (web
//      `types.ts` `GasComparison`), reproduced verbatim from the aggregates and
//      assumptions so the native inputs drive the cards live.
//
//  Pure Foundation — no SwiftUI, no Shared xcframework — so the file
//  host-compiles and the decode + math are unit-testable in isolation.
//

import Foundation

// MARK: - SavingsCalculatorData (resolved charging aggregates)

/// The display-ready charging aggregates the calculator compares against a
/// gas car. The web `SavingsCalculator` is presentational and receives the
/// already-computed `gasComparison`; modeling the aggregates the comparison is
/// derived from lets the native surface recompute live as the user edits the
/// assumptions (the parent hook's `useMemo` behavior). Distance + cost arrive in
/// the user's display units (the source applies the units facade), matching the
/// web `distanceUnit` prop. Every field defaults to zero so a partial payload
/// degrades to a "$0" comparison rather than dropping the surface.
public struct SavingsCalculatorData: Equatable, Sendable {
    /// Total energy charged over the window, in kWh (web `coreStats.totalEnergy`).
    public let energyKwh: Double
    /// Total money spent charging, in the display currency (web `coreStats.totalCost`).
    public let costDollars: Double
    /// Total distance driven, already in the user's display unit
    /// (web `distMiles = toDistanceDisplay(totalDistanceM / 1609.344)`).
    public let displayDistance: Double
    /// The display distance unit symbol (web `distanceUnit`, e.g. "mi" / "km").
    public let distanceUnit: String
    /// Number of months the window spans (web `monthlyData.length`), used to
    /// amortize the savings into a monthly figure.
    public let monthsCount: Int

    public init(
        energyKwh: Double = 0,
        costDollars: Double = 0,
        displayDistance: Double = 0,
        distanceUnit: String = "mi",
        monthsCount: Int = 0
    ) {
        self.energyKwh = energyKwh
        self.costDollars = costDollars
        self.displayDistance = displayDistance
        self.distanceUnit = distanceUnit
        self.monthsCount = monthsCount
    }
}

// MARK: - Decode adapter (snake-case DTO → value type)

public extension SavingsCalculatorData {
    private struct DTO: Decodable {
        let energyKwh: Double?
        let costDollars: Double?
        let displayDistance: Double?
        let distanceUnit: String?
        let monthsCount: Int?
    }

    /// Decodes one resolved-aggregates object (snake-case JSON the production
    /// source emits after projecting the charging feed through the units facade).
    /// Tolerates a partial payload — every missing field falls back to its zero
    /// default and the unit to "mi" — so a sparse response still renders.
    static func decode(fromJSONString json: String) -> SavingsCalculatorData? {
        guard let data = json.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let dto = try? decoder.decode(DTO.self, from: data) else { return nil }
        return SavingsCalculatorData(
            energyKwh: dto.energyKwh ?? 0,
            costDollars: dto.costDollars ?? 0,
            displayDistance: dto.displayDistance ?? 0,
            distanceUnit: dto.distanceUnit ?? "mi",
            monthsCount: dto.monthsCount ?? 0
        )
    }
}

// MARK: - SavingsCalculatorAssumptions (the three inputs)

/// The user-editable assumptions behind the comparison (web input props
/// `gasPrice` / `mpg` / `electricityRate`). Pure value type so the parse guards
/// and defaults are unit-testable without a view.
public struct SavingsCalculatorAssumptions: Equatable, Sendable {
    /// Gas price per gallon (web `gasPrice`, suffix `$/gal`).
    public let gasPrice: Double
    /// Gas-car fuel economy in miles per gallon (web `mpg`, suffix `mpg`).
    public let mpg: Double
    /// Electricity rate per kWh (web `electricityRate`, suffix `$/kWh`).
    public let electricityRate: Double

    public init(gasPrice: Double, mpg: Double, electricityRate: Double) {
        self.gasPrice = gasPrice
        self.mpg = mpg
        self.electricityRate = electricityRate
    }

    /// The web defaults (`constants.ts` `DEFAULT_GAS_PRICE` / `DEFAULT_MPG` /
    /// `DEFAULT_ELECTRICITY_RATE`) restored by the "Reset Defaults" button.
    public static let defaults = SavingsCalculatorAssumptions(
        gasPrice: 3.5,
        mpg: 30,
        electricityRate: 0.13
    )
}

// MARK: - Input parsing + formatting (web `Number(...) || n` guards)

public extension SavingsCalculatorAssumptions {
    /// Parses a gas-price / electricity-rate field, mirroring the web
    /// `Number(e.target.value) || 0`: an empty or non-numeric entry (and any
    /// non-finite value) collapses to `0`; a literal `0` stays `0`.
    static func parseRate(_ text: String) -> Double {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard let value = Double(trimmed), value.isFinite else { return 0 }
        return value
    }

    /// Parses the MPG field, mirroring the web `Number(e.target.value) || 1`:
    /// because `0` is falsy in JS, an empty / non-numeric entry *and* a literal
    /// `0` both collapse to `1` (which also guards the divide-by-MPG below).
    static func parseMpg(_ text: String) -> Double {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard let value = Double(trimmed), value.isFinite, value != 0 else { return 1 }
        return value
    }

    /// Renders an assumption value back into field text the way JS stringifies a
    /// number: no grouping separators and no trailing `.0` (e.g. `30` not `30.0`,
    /// `3.5`, `0.13`). Used to seed the fields and to restore defaults.
    static func fieldText(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 12
        return formatter.string(from: NSNumber(value: value)) ?? "0"
    }
}

// MARK: - GasComparison (web `types.ts` GasComparison)

/// The computed gas-vs-electric comparison (web `GasComparison`). Reproduces the
/// parent hook's `gasComparison` memo (`useCostAnalysisData.ts` L175-200) exactly,
/// including its quirks: the EV "actual cost" the card surfaces is the real
/// charging spend (`actualCost`), and the monthly figure amortizes the
/// (gas − EV) delta over the window's month count.
public struct GasComparison: Equatable, Sendable {
    /// Equivalent gas cost for the same distance (web `gasCost`).
    public let gasCost: Double
    /// Energy × electricity rate (web `evCost`).
    public let evCost: Double
    /// Real charging spend the EV card surfaces (web `actualCost`).
    public let actualCost: Double
    /// Gas cost minus real charging spend (web `savings`).
    public let savings: Double
    /// (gas − EV) amortized over the window's months (web `monthlySavings`).
    public let monthlySavings: Double
    /// Monthly savings × 12 (web `yearlySavings`).
    public let yearlySavings: Double
    /// Gas cost per display-distance unit (web `costPerMileGas`).
    public let costPerDistanceGas: Double
    /// Charging spend per display-distance unit (web `costPerMileEV`).
    public let costPerDistanceEV: Double

    public init(
        gasCost: Double,
        evCost: Double,
        actualCost: Double,
        savings: Double,
        monthlySavings: Double,
        yearlySavings: Double,
        costPerDistanceGas: Double,
        costPerDistanceEV: Double
    ) {
        self.gasCost = gasCost
        self.evCost = evCost
        self.actualCost = actualCost
        self.savings = savings
        self.monthlySavings = monthlySavings
        self.yearlySavings = yearlySavings
        self.costPerDistanceGas = costPerDistanceGas
        self.costPerDistanceEV = costPerDistanceEV
    }
}

public extension GasComparison {
    /// Builds the comparison from the resolved aggregates + the live assumptions,
    /// reproducing the web `gasComparison` memo. Guards every divisor so a
    /// zero-distance / zero-MPG window yields `0` rather than a non-finite value.
    static func make(
        data: SavingsCalculatorData,
        assumptions: SavingsCalculatorAssumptions
    ) -> GasComparison {
        let distance = data.displayDistance
        let gallonsNeeded = assumptions.mpg > 0 ? distance / assumptions.mpg : 0
        let gasCostCalc = gallonsNeeded * assumptions.gasPrice
        let evCostCalc = data.energyKwh * assumptions.electricityRate
        let monthlySavings = data.monthsCount > 0
            ? (gasCostCalc - evCostCalc) / Double(data.monthsCount)
            : 0

        return GasComparison(
            gasCost: gasCostCalc,
            evCost: evCostCalc,
            actualCost: data.costDollars,
            savings: gasCostCalc - data.costDollars,
            monthlySavings: monthlySavings,
            yearlySavings: monthlySavings * 12,
            costPerDistanceGas: distance > 0 ? gasCostCalc / distance : 0,
            costPerDistanceEV: distance > 0 ? data.costDollars / distance : 0
        )
    }
}
