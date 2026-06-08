//
//  BatteryTab.Adapter.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  The testable projection core: a cached `[BatteryTrendPointDTO]` + `BatteryUnitPrefs` → the
//  view-ready metric cards + chart series, reproducing the web source's numeric pipeline VERBATIM
//  so the native surface shows the exact same values as
//  features/analytics/components/analytics/BatteryTab.tsx:
//    • `safe(v)`                         (chartUtils.tsx)      — non-finite → 0
//    • `convertDistanceFromSI(m, unit)`  (unitConversion.ts)  — metres ÷ metres-per-unit
//    • `convertEnergyFromSI(wh, unit)`   (unitConversion.ts)  — Wh ÷ Wh-per-unit
//    • `fmtNumber / fmtInt`              (numberFormat.ts)     — locale-grouped, fixed digits
//    • `formatEnergy(wh, pref, {p:1})`   (unitConversion.ts)  — "<value> <symbol>"
//    • `date.slice(5)`                   (BatteryTab.tsx)      — "YYYY-MM-DD" → "MM-DD"
//
//  Deliberately SwiftUI-free so the conversion + formatting + projection can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversions (ported 1:1 from web lib/unitConversion.ts)

/// `convertDistanceFromSI(meters, to)` — a divide by the unit's metres-per-unit factor. The web
/// feeds it `range_km * 1000` (SI metres), so this is a straight SI → display conversion. Non-finite
/// inputs collapse to 0 to match the web `safe` guard the caller applies upstream.
func convertBatteryDistanceFromSI(_ meters: Double, to unit: BatteryDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

/// `convertEnergyFromSI(wh, to)` — watt-hours divided by the unit's Wh-per-unit factor
/// (`Wh → wh`, `kWh → wh / 1000`). Non-finite inputs collapse to 0.
func convertBatteryEnergyFromSI(_ wh: Double, to unit: BatteryEnergyUnit) -> Double {
    let safe = wh.isFinite ? wh : 0
    return safe / unit.wattHoursPerUnit
}

// MARK: - Number + energy formatting (ported from numberFormat.ts + unitConversion.ts)

/// Locale-aware numeric + energy formatting that mirrors the web pipeline. `fmtNumber` /
/// `fmtInt` round half away from zero to match `Intl.NumberFormat`'s default `halfExpand` for
/// the non-negative battery quantities; `formatEnergy` reproduces `convertEnergyFromSI` + the
/// `"<value> <symbol>"` join.
public enum BatteryTabFormat {
    /// `safe` (chartUtils.tsx) / `safeNumber` (numberFormat.ts): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
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

    /// `fmtInt(v) = fmtNumber(v, 0)`.
    public static func integer(_ value: Double, localeIdentifier: String) -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// `formatEnergy(wh, pref, { precision })` — converts SI watt-hours to the display unit and
    /// joins `"<value> <symbol>"`. The web card passes the SI-safe value, so the result is always a
    /// formatted number (never the em-dash fallback).
    public static func energy(
        _ wh: Double,
        unit: BatteryEnergyUnit,
        decimals: Int,
        localeIdentifier: String
    ) -> String {
        let value = convertBatteryEnergyFromSI(wh, to: unit)
        return "\(number(value, decimals: decimals, localeIdentifier: localeIdentifier)) \(unit.symbol)"
    }
}

// MARK: - Metric card projection (web `MetricCard` ×5)

/// The decorative tint a metric card carries (web `MetricCard color`), mapped to a status token at
/// render time. Kept SwiftUI-free here so the projection stays testable.
public enum BatteryMetricTone: Sendable, Equatable {
    case success
    case info
    case warning
    case accent
}

/// One projected metric card: a localized label, a formatted value, an optional unit subtitle, the
/// SF Symbol, and the decorative tint. Mirrors the five `<MetricCard/>` the web source renders.
public struct BatteryMetric: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let subtitle: String
    public let systemImage: String
    public let tone: BatteryMetricTone

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        subtitle: String,
        systemImage: String,
        tone: BatteryMetricTone
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.tone = tone
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        BatteryTabStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Chart point projection (web Recharts data rows)

/// One projected trend sample shared by all four charts. `index` gives a stable monotonic x so the
/// charts plot chronologically without colliding on duplicate `shortLabel`s; `rangeDisplay` is the
/// km → user-unit conversion the web applies before plotting the Range Trend.
public struct BatteryTrendPoint: Identifiable, Equatable {
    public let id: Int
    public let date: String
    public let shortLabel: String
    public let healthScore: Double
    public let capacityWh: Double
    public let degradationPct: Double
    public let rangeDisplay: Double
    public let cycleCount: Double

    public var index: Int {
        id
    }

    public init(
        index: Int,
        date: String,
        shortLabel: String,
        healthScore: Double,
        capacityWh: Double,
        degradationPct: Double,
        rangeDisplay: Double,
        cycleCount: Double
    ) {
        id = index
        self.date = date
        self.shortLabel = shortLabel
        self.healthScore = healthScore
        self.capacityWh = capacityWh
        self.degradationPct = degradationPct
        self.rangeDisplay = rangeDisplay
        self.cycleCount = cycleCount
    }
}

/// The data backing the four charts: the projected points + the shared distance symbol + the
/// fixed/derived axis domains (web `domain={[80,100]}` for health; data-driven for the rest).
public struct BatteryChartData: Equatable {
    public let points: [BatteryTrendPoint]
    public let distanceSymbol: String

    public init(points: [BatteryTrendPoint], distanceSymbol: String) {
        self.points = points
        self.distanceSymbol = distanceSymbol
    }

    /// Web `YAxis domain={[80, 100]}` for the Health Score Timeline.
    public var healthDomain: ClosedRange<Double> {
        80 ... 100
    }

    /// Left-axis upper bound for the Degradation area (0-based, padded; ≥ 1 so the scale is valid).
    public var degradationMax: Double {
        Self.paddedMax(points.map(\.degradationPct))
    }

    /// Right-axis upper bound for the Cycle Count line (0-based, padded; ≥ 1 so the scale is valid).
    public var cycleMax: Double {
        Self.paddedMax(points.map(\.cycleCount))
    }

    private static func paddedMax(_ values: [Double]) -> Double {
        let peak = values.map { $0.isFinite ? $0 : 0 }.max() ?? 0
        guard peak > 0 else { return 1 }
        return peak * 1.1
    }
}

// MARK: - Projection

/// The fully-projected surface content: the five metric cards (from the latest sample) + the chart
/// data + the shared unit symbols. Computed once per snapshot by the model so the view stays
/// declarative.
public struct BatteryTabProjection: Equatable {
    public let metrics: [BatteryMetric]
    public let chart: BatteryChartData
    public let distanceSymbol: String
    public let energySymbol: String

    public init(
        metrics: [BatteryMetric],
        chart: BatteryChartData,
        distanceSymbol: String,
        energySymbol: String
    ) {
        self.metrics = metrics
        self.chart = chart
        self.distanceSymbol = distanceSymbol
        self.energySymbol = energySymbol
    }
}

/// Pure projector: `[BatteryTrendPointDTO]` + `BatteryUnitPrefs` → `BatteryTabProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web tab.
public enum BatteryTabProjector {
    /// The em-dash the web renders for an absent latest sample (`latest ? … : '—'`).
    public static let emDash = "—"

    /// `date.slice(5)`: "YYYY-MM-DD" → "MM-DD"; shorter strings pass through unchanged.
    public static func shortDateLabel(_ date: String) -> String {
        date.count > 5 ? String(date.dropFirst(5)) : date
    }

    public static func project(trend: [BatteryTrendPointDTO], units: BatteryUnitPrefs) -> BatteryTabProjection {
        let points = trend.enumerated().map { index, dto in
            BatteryTrendPoint(
                index: index,
                date: dto.date,
                shortLabel: shortDateLabel(dto.date),
                healthScore: BatteryTabFormat.safeNumber(dto.healthScore),
                capacityWh: BatteryTabFormat.safeNumber(dto.capacityWh),
                degradationPct: BatteryTabFormat.safeNumber(dto.degradationPct),
                rangeDisplay: convertBatteryDistanceFromSI(
                    BatteryTabFormat.safeNumber(dto.rangeKm) * 1000,
                    to: units.distance
                ),
                cycleCount: BatteryTabFormat.safeNumber(dto.cycleCount)
            )
        }

        return BatteryTabProjection(
            metrics: metrics(latest: trend.last, units: units),
            chart: BatteryChartData(points: points, distanceSymbol: units.distance.symbol),
            distanceSymbol: units.distance.symbol,
            energySymbol: units.energy.symbol
        )
    }

    /// The five metric cards from the latest sample (web `latest = trend[trend.length - 1]`). When
    /// `latest` is absent every value is the em-dash, matching the web `latest ? … : '—'` guard.
    public static func metrics(latest: BatteryTrendPointDTO?, units: BatteryUnitPrefs) -> [BatteryMetric] {
        [
            healthMetric(latest, units),
            capacityMetric(latest, units),
            degradationMetric(latest, units),
            rangeMetric(latest, units),
            cyclesMetric(latest, units)
        ]
    }

    private static func healthMetric(_ latest: BatteryTrendPointDTO?, _ units: BatteryUnitPrefs) -> BatteryMetric {
        let value = latest.map {
            BatteryTabFormat.number($0.healthScore, decimals: 1, localeIdentifier: units.localeIdentifier)
        }
        return BatteryMetric(
            id: "health-score",
            labelKey: "analytics.battery.healthScore",
            labelFallback: "Health Score",
            value: value ?? emDash,
            subtitle: "%",
            systemImage: "heart.fill",
            tone: .success
        )
    }

    private static func capacityMetric(_ latest: BatteryTrendPointDTO?, _ units: BatteryUnitPrefs) -> BatteryMetric {
        let value = latest.map {
            BatteryTabFormat.energy(
                BatteryTabFormat.safeNumber($0.capacityWh),
                unit: units.energy,
                decimals: 1,
                localeIdentifier: units.localeIdentifier
            )
        }
        return BatteryMetric(
            id: "capacity",
            labelKey: "analytics.battery.capacity",
            labelFallback: "Capacity",
            value: value ?? emDash,
            subtitle: "",
            systemImage: "battery.100percent",
            tone: .info
        )
    }

    private static func degradationMetric(
        _ latest: BatteryTrendPointDTO?,
        _ units: BatteryUnitPrefs
    ) -> BatteryMetric {
        let value = latest.map {
            BatteryTabFormat.number($0.degradationPct, decimals: 2, localeIdentifier: units.localeIdentifier)
        }
        return BatteryMetric(
            id: "degradation",
            labelKey: "analytics.battery.degradation",
            labelFallback: "Degradation",
            value: value ?? emDash,
            subtitle: "%",
            systemImage: "chart.line.uptrend.xyaxis",
            tone: .warning
        )
    }

    private static func rangeMetric(_ latest: BatteryTrendPointDTO?, _ units: BatteryUnitPrefs) -> BatteryMetric {
        let value = latest.map {
            BatteryTabFormat.number(
                convertBatteryDistanceFromSI(BatteryTabFormat.safeNumber($0.rangeKm) * 1000, to: units.distance),
                decimals: 0,
                localeIdentifier: units.localeIdentifier
            )
        }
        return BatteryMetric(
            id: "est-range",
            labelKey: "analytics.battery.estRange",
            labelFallback: "Est. Range",
            value: value ?? emDash,
            subtitle: units.distance.symbol,
            systemImage: "mappin.and.ellipse",
            tone: .accent
        )
    }

    private static func cyclesMetric(_ latest: BatteryTrendPointDTO?, _ units: BatteryUnitPrefs) -> BatteryMetric {
        let value = latest.map {
            BatteryTabFormat.integer($0.cycleCount, localeIdentifier: units.localeIdentifier)
        }
        return BatteryMetric(
            id: "cycles",
            labelKey: "analytics.battery.cycles",
            labelFallback: "Cycles",
            value: value ?? emDash,
            subtitle: "",
            systemImage: "arrow.triangle.2.circlepath",
            tone: .info
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the metric-card block. Pure + public so the a11y label
/// content can be unit-tested without rendering the view. The labels resolve through the surface
/// localization facade (the `value:` fallbacks back the bundle-free test runs).
public enum BatteryTabAccessibility {
    /// One spoken clause per metric, e.g. "Battery. Health Score 95.0 %. Capacity 75.0 kWh. …".
    public static func metricsSummary(for metrics: [BatteryMetric]) -> String {
        let title = BatteryTabStrings.string("analytics.battery.title", "Battery")
        var parts = [title]
        for metric in metrics {
            let unit = metric.subtitle.isEmpty ? "" : " \(metric.subtitle)"
            parts.append("\(metric.label) \(metric.value)\(unit)")
        }
        return parts.joined(separator: ". ")
    }
}
