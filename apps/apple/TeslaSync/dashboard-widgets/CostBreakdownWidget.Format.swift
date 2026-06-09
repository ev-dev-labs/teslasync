//
//  CostBreakdownWidget.Format.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  Foundation-only number/currency formatting + the cost-per-distance conversion primitive shared by
//  the projector. Ported 1:1 from the web `lib/numberFormat.ts` + `useFormatting.ts` and the widget's
//  own `MI_TO_KM` conversion so the native surface produces byte-identical display strings. Kept
//  separate from the projector so the numeric helpers stay small and independently testable.
//

import Foundation

// MARK: - Conversion constants (ported from the web widget source)

enum CostBreakdownConstants {
    /// `MI_TO_KM` from features/dashboard/widgets/CostBreakdownWidget.tsx — the kilometres-per-mile
    /// factor used to convert the per-km EV cost into a per-mile cost when the user prefers miles
    /// (`distanceUnit === 'mi' ? cpk * MI_TO_KM : cpk`).
    static let milesToKilometers = 1.60934
}

// MARK: - Cost-per-distance conversion (web widget `costPerDist` useMemo)

/// Converts the API's per-kilometre EV cost into the user's preferred per-distance cost, ported
/// verbatim from the web widget's `costPerDist` memo: a zero cost stays zero (so the `Cost / {{unit}}`
/// tile shows `—`), kilometres pass through unchanged, and miles scale by `MI_TO_KM`.
func convertCostPerDistance(costPerKm: Double, to unit: CostBreakdownDistanceUnit) -> Double {
    let safe = costPerKm.isFinite ? costPerKm : 0
    guard safe != 0 else { return 0 }
    switch unit {
    case .kilometers: return safe
    case .miles: return safe * CostBreakdownConstants.milesToKilometers
    }
}

// MARK: - Number / currency formatting (web lib/numberFormat.ts + useFormatting.ts)

/// Locale-aware number + currency formatting that mirrors the web `fmtNumber` (`Intl.NumberFormat`)
/// and `useFormatting().formatCurrency` (`currencySymbol + fmtNumber`).
public enum CostBreakdownFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Intl.NumberFormat`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `formatCurrency(amount, decimals)` — `currencySymbol + fmtNumber(amount, decimals)`.
    public static func currency(
        _ amount: Double,
        symbol: String,
        precision: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        symbol + number(amount, decimals: precision, localeIdentifier: localeIdentifier)
    }
}
