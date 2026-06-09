//
//  DriveScoreGaugeWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0039 · DriveScoreGaugeWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `DriveScoreGaugeWidgetScoreDTO` + number prefs →
//  the gauge config, the sub-score stat cluster, and the metric-bar rows, reproducing the web
//  source's colour-banding + numeric pipeline VERBATIM so the native surface shows the exact same
//  values as features/dashboard/widgets/DriveScoreGaugeWidget.tsx.
//
//  Deliberately free of SwiftUI so the banding/formatting compiles and executes on a plain host and
//  is pinned by unit tests. The view layers SwiftUI chrome (the ring, bars, tokens) on top in
//  DriveScoreGaugeWidget.swift / .Views.swift.
//

import Foundation

// MARK: - Score colour bands (ported 1:1 from the web `SCORE_COLORS` / `scoreColor` thresholds)

/// The four score bands the web widget maps a 0-100 score onto. SwiftUI-free so the threshold logic
/// is host-testable; the concrete colours (`#10b981` / `#22d3ee` / `#f59e0b` / `#ef4444`) are applied
/// in the view via `DriveScoreBand.color`.
public enum DriveScoreBand: String, Sendable, Equatable, CaseIterable {
    case excellent
    case good
    case fair
    case poor

    /// Web `scoreColor(score)`: `>= 80` excellent, `>= 60` good, `>= 40` fair, else poor. A non-finite
    /// score collapses to the poor band (matching JS where `NaN >= 80` is `false` all the way down).
    public static func classify(_ score: Double) -> DriveScoreBand {
        guard score.isFinite else { return .poor }
        if score >= 80 { return .excellent }
        if score >= 60 { return .good }
        if score >= 40 { return .fair }
        return .poor
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts + JSX number rendering)

/// Locale-aware number formatting that mirrors the two distinct number renderings the web widget
/// uses: `fmtNumber` (Intl.NumberFormat, grouped, fixed fraction digits) for the gauge readout, and
/// the bare JSX `{number}` / template-literal stringification for the stat values + bar sublabels.
public enum DriveScoreGaugeWidgetFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// The web `RadialGauge` centre readout: `fmtNumber(clamped, d)` where `clamped` is the value
    /// pinned into `0...max` and `d = Number.isInteger(clamped) ? 0 : getGlobalPrecision()`. Grouped +
    /// rounded half away from zero to match `Intl.NumberFormat`'s default for these non-negative scores.
    public static func gaugeValue(_ value: Double, max: Double, precision: Int, localeIdentifier: String) -> String {
        let clamped = Swift.max(0, Swift.min(safeNumber(value), max))
        let decimals = clamped == clamped.rounded() ? 0 : Swift.max(0, precision)
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: clamped)) ?? String(format: "%.\(decimals)f", clamped)
    }

    /// The bare JSX number rendering used for the stat values (`{stat.value}`) and bar sublabels
    /// (`` `${s.value ?? 0}` ``): JavaScript's default `String(number)` — no grouping, `.` decimal,
    /// trailing zeros dropped, integers without a fraction. Non-finite collapses to `0`.
    public static func jsNumber(_ value: Double) -> String {
        let safe = safeNumber(value)
        if safe == safe.rounded() {
            return String(Int(safe))
        }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 15
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs (the gauge unit, the three sub-score labels, the
/// grade fallback, and the two accessibility templates). Injected so the projection stays
/// Foundation-only and host-testable (the view/model resolve these from `DriveScoreGaugeWidgetStrings`).
public struct DriveScoreGaugeCopy: Sendable, Equatable {
    /// Web `unit: t('widget.driveScoreGauge.weekly', 'Weekly score')`.
    public var weeklyScore: String
    /// Web `t('widget.driveScoreGauge.efficiency', 'Efficiency')`.
    public var efficiency: String
    /// Web `t('widget.driveScoreGauge.smoothness', 'Smoothness')`.
    public var smoothness: String
    /// Web `t('widget.driveScoreGauge.speed', 'Speed Discipline')`.
    public var speedDiscipline: String
    /// Web `label: score?.grade ?? '—'` fallback glyph.
    public var gradeUnknown: String
    /// VoiceOver template for the gauge. Args: (1) score value, (2) grade.
    public var overallA11y: String
    /// VoiceOver template for a sub-score. Args: (1) label, (2) value.
    public var subScoreA11y: String

    public init(
        weeklyScore: String = "Weekly score",
        efficiency: String = "Efficiency",
        smoothness: String = "Smoothness",
        speedDiscipline: String = "Speed Discipline",
        gradeUnknown: String = "—",
        overallA11y: String = "Weekly drive score %1$@ out of 100, grade %2$@",
        subScoreA11y: String = "%1$@ %2$@ out of 100"
    ) {
        self.weeklyScore = weeklyScore
        self.efficiency = efficiency
        self.smoothness = smoothness
        self.speedDiscipline = speedDiscipline
        self.gradeUnknown = gradeUnknown
        self.overallA11y = overallA11y
        self.subScoreA11y = subScoreA11y
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = DriveScoreGaugeCopy()
}

// MARK: - Projected pieces (web `WidgetGaugeHero` + `MetricBar`)

/// The projected radial-gauge hero: the arc fill fraction, the centre readout + unit, the grade
/// label below, the colour band, and a spoken accessibility label. Mirrors the web `RadialGauge`
/// (`value` / `max` / `label` / `unit` / `color`) inside `WidgetGaugeHero`.
public struct DriveScoreGaugeWidgetGauge: Equatable {
    public let fraction: Double
    public let valueText: String
    public let unit: String
    public let gradeLabel: String
    public let band: DriveScoreBand
    public let accessibilityLabel: String

    public init(
        fraction: Double,
        valueText: String,
        unit: String,
        gradeLabel: String,
        band: DriveScoreBand,
        accessibilityLabel: String
    ) {
        self.fraction = fraction
        self.valueText = valueText
        self.unit = unit
        self.gradeLabel = gradeLabel
        self.band = band
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One sub-score stat shown in the hero cluster (`WidgetGaugeHero` `stats`): a label over its value.
public struct DriveScoreGaugeWidgetStat: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let valueText: String

    public init(id: String, label: String, valueText: String) {
        self.id = id
        self.label = label
        self.valueText = valueText
    }
}

/// One sub-score metric bar (web `MetricBar`): a label + value readout above a banded fill bar.
public struct DriveScoreGaugeWidgetBar: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let valueText: String
    public let fraction: Double
    public let band: DriveScoreBand
    public let accessibilityLabel: String

    public init(
        id: String,
        label: String,
        valueText: String,
        fraction: Double,
        band: DriveScoreBand,
        accessibilityLabel: String
    ) {
        self.id = id
        self.label = label
        self.valueText = valueText
        self.fraction = fraction
        self.band = band
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected widget content: the gauge hero + the three sub-score stats + the three metric
/// bars. Computed once per snapshot.
public struct DriveScoreGaugeWidgetProjection: Equatable {
    public let gauge: DriveScoreGaugeWidgetGauge
    public let stats: [DriveScoreGaugeWidgetStat]
    public let bars: [DriveScoreGaugeWidgetBar]

    public init(
        gauge: DriveScoreGaugeWidgetGauge,
        stats: [DriveScoreGaugeWidgetStat],
        bars: [DriveScoreGaugeWidgetBar]
    ) {
        self.gauge = gauge
        self.stats = stats
        self.bars = bars
    }
}

// MARK: - Projection

/// Pure projector: a cached `DriveScoreGaugeWidgetScoreDTO` + number prefs → a
/// `DriveScoreGaugeWidgetProjection`. Every value is computed with the same arithmetic + formatting +
/// colour banding as the web widget so a user with the web and native dashboards open side by side
/// sees an identical gauge.
public enum DriveScoreGaugeWidgetProjector {
    public static let maxScore = 100.0

    /// Stable identity for each sub-score, matching the web `subScores` `key`s.
    private enum SubScoreKey {
        static let efficiency = "efficiency"
        static let smoothness = "smoothness"
        static let speed = "speed"
    }

    /// One sub-score's stable key + pre-localized label + resolved value — the native shape of the web
    /// `subScores` entries, projected into both the stat cluster and the metric bars.
    private struct SubScoreInput {
        let key: String
        let label: String
        let value: Double
    }

    public static func project(
        score: DriveScoreGaugeWidgetScoreDTO,
        format: DriveScoreGaugeWidgetFormatPrefs = DriveScoreGaugeWidgetFormatPrefs(),
        copy: DriveScoreGaugeCopy = .fallback
    ) -> DriveScoreGaugeWidgetProjection {
        // Web: const overall = score?.overall ?? 0; const color = scoreColor(overall).
        let overall = score.overall ?? 0
        let band = DriveScoreBand.classify(overall)

        let valueText = DriveScoreGaugeWidgetFormat.gaugeValue(
            overall,
            max: maxScore,
            precision: format.precision,
            localeIdentifier: format.localeIdentifier
        )
        let gradeLabel = (score.grade?.isEmpty == false) ? (score.grade ?? copy.gradeUnknown) : copy.gradeUnknown
        let gauge = DriveScoreGaugeWidgetGauge(
            fraction: fillFraction(overall),
            valueText: valueText,
            unit: copy.weeklyScore,
            gradeLabel: gradeLabel,
            band: band,
            accessibilityLabel: String(format: copy.overallA11y, valueText, gradeLabel)
        )

        // Web stats + subScores: efficiency, smoothness, speedDiscipline (each `?? 0`).
        let subScores: [SubScoreInput] = [
            SubScoreInput(key: SubScoreKey.efficiency, label: copy.efficiency, value: score.efficiency ?? 0),
            SubScoreInput(key: SubScoreKey.smoothness, label: copy.smoothness, value: score.smoothness ?? 0),
            SubScoreInput(key: SubScoreKey.speed, label: copy.speedDiscipline, value: score.speedDiscipline ?? 0)
        ]

        let stats = subScores.map { sub in
            DriveScoreGaugeWidgetStat(
                id: sub.key,
                label: sub.label,
                valueText: DriveScoreGaugeWidgetFormat.jsNumber(sub.value)
            )
        }

        let bars = subScores.map { sub in
            let text = DriveScoreGaugeWidgetFormat.jsNumber(sub.value)
            return DriveScoreGaugeWidgetBar(
                id: sub.key,
                label: sub.label,
                valueText: text,
                fraction: fillFraction(sub.value),
                band: DriveScoreBand.classify(sub.value),
                accessibilityLabel: String(format: copy.subScoreA11y, sub.label, text)
            )
        }

        return DriveScoreGaugeWidgetProjection(gauge: gauge, stats: stats, bars: bars)
    }

    /// The arc / bar fill fraction in `0...1`. Web `RadialGauge` uses `clamped / max` and `MetricBar`
    /// uses `min((value / max) * 100, 100)`; both reduce to `value` pinned into `0...max`, divided by
    /// `max`. A non-finite value collapses to 0.
    static func fillFraction(_ value: Double, max: Double = maxScore) -> Double {
        let safe = DriveScoreGaugeWidgetFormat.safeNumber(value)
        return Swift.max(0, Swift.min(safe, max)) / max
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge surface. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum DriveScoreGaugeWidgetAccessibility {
    /// The surface title, then the gauge readout, then each sub-score:
    /// "Drive Score. Weekly drive score 85 out of 100, grade A. Efficiency 90 out of 100. …".
    public static func summary(for projection: DriveScoreGaugeWidgetProjection, title: String) -> String {
        var parts = [title, projection.gauge.accessibilityLabel]
        for bar in projection.bars {
            parts.append(bar.accessibilityLabel)
        }
        return parts.joined(separator: ". ")
    }
}
