//
//  BatteryHealthAnalyticsWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0014 · BatteryHealthAnalyticsWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `BatteryHealthAnalyticsWidgetDTO` + number prefs →
//  the gauge config and the six battery-health stats, reproducing the web source's colour-banding +
//  numeric pipeline VERBATIM so the native surface shows the exact same values as
//  features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx.
//
//  Deliberately free of SwiftUI so the banding/formatting compiles and executes on a plain host and
//  is pinned by unit tests. The view layers SwiftUI chrome (the ring, the stat cluster, tokens) on
//  top in BatteryHealthAnalyticsWidget.swift / .Views.swift.
//

import Foundation

// MARK: - Score colour bands (ported 1:1 from the web `scoreColor` thresholds)

/// The three score bands the web widget maps a 0-100 state-of-health onto. SwiftUI-free so the
/// threshold logic is host-testable; the concrete colours (`#10b981` / `#f59e0b` / `#ef4444`) are
/// applied in the view via `BatteryHealthScoreBand.color`.
public enum BatteryHealthScoreBand: String, Sendable, Equatable, CaseIterable {
    case good
    case fair
    case poor

    /// Web `scoreColor(score)`: `>= 80` good (`#10b981`), `>= 50` fair (`#f59e0b`), else poor
    /// (`#ef4444`). A non-finite score collapses to the poor band (matching JS where `NaN >= 80`
    /// is `false` all the way down).
    public static func classify(_ score: Double) -> BatteryHealthScoreBand {
        guard score.isFinite else { return .poor }
        if score >= 80 { return .good }
        if score >= 50 { return .fair }
        return .poor
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the two number renderings the web widget uses:
/// `fmtNumber(value, 0)` / `fmtInt(value)` (Intl.NumberFormat, grouped, zero fraction digits) for
/// every stat + the gauge sub-label, and the `RadialGauge` centre readout `fmtNumber(clamped, d)`
/// where `d = Number.isInteger(clamped) ? 0 : getGlobalPrecision()`.
public enum BatteryHealthAnalyticsWidgetFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Shared `Intl.NumberFormat` parity: grouped, fixed fraction digits, rounded half away from
    /// zero (ECMA-402 default `halfExpand`, which equals `.halfUp` for these non-negative scores).
    private static func grouped(_ value: Double, fractionDigits: Int, localeIdentifier: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// The web `fmtInt(value)` / `fmtNumber(value, 0)`: a grouped integer with zero fraction digits.
    /// Used by all six stats + the gauge's score sub-label. Non-finite collapses to `0`.
    public static func integer(_ value: Double, localeIdentifier: String) -> String {
        grouped(safeNumber(value), fractionDigits: 0, localeIdentifier: localeIdentifier)
    }

    /// The web `RadialGauge` centre readout: `fmtNumber(clamped, d)` where `clamped` is the value
    /// pinned into `0...max` and `d = Number.isInteger(clamped) ? 0 : getGlobalPrecision()`.
    public static func gaugeValue(_ value: Double, max: Double, precision: Int, localeIdentifier: String) -> String {
        let clamped = Swift.max(0, Swift.min(safeNumber(value), max))
        let decimals = clamped == clamped.rounded() ? 0 : Swift.max(0, precision)
        return grouped(clamped, fractionDigits: decimals, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs (the gauge unit, the six stat labels, the two stat
/// unit glyphs, and the gauge accessibility template). Injected so the projection stays
/// Foundation-only and host-testable (the view/model resolve these from
/// `BatteryHealthAnalyticsWidgetStrings`).
public struct BatteryHealthAnalyticsCopy: Sendable, Equatable {
    /// Web `unit: t('widget.batteryHealthAnalytics.score', 'health')` — the gauge centre unit.
    public var scoreUnit: String
    /// Web `t('widget.batteryHealthAnalytics.totalCycles', 'Cycles')`.
    public var totalCycles: String
    /// Web `t('widget.batteryHealthAnalytics.avgChargeDepth', 'Charge Depth')`.
    public var avgChargeDepth: String
    /// Web `t('widget.batteryHealthAnalytics.avgDischargeDepth', 'Discharge')`.
    public var avgDischargeDepth: String
    /// Web `t('widget.batteryHealthAnalytics.dcFastRatio', 'DC Fast')`.
    public var dcFastRatio: String
    /// Web `t('widget.batteryHealthAnalytics.tempExposure', 'Temp Score')`.
    public var tempExposure: String
    /// Web `t('widget.batteryHealthAnalytics.chargeHabits', 'Habits')`.
    public var chargeHabits: String
    /// Web stat `unit: '%'` glyph (percentage stats).
    public var percentUnit: String
    /// Web stat `unit: '/ 100'` glyph (the two `/ 100` score stats).
    public var outOfHundredUnit: String
    /// VoiceOver template for the gauge. Arg: (1) the integer health score.
    public var gaugeA11y: String

    public init(
        scoreUnit: String = "health",
        totalCycles: String = "Cycles",
        avgChargeDepth: String = "Charge Depth",
        avgDischargeDepth: String = "Discharge",
        dcFastRatio: String = "DC Fast",
        tempExposure: String = "Temp Score",
        chargeHabits: String = "Habits",
        percentUnit: String = "%",
        outOfHundredUnit: String = "/ 100",
        gaugeA11y: String = "Battery health %1$@ out of 100"
    ) {
        self.scoreUnit = scoreUnit
        self.totalCycles = totalCycles
        self.avgChargeDepth = avgChargeDepth
        self.avgDischargeDepth = avgDischargeDepth
        self.dcFastRatio = dcFastRatio
        self.tempExposure = tempExposure
        self.chargeHabits = chargeHabits
        self.percentUnit = percentUnit
        self.outOfHundredUnit = outOfHundredUnit
        self.gaugeA11y = gaugeA11y
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = BatteryHealthAnalyticsCopy()
}

// MARK: - Projected pieces (web `WidgetGaugeHero` + `RadialGauge`)

/// The projected radial-gauge hero: the arc fill fraction, the centre readout + unit, the score
/// sub-label below, the colour band, and a spoken accessibility label. Mirrors the web `RadialGauge`
/// (`value` / `max` / `label` / `unit` / `color`) inside `WidgetGaugeHero`.
public struct BatteryHealthAnalyticsWidgetGauge: Equatable {
    public let fraction: Double
    public let valueText: String
    public let unit: String
    public let scoreLabel: String
    public let band: BatteryHealthScoreBand
    public let accessibilityLabel: String

    public init(
        fraction: Double,
        valueText: String,
        unit: String,
        scoreLabel: String,
        band: BatteryHealthScoreBand,
        accessibilityLabel: String
    ) {
        self.fraction = fraction
        self.valueText = valueText
        self.unit = unit
        self.scoreLabel = scoreLabel
        self.band = band
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One stat shown in the hero cluster (`WidgetGaugeHero` `stats`): a muted label over its value,
/// with an optional trailing unit glyph (`%` / `/ 100`). Carries its own spoken accessibility label.
public struct BatteryHealthAnalyticsWidgetStat: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let valueText: String
    public let unit: String
    public let accessibilityLabel: String

    public init(id: String, label: String, valueText: String, unit: String, accessibilityLabel: String) {
        self.id = id
        self.label = label
        self.valueText = valueText
        self.unit = unit
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected widget content: the gauge hero + the six battery-health stats. Computed once
/// per snapshot.
public struct BatteryHealthAnalyticsWidgetProjection: Equatable {
    public let gauge: BatteryHealthAnalyticsWidgetGauge
    public let stats: [BatteryHealthAnalyticsWidgetStat]

    public init(gauge: BatteryHealthAnalyticsWidgetGauge, stats: [BatteryHealthAnalyticsWidgetStat]) {
        self.gauge = gauge
        self.stats = stats
    }
}

// MARK: - Projection

/// Pure projector: a cached `BatteryHealthAnalyticsWidgetDTO` + number prefs → a
/// `BatteryHealthAnalyticsWidgetProjection`. Every value is computed with the same arithmetic +
/// formatting + colour banding as the web widget so a user with the web and native dashboards open
/// side by side sees an identical gauge + stat cluster.
public enum BatteryHealthAnalyticsWidgetProjector {
    public static let maxScore = 100.0

    /// Stable identity for each stat, matching the web `stats` order.
    private enum StatKey {
        static let cycles = "totalCycles"
        static let chargeDepth = "avgChargeDepth"
        static let discharge = "avgDischargeDepth"
        static let dcFast = "dcFastRatio"
        static let tempScore = "tempExposure"
        static let habits = "chargeHabits"
    }

    public static func project(
        data: BatteryHealthAnalyticsWidgetDTO,
        format: BatteryHealthAnalyticsWidgetFormatPrefs = BatteryHealthAnalyticsWidgetFormatPrefs(),
        copy: BatteryHealthAnalyticsCopy = .fallback
    ) -> BatteryHealthAnalyticsWidgetProjection {
        let locale = format.localeIdentifier
        let gauge = projectGauge(data: data, precision: format.precision, locale: locale, copy: copy)
        let stats = projectStats(data: data, locale: locale, copy: copy)
        return BatteryHealthAnalyticsWidgetProjection(gauge: gauge, stats: stats)
    }

    /// Projects the radial-gauge hero. Web: `value = data?.current_soh ?? 0`,
    /// `label = \`${fmtInt(healthScore)}\``, `unit = 'health'`, `color = scoreColor(healthScore)`. The
    /// RadialGauge centre = `fmtNumber(clamped, d)`; the sub-label below the ring = `fmtInt(soh)`.
    private static func projectGauge(
        data: BatteryHealthAnalyticsWidgetDTO,
        precision: Int,
        locale: String,
        copy: BatteryHealthAnalyticsCopy
    ) -> BatteryHealthAnalyticsWidgetGauge {
        let soh = data.currentSoh ?? 0
        let valueText = BatteryHealthAnalyticsWidgetFormat.gaugeValue(
            soh,
            max: maxScore,
            precision: precision,
            localeIdentifier: locale
        )
        let scoreLabel = BatteryHealthAnalyticsWidgetFormat.integer(soh, localeIdentifier: locale)
        return BatteryHealthAnalyticsWidgetGauge(
            fraction: fillFraction(soh),
            valueText: valueText,
            unit: copy.scoreUnit,
            scoreLabel: scoreLabel,
            band: BatteryHealthScoreBand.classify(soh),
            accessibilityLabel: String(format: copy.gaugeA11y, scoreLabel)
        )
    }

    /// Projects the six-stat cluster. Web stats — every value is `fmtInt` / `fmtNumber(_, 0)` (grouped
    /// integer) with the `?? 0` fallbacks; the trailing unit glyph is `''` / `'%'` / `'/ 100'`.
    private static func projectStats(
        data: BatteryHealthAnalyticsWidgetDTO,
        locale: String,
        copy: BatteryHealthAnalyticsCopy
    ) -> [BatteryHealthAnalyticsWidgetStat] {
        [
            makeStat(StatKey.cycles, copy.totalCycles, data.totalCycles, unit: "", locale: locale),
            makeStat(
                StatKey.chargeDepth,
                copy.avgChargeDepth,
                data.fullChargePct,
                unit: copy.percentUnit,
                locale: locale
            ),
            makeStat(
                StatKey.discharge,
                copy.avgDischargeDepth,
                data.avgDepthOfDischarge,
                unit: copy.percentUnit,
                locale: locale
            ),
            makeStat(StatKey.dcFast, copy.dcFastRatio, data.fastChargePct, unit: copy.percentUnit, locale: locale),
            makeStat(
                StatKey.tempScore,
                copy.tempExposure,
                data.tempExposureScore,
                unit: copy.outOfHundredUnit,
                locale: locale
            ),
            makeStat(
                StatKey.habits,
                copy.chargeHabits,
                data.chargeHabitsScore,
                unit: copy.outOfHundredUnit,
                locale: locale
            )
        ]
    }

    /// Projects one stat: grouped-integer value + optional unit glyph + a spoken accessibility label
    /// (label, value, then the spoken unit). `nil` raw values fall back to `0` like the web `?? 0`.
    private static func makeStat(
        _ id: String,
        _ label: String,
        _ rawValue: Double?,
        unit: String,
        locale: String
    ) -> BatteryHealthAnalyticsWidgetStat {
        let valueText = BatteryHealthAnalyticsWidgetFormat.integer(rawValue ?? 0, localeIdentifier: locale)
        let spokenValue = unit.isEmpty ? valueText : "\(valueText) \(unit)"
        return BatteryHealthAnalyticsWidgetStat(
            id: id,
            label: label,
            valueText: valueText,
            unit: unit,
            accessibilityLabel: "\(label) \(spokenValue)"
        )
    }

    /// The arc fill fraction in `0...1`. Web `RadialGauge` uses `clamped / max` where `clamped` is
    /// the value pinned into `0...max`. A non-finite value collapses to 0.
    static func fillFraction(_ value: Double, max: Double = maxScore) -> Double {
        let safe = BatteryHealthAnalyticsWidgetFormat.safeNumber(value)
        return Swift.max(0, Swift.min(safe, max)) / max
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge surface. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum BatteryHealthAnalyticsWidgetAccessibility {
    /// The surface title, then the gauge readout, then each stat:
    /// "Battery Analytics. Battery health 92 out of 100. Cycles 412. Charge Depth 85 %. …".
    public static func summary(for projection: BatteryHealthAnalyticsWidgetProjection, title: String) -> String {
        var parts = [title, projection.gauge.accessibilityLabel]
        for stat in projection.stats {
            parts.append(stat.accessibilityLabel)
        }
        return parts.joined(separator: ". ")
    }
}
