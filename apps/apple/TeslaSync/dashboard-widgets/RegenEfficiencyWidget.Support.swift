//
//  RegenEfficiencyWidget.Support.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  The pure (network-free, render-free) support layer for the surface: the P1/S10 i18n facade, the web
//  `fmtInt` / `formatEnergy` / `formatPower` number formatting (SI Wh → kWh, SI W → kW at the display
//  boundary, mirroring `useUnits()`), the `regenColor` zone mapping, the display-boundary `RegenProjection`
//  adapter (cached SI → render-ready), and the testable accessibility summary. Split out of the model so
//  each file stays within the SwiftLint file-length budget.
//
//  Web source: features/dashboard/widgets/RegenEfficiencyWidget.tsx (data: useRegenEfficiency / useVehicles
//  / useUnits). The widget reads SI off `/analytics/regen` and converts at the render boundary.
//

import Foundation
import SwiftUI

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "RegenEfficiencyWidget" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time.
public enum RegenEfficiencyStrings {
    public static let table = "RegenEfficiencyWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Number formatting (web `fmtInt` / `formatEnergy` / `formatPower`)

/// Locale-aware formatting matching the web `numberFormat.ts` + `unitConversion.ts` helpers. Energy/power
/// are not user-configurable on the web (`DEFAULT_ENERGY_PREF = 'kWh'`, `DEFAULT_POWER_PREF = 'kW'`), so the
/// SI value is converted with a fixed divisor and rendered at precision 1, with the web `'—'` fallback for
/// nullish / non-finite inputs.
public enum RegenFormat {
    /// Web `pref.energy` unit suffix (`DEFAULT_ENERGY_PREF`).
    public static let energyUnit = "kWh"
    /// Web `pref.power` unit suffix (`DEFAULT_POWER_PREF`).
    public static let powerUnit = "kW"
    /// Web `DEFAULT_EMPTY_DISPLAY` for nullish / NaN inputs.
    public static let emptyDisplay = "—"

    /// Integer formatting with grouping (web `fmtInt(freeCharges ?? 0)`).
    public static func int(_ value: Int, locale: Locale = .regenDefault) -> String {
        number(Double(value), decimals: 0, locale: locale)
    }

    /// The rounded recovery percentage with a `%` suffix (web `${Math.round(regenPct)}%`).
    public static func percent(_ value: Double, locale: Locale = .regenDefault) -> String {
        let rounded = value.isFinite ? value.rounded() : 0
        return "\(number(rounded, decimals: 0, locale: locale))%"
    }

    /// SI watt-hours → display kWh at precision 1 (web `formatEnergy(wh, { precision: 1 })`). Nullish /
    /// non-finite → the empty sentinel.
    public static func energy(_ wh: Double?, locale: Locale = .regenDefault) -> String {
        guard let wh, wh.isFinite else { return emptyDisplay }
        return "\(number(wh / 1000, decimals: 1, locale: locale)) \(energyUnit)"
    }

    /// SI watts → display kW at precision 1 (web `formatPower(watts, { precision: 1 })`). Nullish /
    /// non-finite → the empty sentinel.
    public static func power(_ watts: Double?, locale: Locale = .regenDefault) -> String {
        guard let watts, watts.isFinite else { return emptyDisplay }
        return "\(number(watts / 1000, decimals: 1, locale: locale)) \(powerUnit)"
    }

    /// Fixed-fraction formatting with grouping (web `Intl.NumberFormat`), NaN/Inf coerced to zero.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .regenDefault) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }
}

public extension Locale {
    /// The web default formatting locale (`en-US`) so native numbers match the web golden output.
    static let regenDefault = Locale(identifier: "en_US")
}

// MARK: - Recovery zone (web `regenColor` thresholds)

/// The regen-recovery band that colors the gauge (web `regenColor`: > 30% green, > 15% amber, else red),
/// mapped onto the SI design-token status colors so it tracks light / dark / high-contrast themes.
public enum RegenZone: String, Sendable, Equatable {
    case high
    case medium
    case low

    /// Classifies the recovery percentage into its band (web thresholds applied to the unrounded percent).
    public static func classify(percent: Double) -> RegenZone {
        if percent > 30 { return .high }
        if percent > 15 { return .medium }
        return .low
    }

    /// The design-token color for the band.
    public var color: Color {
        switch self {
        case .high: Color.TS.statusSuccess
        case .medium: Color.TS.statusWarning
        case .low: Color.TS.statusDanger
        }
    }
}

// MARK: - Stat row item (web `GaugeHeroStat`)

/// One supporting stat shown beneath the gauge on the expanded tile (web `GaugeHeroStat`). [labelKey] is a
/// localization key resolved at render; [value] is the caller-formatted display string (already carrying its
/// unit, e.g. `"12.3 kWh"`), exactly like the web stat whose `value` is the `formatEnergy`/`formatPower`
/// output.
public struct RegenStat: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public init(id: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }
}

// MARK: - Display-boundary projection (adapter: cached SI → render-ready)

/// The render-ready projection of a `RegenEfficiencyInput`, computed at the display boundary. Pure + public
/// so the SI → display mapping (web `regenPct`, `regenColor`, `formatEnergy`/`formatPower`/`fmtInt`) is
/// unit-tested without rendering the view.
public struct RegenProjection: Sendable, Equatable {
    /// Whether a payload was present (web `data ? … : <EmptyState />`).
    public var hasData: Bool
    /// The unrounded recovery percentage (web `regenPct = (regenRatio ?? 0) * 100`).
    public var regenPercent: Double
    /// The gauge fill fraction (0…1) — `regenPct` clamped to the gauge's `max = 100` domain.
    public var gaugeFraction: Double
    /// The gauge's centered readout (web `label = ${Math.round(regenPct)}%`).
    public var gaugePercentText: String
    /// The recovery band that colors the gauge (web `regenColor`).
    public var zone: RegenZone
    /// "Total Recovered" stat value — SI Wh → kWh (web `formatEnergy(totalRegenWh, { precision: 1 })`).
    public var totalRecoveredText: String
    /// "Monthly Avg" stat value — SI W → kW (web `formatPower(monthlyAvgRegen, { precision: 1 })`).
    public var monthlyAvgText: String
    /// "Free Charges" stat value (web `fmtInt(freeCharges ?? 0)`).
    public var freeChargesText: String

    public init(
        hasData: Bool,
        regenPercent: Double,
        gaugeFraction: Double,
        gaugePercentText: String,
        zone: RegenZone,
        totalRecoveredText: String,
        monthlyAvgText: String,
        freeChargesText: String
    ) {
        self.hasData = hasData
        self.regenPercent = regenPercent
        self.gaugeFraction = gaugeFraction
        self.gaugePercentText = gaugePercentText
        self.zone = zone
        self.totalRecoveredText = totalRecoveredText
        self.monthlyAvgText = monthlyAvgText
        self.freeChargesText = freeChargesText
    }

    /// The web gauge ceiling (`max = 100`).
    public static let percentMax: Double = 100

    /// The empty projection used before data resolves and while the body shows its empty state.
    public static let empty = RegenProjection(
        hasData: false,
        regenPercent: 0,
        gaugeFraction: 0,
        gaugePercentText: "0%",
        zone: .low,
        totalRecoveredText: RegenFormat.emptyDisplay,
        monthlyAvgText: RegenFormat.emptyDisplay,
        freeChargesText: "0"
    )

    /// The three supporting stats shown on the expanded tile (web `stats` memo), in source order.
    public var stats: [RegenStat] {
        [
            RegenStat(
                id: "total",
                labelKey: "widget.regenEfficiency.totalKwh",
                labelFallback: "Total Recovered",
                value: totalRecoveredText
            ),
            RegenStat(
                id: "monthly",
                labelKey: "widget.regenEfficiency.monthlyAvg",
                labelFallback: "Monthly Avg",
                value: monthlyAvgText
            ),
            RegenStat(
                id: "free",
                labelKey: "widget.regenEfficiency.freeCharges",
                labelFallback: "Free Charges",
                value: freeChargesText
            )
        ]
    }

    /// Builds the projection from a cached payload at the display boundary, applying the formatting locale.
    /// `nil` yields `.empty` (web renders the `EmptyState`).
    public static func make(from input: RegenEfficiencyInput?, locale: Locale = .regenDefault) -> RegenProjection {
        guard let input else { return .empty }

        let percent = (input.regenRatio ?? 0) * 100
        let safePercent = percent.isFinite ? percent : 0
        let fraction = min(max(safePercent / percentMax, 0), 1)

        return RegenProjection(
            hasData: true,
            regenPercent: safePercent,
            gaugeFraction: fraction,
            gaugePercentText: RegenFormat.percent(safePercent, locale: locale),
            zone: .classify(percent: safePercent),
            totalRecoveredText: RegenFormat.energy(input.totalRegenWh, locale: locale),
            monthlyAvgText: RegenFormat.power(input.monthlyAvgRegen, locale: locale),
            freeChargesText: RegenFormat.int(input.freeCharges ?? 0, locale: locale)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the regen content. Pure + public so the a11y label content can be
/// unit-tested without rendering the view.
public enum RegenEfficiencyAccessibility {
    public static func summary(for projection: RegenProjection) -> String {
        guard projection.hasData else {
            return RegenEfficiencyStrings.string("widget.regenEfficiency.noData", "No regen data")
        }
        let recovery = RegenEfficiencyStrings.string("widget.regenEfficiency.recovery", "recovery")
        var parts = ["\(projection.gaugePercentText) \(recovery)"]
        parts.append(
            "\(RegenEfficiencyStrings.string("widget.regenEfficiency.totalKwh", "Total Recovered")): "
                + projection.totalRecoveredText
        )
        parts.append(
            "\(RegenEfficiencyStrings.string("widget.regenEfficiency.monthlyAvg", "Monthly Avg")): "
                + projection.monthlyAvgText
        )
        parts.append(
            "\(RegenEfficiencyStrings.string("widget.regenEfficiency.freeCharges", "Free Charges")): "
                + projection.freeChargesText
        )
        return parts.joined(separator: ". ")
    }
}
