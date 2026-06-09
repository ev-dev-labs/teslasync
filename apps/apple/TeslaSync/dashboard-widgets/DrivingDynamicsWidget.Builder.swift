//
//  DrivingDynamicsWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/DrivingDynamicsWidget.tsx (deriveSeverity /
//  isSmooth / gaugeColor / the maxG + histogramData memos). The g values are
//  already unitless, so there is no SI→display conversion here; the only display
//  boundary is the locale-aware number formatting (web `fmtNumber`). No SwiftUI /
//  transport — this is the unit-tested core.
//

import Foundation

// MARK: - Number formatting (web `fmtNumber` + `safeNumber`)

/// Locale-aware number formatting that mirrors the web `fmtNumber`
/// (`Intl.NumberFormat`) with its `safeNumber` guard (non-finite → 0).
public enum DrivingDynamicsFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals)` — fixed fraction digits, grouped, rounding half
    /// away from zero to match `Intl.NumberFormat`'s default behavior.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = Swift.max(0, decimals)
        formatter.maximumFractionDigits = Swift.max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(Swift.max(0, decimals))f", safe)
    }
}

// MARK: - Projection builder (port of the web memos)

/// Pure adapter that turns the cached dynamics + acceleration distribution into
/// the rendered projection, faithfully reproducing the web component's derived
/// values (`maxG`, `smooth`, `severity`, the three gauges, `histogramData`).
public enum DrivingDynamicsBuilder {
    /// The web `G_MAX` gauge ceiling + histogram span.
    public static let gMax = 1.2

    /// The web `deriveSeverity(avgAccel, avgBrake)`: average the two, then band
    /// it — `< 0.15` calm, `< 0.3` normal, `< 0.5` sporty, else aggressive.
    public static func deriveSeverity(avgAccel: Double, avgBrake: Double) -> DrivingDynamicsSeverity {
        let avg = (DrivingDynamicsFormat.safeNumber(avgAccel) + DrivingDynamicsFormat.safeNumber(avgBrake)) / 2
        if avg < 0.15 { return .calm }
        if avg < 0.3 { return .normal }
        if avg < 0.5 { return .sporty }
        return .aggressive
    }

    /// The web `isSmooth(maxG)` — a peak under `0.4` g reads as "Smooth".
    public static func isSmooth(maxG: Double) -> Bool {
        maxG < 0.4
    }

    /// The web `gaugeColor(g)` thresholds mapped onto the design-token bands:
    /// `< 0.2` success, `< 0.4` info, `< 0.6` warning, else danger.
    public static func gaugeTone(forG value: Double) -> DrivingDynamicsGaugeTone {
        let safe = DrivingDynamicsFormat.safeNumber(value)
        if safe < 0.2 { return .success }
        if safe < 0.4 { return .info }
        if safe < 0.6 { return .warning }
        return .danger
    }

    /// Builds one gauge cell: clamp the value into `0…G_MAX` for the fill
    /// fraction (web `RadialGauge` clamps `value` to `max`), format the readout
    /// to 2 decimals (web `label={fmtNumber(value, 2)}`), and pick the color
    /// band from the raw value (web `color={gaugeColor(value)}`).
    static func makeGauge(
        role: DrivingDynamicsGaugeRole,
        rawValue: Double,
        localeIdentifier: String
    ) -> DrivingDynamicsGauge {
        let value = DrivingDynamicsFormat.safeNumber(rawValue)
        let clamped = Swift.min(Swift.max(value, 0), gMax)
        let fraction = gMax > 0 ? clamped / gMax : 0
        return DrivingDynamicsGauge(
            role: role,
            value: value,
            max: gMax,
            fraction: fraction,
            valueText: DrivingDynamicsFormat.number(value, decimals: 2, localeIdentifier: localeIdentifier),
            tone: gaugeTone(forG: value)
        )
    }

    /// Builds the acceleration-distribution bars — the web `histogramData` memo:
    /// `step = G_MAX / values.length`, one bar per bucket with the lower-bound g
    /// label (`fmtNumber(i * step, 2)`) and the sample `count` (web `count ?? 0`).
    /// An empty `values` array yields no bars (web returns `[]`).
    static func makeBars(
        distribution: DrivingDynamicsAccelerationDistribution?,
        localeIdentifier: String
    ) -> [DrivingGForceBar] {
        let values = distribution?.values ?? []
        guard !values.isEmpty else { return [] }
        let step = gMax / Double(values.count)
        return values.enumerated().map { index, count in
            DrivingGForceBar(
                plotKey: String(format: "%04d", index),
                rangeLabel: DrivingDynamicsFormat.number(
                    Double(index) * step,
                    decimals: 2,
                    localeIdentifier: localeIdentifier
                ),
                count: DrivingDynamicsFormat.safeNumber(count)
            )
        }
    }

    /// Builds the merged projection. When `dynamics` is `nil` the projection
    /// reports `hasDynamics == false` (the web renders the `EmptyState` instead
    /// of the gauges); otherwise it derives `maxG` from the three peak fields,
    /// the smoothness flag, the driving-style severity, the three gauges
    /// (avg accel, avg brake, peak cornering), and the histogram bars.
    public static func buildProjection(
        dynamics: DrivingDynamicsDTO?,
        distribution: DrivingDynamicsAccelerationDistribution? = nil,
        localeIdentifier: String = "en_US"
    ) -> DrivingDynamicsProjection {
        let bars = makeBars(distribution: distribution, localeIdentifier: localeIdentifier)

        guard let dynamics else {
            return DrivingDynamicsProjection(
                hasDynamics: false,
                maxG: 0,
                maxGText: DrivingDynamicsFormat.number(0, decimals: 2, localeIdentifier: localeIdentifier),
                smooth: true,
                severity: .calm,
                gauges: [],
                bars: bars
            )
        }

        let maxAccel = DrivingDynamicsFormat.safeNumber(dynamics.maxAccelerationG)
        let maxBrake = DrivingDynamicsFormat.safeNumber(dynamics.maxBrakingG)
        let maxCorner = DrivingDynamicsFormat.safeNumber(dynamics.maxCorneringG)
        let maxG = Swift.max(maxAccel, maxBrake, maxCorner)

        let severity = deriveSeverity(
            avgAccel: dynamics.avgAccelerationG,
            avgBrake: dynamics.avgBrakingG
        )

        let gauges = [
            makeGauge(role: .accel, rawValue: dynamics.avgAccelerationG, localeIdentifier: localeIdentifier),
            makeGauge(role: .brake, rawValue: dynamics.avgBrakingG, localeIdentifier: localeIdentifier),
            makeGauge(role: .lateral, rawValue: dynamics.maxCorneringG, localeIdentifier: localeIdentifier)
        ]

        return DrivingDynamicsProjection(
            hasDynamics: true,
            maxG: maxG,
            maxGText: DrivingDynamicsFormat.number(maxG, decimals: 2, localeIdentifier: localeIdentifier),
            smooth: isSmooth(maxG: maxG),
            severity: severity,
            gauges: gauges,
            bars: bars
        )
    }
}
