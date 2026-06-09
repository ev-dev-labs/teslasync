//
//  ChargeCostTrackerWidget.Format.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  Foundation-only unit conversion + number/currency formatting primitives shared by the projector.
//  Ported 1:1 from the web `lib/unitConversion.ts` + `lib/numberFormat.ts` + `useFormatting.ts` so
//  the native surface produces byte-identical display strings. Kept separate from the projector so
//  the numeric helpers stay small and independently testable.
//

import Foundation

// MARK: - Unit conversion (web lib/unitConversion.ts)

/// Energy converter ported 1:1 from `convertEnergyFromSI(wh, 'kWh')` in lib/unitConversion.ts —
/// a divide by 1000. Non-finite inputs collapse to 0, matching the source's `safeNumber` floor.
func convertChargeEnergyFromSIToKwh(_ wattHours: Double) -> Double {
    let safe = wattHours.isFinite ? wattHours : 0
    return safe / 1000
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts
/// — a divide by the unit's metres-per-unit factor.
///
/// The web widget feeds this function a value expressed in *miles* (`totalKwh * AVG_MI_PER_KWH`)
/// while the SI-cutover signature treats the argument as *metres*. We reproduce that exact call
/// chain rather than "correcting" it, so a user with the web and native dashboards open side by
/// side sees identical numbers. See `ChargeCostProjector.computeMetrics`.
func convertChargeDistanceFromSI(_ value: Double, to unit: ChargeCostDistanceUnit) -> Double {
    let safe = value.isFinite ? value : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number / currency formatting (web lib/numberFormat.ts + useFormatting.ts)

/// Locale-aware number + currency formatting that mirrors the web `fmtNumber` (`Intl.NumberFormat`)
/// and `useFormatting().formatCurrency` (`symbol + fmtNumber`).
public enum ChargeCostFormat {
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
