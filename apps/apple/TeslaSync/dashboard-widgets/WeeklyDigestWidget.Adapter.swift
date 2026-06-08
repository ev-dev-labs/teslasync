//
//  WeeklyDigestWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  Pure (Foundation-only) projection: the cached `WeeklyDigestDTO` + `WeeklyDigestUnitPrefs` → the
//  four comparison-metric rows, reproducing the web source's numeric + delta pipeline VERBATIM so
//  the native surface shows the exact same values as features/dashboard/widgets/WeeklyDigestWidget.tsx
//  (and its shared WidgetComparisonCard / Delta). Free of SwiftUI so it executes on a plain host and
//  is pinned by unit tests.
//
//  Parity note (covenant #5 / #9 — reproduce, do NOT "correct"): the web widget feeds the km distance
//  and Wh·km efficiency through `convertDistanceFromSI` / `toEfficiencyDisplay` after a km→mi
//  (`distanceKm * KM_TO_MI`) and Wh·km→Wh·mi (`efficiency * MI_TO_KM`) pre-scale. The shared sibling
//  WeeklySummaryCardWidget.tsx applies the identical transform, so it is a codebase-wide convention.
//  The pre-scale makes the absolute distance/efficiency values small, but every per-metric PERCENT
//  delta is ratio-preserving and therefore unchanged. Cross-platform value parity means native must
//  render byte-for-byte the same strings the web renders for the same input.
//

import Foundation

// MARK: - Web unit constants (ported 1:1 from lib/constants.ts `UNITS`)

private enum WeeklyDigestUnitConstants {
    /// `UNITS.KM_TO_MI` — kilometres → miles pre-scale applied to the distance before display.
    static let kmToMi = 0.621371
    /// `UNITS.MI_TO_KM` — the Wh·km → Wh·mi pre-scale applied to the efficiency before display.
    static let miToKm = 1.60934
    /// The `toEfficiencyDisplay` imperial factor (web literal `1.609344`).
    static let efficiencyImperialFactor = 1.609344
}

// MARK: - Conversion + number formatting (ported from web lib/)

/// `convertDistanceFromSI(meters, to)` (lib/unitConversion.ts): divide by the unit's metres-per-unit
/// factor. Non-finite input collapses to zero, matching the web `safeNumber` guard.
func convertWeeklyDigestDistanceFromSI(_ value: Double, to unit: WeeklyDigestDistanceUnit) -> Double {
    let safe = value.isFinite ? value : 0
    return safe / unit.metersPerUnit
}

/// Locale-aware number formatting mirroring the web `fmtNumber` / `fmtInt` (`Intl.NumberFormat`).
public enum WeeklyDigestFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from zero
    /// to match `Intl.NumberFormat`'s default `halfExpand` for the non-negative quantities here.
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs: the four metric labels the web reads via `t()`, the
/// em-dash shown for an undefined delta (web `Delta` `'—'` fallback when the prior value is 0), and the
/// VoiceOver trend phrases. Injected so the projection stays Foundation-only and host-testable.
public struct WeeklyDigestCopy: Sendable, Equatable {
    public var distanceLabel: String
    public var drivesLabel: String
    public var energyLabel: String
    public var efficiencyLabel: String
    /// Web `Delta` `pctText ?? '—'` glyph (rendered when the prior period value is 0).
    public var emDash: String
    /// VoiceOver: "%@" is the formatted percent — e.g. "trending up 25.0%".
    public var a11yTrendUp: String
    public var a11yTrendDown: String
    public var a11yTrendFlat: String
    public var a11yNoComparison: String

    public init(
        distanceLabel: String = "Distance",
        drivesLabel: String = "Drives",
        energyLabel: String = "Energy",
        efficiencyLabel: String = "Efficiency",
        emDash: String = "—",
        a11yTrendUp: String = "trending up %@",
        a11yTrendDown: String = "trending down %@",
        a11yTrendFlat: String = "no change",
        a11yNoComparison: String = "no prior data"
    ) {
        self.distanceLabel = distanceLabel
        self.drivesLabel = drivesLabel
        self.energyLabel = energyLabel
        self.efficiencyLabel = efficiencyLabel
        self.emDash = emDash
        self.a11yTrendUp = a11yTrendUp
        self.a11yTrendDown = a11yTrendDown
        self.a11yTrendFlat = a11yTrendFlat
        self.a11yNoComparison = a11yNoComparison
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = WeeklyDigestCopy()
}

// MARK: - Projected metric row (web `WidgetComparisonCard` `MetricRow`)

/// One projected comparison row: the metric label, the formatted current value + optional unit, and
/// the resolved percent delta. Mirrors the web `MetricRow` (`label`, `formattedCurrent + unit`,
/// `<Delta percent>`).
public struct WeeklyDigestMetricRow: Identifiable, Equatable {
    public let kind: WeeklyDigestMetricKind
    public let label: String
    public let valueText: String
    public let unit: String?
    public let deltaText: String
    public let deltaDirection: WeeklyDigestDeltaDirection
    public let deltaTone: WeeklyDigestDeltaTone
    public let accessibilityLabel: String

    public var id: WeeklyDigestMetricKind {
        kind
    }

    public init(
        kind: WeeklyDigestMetricKind,
        label: String,
        valueText: String,
        unit: String?,
        deltaText: String,
        deltaDirection: WeeklyDigestDeltaDirection,
        deltaTone: WeeklyDigestDeltaTone,
        accessibilityLabel: String
    ) {
        self.kind = kind
        self.label = label
        self.valueText = valueText
        self.unit = unit
        self.deltaText = deltaText
        self.deltaDirection = deltaDirection
        self.deltaTone = deltaTone
        self.accessibilityLabel = accessibilityLabel
    }

    /// The combined `value unit` string (web renders both in one `<span>`).
    public var valueWithUnit: String {
        guard let unit, !unit.isEmpty else { return valueText }
        return "\(valueText) \(unit)"
    }
}

// MARK: - Projection

/// The projected widget content: the four comparison rows (empty when the digest is absent, the web
/// `!data → metrics = []` empty-state branch).
public struct WeeklyDigestProjection: Equatable {
    public let metrics: [WeeklyDigestMetricRow]

    public init(metrics: [WeeklyDigestMetricRow]) {
        self.metrics = metrics
    }

    public var isEmpty: Bool {
        metrics.isEmpty
    }

    /// The web `WidgetComparisonCard` compact slice — the first two rows (Distance, Drives).
    public func visibleMetrics(compact: Bool) -> [WeeklyDigestMetricRow] {
        compact ? Array(metrics.prefix(2)) : metrics
    }
}

// MARK: - Projector

/// Pure projector: cached `WeeklyDigestDTO` + unit prefs → `WeeklyDigestProjection`. Every value uses
/// the same arithmetic + formatting as the web widget so the web and native dashboards render
/// identical rows side by side.
public enum WeeklyDigestProjector {
    /// The raw inputs for one metric row, bundled so the row builder stays within the argument budget.
    private struct MetricInput {
        let kind: WeeklyDigestMetricKind
        let label: String
        let value: String
        let unit: String?
        let now: Double
        let prev: Double
    }

    /// Builds the four comparison rows. `nil` data reproduces the web `if (!data) return []` branch.
    public static func project(
        data: WeeklyDigestDTO?,
        units: WeeklyDigestUnitPrefs,
        copy: WeeklyDigestCopy = .fallback
    ) -> WeeklyDigestProjection {
        guard let data else { return WeeklyDigestProjection(metrics: []) }
        return WeeklyDigestProjection(metrics: rows(data: data, units: units, copy: copy))
    }

    /// Web `toEfficiencyDisplay(whPerKm) = unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm`.
    static func applyEfficiencyDisplay(_ value: Double, unit: WeeklyDigestDistanceUnit) -> Double {
        unit.isImperial ? value * WeeklyDigestUnitConstants.efficiencyImperialFactor : value
    }

    /// The four `ComparisonMetric`s, computed with the web transform (see the file header parity note).
    private static func rows(
        data: WeeklyDigestDTO,
        units: WeeklyDigestUnitPrefs,
        copy: WeeklyDigestCopy
    ) -> [WeeklyDigestMetricRow] {
        let locale = units.localeIdentifier
        let kmToMi = WeeklyDigestUnitConstants.kmToMi
        let miToKm = WeeklyDigestUnitConstants.miToKm

        let dist = convertWeeklyDigestDistanceFromSI((data.distanceKm ?? 0) * kmToMi, to: units.distance)
        let prevDist = convertWeeklyDigestDistanceFromSI((data.prevDistanceKm ?? 0) * kmToMi, to: units.distance)
        let eff = applyEfficiencyDisplay((data.efficiency ?? 0) * miToKm, unit: units.distance)
        let prevEff = applyEfficiencyDisplay((data.prevEfficiency ?? 0) * miToKm, unit: units.distance)
        let energy = data.energyKwh ?? 0
        let drives = data.drives ?? 0
        let prevEnergy = data.prevEnergyKwh ?? 0
        let prevDrives = data.prevDrives ?? 0
        let distSym = units.distance.symbol
        let effUnit = units.distance.isImperial ? "Wh/mi" : "Wh/km"

        let distText = WeeklyDigestFormat.number(dist, decimals: 1, localeIdentifier: locale)
        let drivesText = WeeklyDigestFormat.integer(drives, localeIdentifier: locale)
        let energyText = WeeklyDigestFormat.number(energy, decimals: 1, localeIdentifier: locale)
        let effText = WeeklyDigestFormat.number(eff, decimals: 0, localeIdentifier: locale)

        let inputs: [MetricInput] = [
            .init(
                kind: .distance,
                label: copy.distanceLabel,
                value: distText,
                unit: distSym,
                now: dist,
                prev: prevDist
            ),
            .init(kind: .drives, label: copy.drivesLabel, value: drivesText, unit: nil, now: drives, prev: prevDrives),
            .init(
                kind: .energy,
                label: copy.energyLabel,
                value: energyText,
                unit: "kWh",
                now: energy,
                prev: prevEnergy
            ),
            .init(
                kind: .efficiency,
                label: copy.efficiencyLabel,
                value: effText,
                unit: effUnit,
                now: eff,
                prev: prevEff
            )
        ]
        return inputs.map { makeRow($0, copy: copy, locale: locale) }
    }

    private static func makeRow(
        _ input: MetricInput,
        copy: WeeklyDigestCopy,
        locale: String
    ) -> WeeklyDigestMetricRow {
        let resolved = delta(
            current: input.now,
            previous: input.prev,
            higherIsBetter: input.kind.higherIsBetter,
            copy: copy,
            locale: locale
        )
        let valueWithUnit = input.unit.map { "\(input.value) \($0)" } ?? input.value
        return WeeklyDigestMetricRow(
            kind: input.kind,
            label: input.label,
            valueText: input.value,
            unit: input.unit,
            deltaText: resolved.text,
            deltaDirection: resolved.direction,
            deltaTone: resolved.tone,
            accessibilityLabel: "\(input.label), \(valueWithUnit), \(resolved.accessibilityClause)"
        )
    }

    /// The web `Delta` (display = `percent`) computation, ported 1:1:
    ///   signed  = current - previous; percent = previous != 0 ? |signed / |previous|| * 100 : nil
    ///   arrow   = signed > 0 up / signed < 0 down / 0 flat
    ///   tone    = signed == 0 muted; else (higher&&+)||(lower&&-) ? positive : negative
    /// A non-finite input reproduces the `Delta` missing-input guard (em-dash, neutral, flat).
    static func delta(
        current: Double,
        previous: Double,
        higherIsBetter: Bool,
        copy: WeeklyDigestCopy,
        locale: String
    ) -> WeeklyDigestDeltaResult {
        guard current.isFinite, previous.isFinite else {
            return WeeklyDigestDeltaResult(
                text: copy.emDash,
                direction: .flat,
                tone: .neutral,
                accessibilityClause: copy.a11yNoComparison
            )
        }

        let signed = current - previous
        let direction: WeeklyDigestDeltaDirection = signed > 0 ? .up : (signed < 0 ? .down : .flat)
        let percentText: String? = previous == 0
            ? nil
            : WeeklyDigestFormat.number(abs(signed / abs(previous)) * 100, decimals: 1, localeIdentifier: locale) + "%"
        let tone: WeeklyDigestDeltaTone = tone(signed: signed, higherIsBetter: higherIsBetter)
        let clause = accessibilityClause(direction: direction, percentText: percentText, copy: copy)
        return WeeklyDigestDeltaResult(
            text: percentText ?? copy.emDash,
            direction: direction,
            tone: tone,
            accessibilityClause: clause
        )
    }

    /// Web `colorForDelta`: unchanged → muted; a "good" move → positive; otherwise negative.
    private static func tone(signed: Double, higherIsBetter: Bool) -> WeeklyDigestDeltaTone {
        if signed == 0 { return .neutral }
        let positiveOutcome = (higherIsBetter && signed > 0) || (!higherIsBetter && signed < 0)
        return positiveOutcome ? .positive : .negative
    }

    private static func accessibilityClause(
        direction: WeeklyDigestDeltaDirection,
        percentText: String?,
        copy: WeeklyDigestCopy
    ) -> String {
        guard let percentText else { return copy.a11yNoComparison }
        switch direction {
        case .up: return String(format: copy.a11yTrendUp, percentText)
        case .down: return String(format: copy.a11yTrendDown, percentText)
        case .flat: return copy.a11yTrendFlat
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the comparison card. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum WeeklyDigestAccessibility {
    /// The surface title followed by one spoken phrase per visible metric row:
    /// "This Week. Distance, 0.0 mi, trending up 25.0%. Drives, 12, …".
    public static func summary(for projection: WeeklyDigestProjection, title: String, compact: Bool = false) -> String {
        var parts = [title]
        for row in projection.visibleMetrics(compact: compact) {
            parts.append(row.accessibilityLabel)
        }
        return parts.joined(separator: ". ")
    }
}
