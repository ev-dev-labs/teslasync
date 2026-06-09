//
//  SleepEfficiencyWidget.Support.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  The pure (network-free, render-free) support layer for the surface: the P1/S10 i18n facade, the web
//  `fmtNumber` number formatting + the `RadialGauge` readout rule (integer → 0 decimals, else global
//  precision), the `efficiencyColor` zone mapping, the display-boundary `SleepProjection` adapter (cached →
//  render-ready), and the testable accessibility summary. Split out of the model so each file stays within
//  the SwiftLint file-length budget.
//
//  Web source: features/dashboard/widgets/SleepEfficiencyWidget.tsx. The widget reads the `/analytics/sleep`
//  payload and derives the gauge percent, the ×24 daily drain, the asleep/offline sleep hours, and the wake
//  event count — all at the display boundary.
//

import Foundation
import SwiftUI

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "SleepEfficiencyWidget" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time.
public enum SleepEfficiencyStrings {
    public static let table = "SleepEfficiencyWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Number formatting (web `fmtNumber` + `RadialGauge` readout rule)

/// Locale-aware formatting matching the web `numberFormat.ts` helpers. `fmtNumber` is reproduced with a
/// fixed-fraction `NumberFormatter`; the gauge readout reproduces the `RadialGauge` rule
/// (`decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())`, with the global precision default
/// of 2).
public enum SleepFormat {
    /// The web `getGlobalPrecision()` default used by the gauge readout for non-integer values.
    public static let gaugePrecision = 2

    /// The literal percent unit the web stats / gauge render (`unit: '%'`).
    public static let percentUnit = "%"

    /// The web compact gauge readout (`{fmtNumber(clamped, d)}` where the clamped value is bounded to the
    /// gauge `max`): integer values drop the fraction, otherwise the global precision is used.
    public static func gaugeValue(_ value: Double, max: Double, locale: Locale = .sleepDefault) -> String {
        let safe = value.isFinite ? value : 0
        let clamped = Swift.min(Swift.max(safe, 0), max)
        let isInteger = clamped == clamped.rounded(.towardZero)
        return number(clamped, decimals: isInteger ? 0 : gaugePrecision, locale: locale)
    }

    /// Fixed-fraction formatting with grouping (web `fmtNumber` → `Intl.NumberFormat`), NaN/Inf coerced to
    /// zero exactly like the web `safeNumber`.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .sleepDefault) -> String {
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
    static let sleepDefault = Locale(identifier: "en_US")
}

// MARK: - Efficiency zone (web `efficiencyColor` thresholds)

/// The sleep-efficiency band that colors the gauge (web `efficiencyColor`: > 95 green, > 85 amber, else
/// red), mapped onto the SI design-token status colors so it tracks light / dark / high-contrast themes.
public enum SleepZone: String, Sendable, Equatable {
    case high
    case medium
    case low

    /// Classifies the (unrounded) efficiency percentage into its band, exactly like the web thresholds.
    public static func classify(percent: Double) -> SleepZone {
        if percent > 95 { return .high }
        if percent > 85 { return .medium }
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

/// One supporting stat shown beneath the gauge on the expanded tile (web `GaugeHeroStat { value, unit? }`).
/// [labelKey] is a localization key resolved at render; [value] is the caller-formatted number string and
/// [unit] is the optional unit suffix (web renders it in a smaller, secondary span).
public struct SleepStat: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String?

    public init(id: String, labelKey: String, labelFallback: String, value: String, unit: String? = nil) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
    }
}

// MARK: - Display-boundary projection (adapter: cached payload → render-ready)

/// The render-ready projection of a `SleepEfficiencyInput`, computed at the display boundary. Pure + public
/// so the data → display mapping (web `efficiencyPct`, `efficiencyColor`, the ×24 daily drain, the
/// asleep/offline sleep-hours sum, the wake-event count) is unit-tested without rendering the view.
public struct SleepProjection: Sendable, Equatable {
    /// Whether a payload was present (web `hasData = data != null`).
    public var hasData: Bool
    /// The (unrounded) efficiency percentage (web `efficiencyPct = data?.sleep_efficiency_pct ?? 0`).
    public var efficiencyPercent: Double
    /// The gauge fill fraction (0…1) — `efficiencyPct` clamped to the gauge's `max = 100` domain.
    public var gaugeFraction: Double
    /// The gauge's centered readout value (web `RadialGauge` `fmtNumber(clamped, d)`), e.g. `92` / `92.50`.
    public var gaugeValueText: String
    /// The gauge readout unit suffix (web gauge `unit: '%'`).
    public var gaugeUnit: String
    /// The band that colors the gauge (web `efficiencyColor`).
    public var zone: SleepZone
    /// "Avg Drain/Day" stat value — `fmtNumber((sentry_off_drain_rate ?? 0) * 24, 2)`.
    public var avgDrainText: String
    /// "Total Sleep" stat value — `fmtNumber(totalSleepHours, 0)` over the asleep/offline minutes.
    public var totalSleepText: String
    /// "Wake Events" stat value — `recent_events.length` rendered as a plain integer (web renders the raw
    /// number with no grouping).
    public var wakeEventsText: String

    public init(
        hasData: Bool,
        efficiencyPercent: Double,
        gaugeFraction: Double,
        gaugeValueText: String,
        gaugeUnit: String,
        zone: SleepZone,
        avgDrainText: String,
        totalSleepText: String,
        wakeEventsText: String
    ) {
        self.hasData = hasData
        self.efficiencyPercent = efficiencyPercent
        self.gaugeFraction = gaugeFraction
        self.gaugeValueText = gaugeValueText
        self.gaugeUnit = gaugeUnit
        self.zone = zone
        self.avgDrainText = avgDrainText
        self.totalSleepText = totalSleepText
        self.wakeEventsText = wakeEventsText
    }

    /// The web gauge ceiling (`max = 100`).
    public static let percentMax: Double = 100

    /// The parked states the web counts as sleep (`s.state === 'asleep' || s.state === 'offline'`).
    public static let sleepStates: Set<String> = ["asleep", "offline"]

    /// The empty projection used before data resolves and while the body shows its empty state.
    public static let empty = SleepProjection(
        hasData: false,
        efficiencyPercent: 0,
        gaugeFraction: 0,
        gaugeValueText: "0",
        gaugeUnit: SleepFormat.percentUnit,
        zone: .low,
        avgDrainText: "0.00",
        totalSleepText: "0",
        wakeEventsText: "0"
    )

    /// The three supporting stats shown on the expanded tile (web `stats` memo), in source order. The hours
    /// unit is resolved through the i18n facade (web `t('widget.sleepEfficiency.hours', 'h')`).
    public var stats: [SleepStat] {
        [
            SleepStat(
                id: "drain",
                labelKey: "widget.sleepEfficiency.avgDrain",
                labelFallback: "Avg Drain/Day",
                value: avgDrainText,
                unit: SleepFormat.percentUnit
            ),
            SleepStat(
                id: "sleep",
                labelKey: "widget.sleepEfficiency.totalSleep",
                labelFallback: "Total Sleep",
                value: totalSleepText,
                unit: SleepEfficiencyStrings.string("widget.sleepEfficiency.hours", "h")
            ),
            SleepStat(
                id: "wake",
                labelKey: "widget.sleepEfficiency.wakeEvents",
                labelFallback: "Wake Events",
                value: wakeEventsText,
                unit: nil
            )
        ]
    }

    /// Builds the projection from a cached payload at the display boundary, applying the formatting locale.
    /// `nil` yields `.empty` (web renders the `EmptyState`).
    public static func make(from input: SleepEfficiencyInput?, locale: Locale = .sleepDefault) -> SleepProjection {
        guard let input else { return .empty }

        let rawPercent = input.sleepEfficiencyPct ?? 0
        let safePercent = rawPercent.isFinite ? rawPercent : 0
        let fraction = Swift.min(Swift.max(safePercent / percentMax, 0), 1)

        let drainPerDay = (input.sentryOffDrainRate ?? 0) * 24

        let sleepMinutes = input.stateDistribution
            .filter { sleepStates.contains($0.state) }
            .reduce(0.0) { $0 + ($1.totalMinutes ?? 0) }
        let sleepHours = sleepMinutes / 60

        return SleepProjection(
            hasData: true,
            efficiencyPercent: safePercent,
            gaugeFraction: fraction,
            gaugeValueText: SleepFormat.gaugeValue(safePercent, max: percentMax, locale: locale),
            gaugeUnit: SleepFormat.percentUnit,
            zone: .classify(percent: safePercent),
            avgDrainText: SleepFormat.number(drainPerDay, decimals: 2, locale: locale),
            totalSleepText: SleepFormat.number(sleepHours, decimals: 0, locale: locale),
            wakeEventsText: String(input.recentEventsCount ?? 0)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the sleep content. Pure + public so the a11y label content can be
/// unit-tested without rendering the view.
public enum SleepEfficiencyAccessibility {
    public static func summary(for projection: SleepProjection) -> String {
        guard projection.hasData else {
            return SleepEfficiencyStrings.string("widget.sleepEfficiency.noData", "No sleep efficiency data")
        }
        let efficiency = SleepEfficiencyStrings.string("widget.sleepEfficiency.efficiency", "Efficiency")
        var parts = ["\(efficiency) \(projection.gaugeValueText)\(projection.gaugeUnit)"]
        for stat in projection.stats {
            let label = SleepEfficiencyStrings.string(stat.labelKey, stat.labelFallback)
            if let unit = stat.unit {
                parts.append("\(label): \(stat.value) \(unit)")
            } else {
                parts.append("\(label): \(stat.value)")
            }
        }
        return parts.joined(separator: ". ")
    }
}
