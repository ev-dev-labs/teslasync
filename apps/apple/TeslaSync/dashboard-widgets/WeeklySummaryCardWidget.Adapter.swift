//
//  WeeklySummaryCardWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `WeeklyDigestDTO` + `WeeklyUnitPrefs`
//  → display strings + week-over-week trend chips, reproducing the web source's
//  numeric pipeline VERBATIM so the native surface shows the exact same values
//  as features/dashboard/widgets/WeeklySummaryCardWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can
//  be compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web lib/constants.ts)

private enum WeeklyConstants {
    /// `UNITS.KM_TO_MI` from lib/constants.ts. The web widget turns the API's
    /// kilometres into the codebase's internal miles before display conversion.
    static let kmToMile = 0.621371
    /// `UNITS.MI_TO_KM` from lib/constants.ts. The web widget turns the API's
    /// Wh/km efficiency into Wh/mi-basis before the display conversion.
    static let miToKm = 1.60934
    /// The exact metres-per-mile factor the web `toEfficiencyDisplay` multiplies
    /// by for the mile preference (`whPerKm * 1.609344`). Distinct from the
    /// rounded `MI_TO_KM` above — both are reproduced exactly for parity.
    static let exactMilePerKm = 1.609344
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// lib/unitConversion.ts — a divide by the unit's metres-per-unit factor.
///
/// The web widget feeds this function a value already expressed in miles
/// (`distanceKm * KM_TO_MI`), matching the source's `metrics.distance`
/// computation exactly. We reproduce that call chain verbatim for cross-platform
/// value parity rather than "correcting" it, so a user with the web and native
/// dashboards open side by side sees identical numbers. See
/// `WeeklySummaryBuilder.metrics`.
func convertWeeklyDistanceFromSI(_ value: Double, to unit: WeeklyDistanceUnit) -> Double {
    let safe = value.isFinite ? value : 0
    return safe / unit.metersPerUnit
}

// MARK: - WeeklySummaryBuilder (port of the web widget's `metrics` memo + `trendOf`)

/// Pure functions that turn the cached weekly-digest snapshot into the
/// display-unit `WeeklySummaryProjection`. A 1:1 port of the web source so both
/// platforms show identical numbers and trend chips.
public enum WeeklySummaryBuilder {
    /// The verbatim port of the web `metrics` memo: converts the cached digest
    /// into display-unit numbers. Distance is `distanceKm * KM_TO_MI` fed through
    /// `convertDistanceFromSI`; efficiency is `efficiency * MI_TO_KM` then, for
    /// the mile preference, `* 1.609344`.
    public static func metrics(from dto: WeeklyDigestDTO, units: WeeklyUnitPrefs) -> WeeklyMetrics {
        let unit = units.distance

        // distMi = (distanceKm) * KM_TO_MI ; distance = convertDistanceFromSI(distMi, unit)
        let distMi = dto.distanceKm * WeeklyConstants.kmToMile
        let prevDistMi = dto.prevDistanceKm * WeeklyConstants.kmToMile

        // effWhMi = efficiency * MI_TO_KM ; display = unit == mi ? effWhMi * 1.609344 : effWhMi
        let effWhMi = dto.efficiency * WeeklyConstants.miToKm
        let prevEffWhMi = dto.prevEfficiency * WeeklyConstants.miToKm

        return WeeklyMetrics(
            distance: convertWeeklyDistanceFromSI(distMi, to: unit),
            prevDistance: convertWeeklyDistanceFromSI(prevDistMi, to: unit),
            energy: dto.energyKwh,
            prevEnergy: dto.prevEnergyKwh,
            cost: dto.cost,
            prevCost: dto.prevCost,
            efficiency: efficiencyDisplay(effWhMi, unit: unit),
            prevEfficiency: efficiencyDisplay(prevEffWhMi, unit: unit),
            drives: dto.drives,
            prevDrives: dto.prevDrives
        )
    }

    /// `toEfficiencyDisplay(whPerKm)` — `unit == mi ? whPerKm * 1.609344 : whPerKm`.
    private static func efficiencyDisplay(_ whPerKm: Double, unit: WeeklyDistanceUnit) -> Double {
        unit == .miles ? whPerKm * WeeklyConstants.exactMilePerKm : whPerKm
    }

    /// The verbatim port of the web `trendOf(current, previous, lowerIsPositive)`:
    ///   • `previous == 0`        → flat, "—" (no semantic colour)
    ///   • `abs(pct) < 1`         → flat, "~0%"
    ///   • otherwise              → up/down by sign; `positive` per `lowerIsPositive`;
    ///                              value = `fmtPercent(abs(pct), 0)`.
    public static func trend(
        current: Double,
        previous: Double,
        lowerIsPositive: Bool = false,
        localeIdentifier: String = "en_US"
    ) -> WeeklyTrend {
        if previous == 0 {
            return WeeklyTrend(direction: .flat, value: "—", positive: nil)
        }
        let pct = ((current - previous) / abs(previous)) * 100
        if abs(pct) < 1 {
            return WeeklyTrend(direction: .flat, value: "~0%", positive: nil)
        }
        let direction: WeeklyTrendDirection = pct > 0 ? .up : .down
        let positive = lowerIsPositive ? pct < 0 : pct > 0
        let value = WeeklyNumberFormat.percent(abs(pct), localeIdentifier: localeIdentifier)
        return WeeklyTrend(direction: direction, value: value, positive: positive)
    }

    /// Builds the formatted projection from the cached digest. Returns `nil`
    /// when there is no cached snapshot (the web renders its empty state when
    /// `metrics` — i.e. `data` — is absent).
    public static func project(_ dto: WeeklyDigestDTO?, units: WeeklyUnitPrefs) -> WeeklySummaryProjection? {
        guard let dto else { return nil }
        let metrics = metrics(from: dto, units: units)
        let locale = units.localeIdentifier

        return WeeklySummaryProjection(
            distanceValue: WeeklyNumberFormat.number(metrics.distance, fractionDigits: 1, localeIdentifier: locale),
            distanceCompactValue: WeeklyNumberFormat.number(
                metrics.distance,
                fractionDigits: 0,
                localeIdentifier: locale
            ),
            distanceUnit: units.distance.symbol,
            distanceTrend: trend(
                current: metrics.distance,
                previous: metrics.prevDistance,
                localeIdentifier: locale
            ),
            energyValue: WeeklyNumberFormat.number(metrics.energy, fractionDigits: 1, localeIdentifier: locale),
            energyTrend: trend(
                current: metrics.energy,
                previous: metrics.prevEnergy,
                localeIdentifier: locale
            ),
            costValue: WeeklyNumberFormat.currency(
                metrics.cost,
                symbol: units.currencySymbol,
                precision: units.precision,
                localeIdentifier: locale
            ),
            costTrend: trend(
                current: metrics.cost,
                previous: metrics.prevCost,
                lowerIsPositive: true,
                localeIdentifier: locale
            ),
            efficiencyValue: WeeklyNumberFormat.number(metrics.efficiency, fractionDigits: 0, localeIdentifier: locale),
            efficiencyUnit: units.distance.efficiencyLabel,
            efficiencyTrend: trend(
                current: metrics.efficiency,
                previous: metrics.prevEfficiency,
                lowerIsPositive: true,
                localeIdentifier: locale
            )
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the stat grid. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum WeeklySummaryAccessibility {
    /// One spoken clause per stat (label + value [+ unit] [+ trend]), prefixed by
    /// the surface title, e.g. "Weekly Summary. Distance 3.1 km up 25%. …".
    public static func summary(for projection: WeeklySummaryProjection) -> String {
        let title = WeeklySummaryStrings.string("widget.weeklySummary.title", "Weekly Summary")
        var parts = [title]
        parts.append(clause(
            label: WeeklySummaryStrings.string("widget.weeklySummary.distance", "Distance"),
            value: projection.distanceValue,
            unit: projection.distanceUnit,
            trend: projection.distanceTrend
        ))
        parts.append(clause(
            label: WeeklySummaryStrings.string("widget.weeklySummary.energy", "Energy"),
            value: projection.energyValue,
            unit: "kWh",
            trend: projection.energyTrend
        ))
        parts.append(clause(
            label: WeeklySummaryStrings.string("widget.weeklySummary.cost", "Cost"),
            value: projection.costValue,
            unit: nil,
            trend: projection.costTrend
        ))
        parts.append(clause(
            label: WeeklySummaryStrings.string("widget.weeklySummary.efficiency", "Efficiency"),
            value: projection.efficiencyValue,
            unit: projection.efficiencyUnit,
            trend: projection.efficiencyTrend
        ))
        return parts.joined(separator: ". ")
    }

    /// Spoken phrase for one trend chip (omitted entirely for a flat "—" trend).
    public static func trendPhrase(_ trend: WeeklyTrend) -> String? {
        switch trend.direction {
        case .up:
            return WeeklySummaryStrings.string("widget.weeklySummary.trendUp", "up") + " " + trend.value
        case .down:
            return WeeklySummaryStrings.string("widget.weeklySummary.trendDown", "down") + " " + trend.value
        case .flat:
            guard trend.value != "—" else { return nil }
            return WeeklySummaryStrings.string("widget.weeklySummary.trendFlat", "no change")
        }
    }

    private static func clause(label: String, value: String, unit: String?, trend: WeeklyTrend) -> String {
        var clause = unit.map { "\(label) \(value) \($0)" } ?? "\(label) \(value)"
        if let phrase = trendPhrase(trend) {
            clause += " \(phrase)"
        }
        return clause
    }
}
