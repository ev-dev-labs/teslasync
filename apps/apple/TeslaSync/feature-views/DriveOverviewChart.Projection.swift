//
//  DriveOverviewChart.Projection.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  The pure projection core for the "Drive Overview" driving surface — split from the
//  value types in DriveOverviewChart.Adapter.swift to honor the file-length budget.
//  Reproduces the web component's conditional series guards, the rich `ChartLegend`
//  `statFn`, the dual-axis (hidden left + "kW" right) domains, the render-phase
//  resolution, and the VoiceOver summaries. Foundation only — unit-tested without a
//  bundle or a rendered view.
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from raw samples to series presence, stats, the rich
/// legend, the dual-axis domains, and the render phase. A faithful port of the web
/// component's conditional series + `ChartLegend` `statFn`.
public enum DriveOverviewProjection {
    /// The web `chartData.length > 1` threshold (a dense trace needs ≥ 2 points).
    public static let minSamplesForChart = 2

    // MARK: Series presence (web `chartData.some(...)` guards)

    public static func hasIdealRange(_ samples: [DriveChartSample]) -> Bool {
        samples.contains { $0.idealRange != nil }
    }

    public static func hasEstOrRated(_ samples: [DriveChartSample]) -> Bool {
        samples.contains { $0.estRange != nil || $0.ratedRange != nil }
    }

    /// Whether any sample carries an `estRange` (web picks `estRange` over `ratedRange`).
    public static func usesEstRange(_ samples: [DriveChartSample]) -> Bool {
        samples.contains { $0.estRange != nil }
    }

    public static func hasUsableSoc(_ samples: [DriveChartSample]) -> Bool {
        samples.contains { $0.usableSoc != nil }
    }

    /// The series drawn as marks, in z-order (web Area/Line declaration order). Speed,
    /// SOC and power always draw; the ranges + usable-SOC draw only when present.
    public static func plottedKinds(_ samples: [DriveChartSample]) -> [DriveSeriesKind] {
        guard !samples.isEmpty else { return [] }
        var kinds: [DriveSeriesKind] = [.speed]
        if hasIdealRange(samples) { kinds.append(.idealRange) }
        if hasEstOrRated(samples) { kinds.append(.estRange) }
        kinds.append(.soc)
        if hasUsableSoc(samples) { kinds.append(.usableSoc) }
        kinds.append(.power)
        return kinds
    }

    /// The plotted value for a series at a sample, applying the est/rated fallback.
    /// `nil` when the series has no value at that sample (the line skips the point).
    public static func value(of kind: DriveSeriesKind, at sample: DriveChartSample) -> Double? {
        switch kind {
        case .speed: sample.speed
        case .idealRange: sample.idealRange
        case .estRange: sample.estOrRated
        case .soc: sample.battery
        case .usableSoc: sample.usableSoc
        case .power: sample.power
        }
    }

    // MARK: Stats (web `statFn`)

    /// The mean / max / min of the present values (web `statFn`); `nil` when empty.
    public static func stat(_ values: [Double?]) -> DriveSeriesStat? {
        let present = values.compactMap(\.self)
        guard !present.isEmpty else { return nil }
        let total = present.reduce(0, +)
        return DriveSeriesStat(
            mean: total / Double(present.count),
            max: present.max() ?? 0,
            min: present.min() ?? 0
        )
    }

    /// The stat for a series, applying the web's per-series source rules (SOC uses
    /// `battery > 0 ? battery : null`; est uses `estRange ?? ratedRange`).
    public static func stat(for kind: DriveSeriesKind, in samples: [DriveChartSample]) -> DriveSeriesStat? {
        switch kind {
        case .speed: stat(samples.map(\.speed))
        case .idealRange: stat(samples.map(\.idealRange))
        case .estRange: stat(samples.map(\.estOrRated))
        case .soc: stat(samples.map { $0.battery > 0 ? $0.battery : nil })
        case .usableSoc: stat(samples.map(\.usableSoc))
        case .power: stat(samples.map(\.power))
        }
    }

    // MARK: Legend (web `ChartLegend` items)

    /// The rich legend rows in web order (Speed, Range ideal, Range est., SOC, Usable
    /// SOC, Power), each present only when its stat is non-nil, with the exact web
    /// per-series formatting applied through `locale`.
    public static func legend(
        for samples: [DriveChartSample],
        units: DriveUnitLabels,
        locale: Locale = .current
    ) -> [DriveLegendItem] {
        DriveSeriesKind.allCases.compactMap { kind in
            guard let stat = stat(for: kind, in: samples) else { return nil }
            let format = statFormatter(for: kind, units: units, locale: locale)
            return DriveLegendItem(
                kind: kind,
                mean: format(stat.mean, false),
                max: format(stat.max, false),
                min: format(stat.min, true)
            )
        }
    }

    /// The per-series stat formatter (web source lines 122–127). The `isMin` flag
    /// selects the speed series' integer min (`fmtInt`) versus its 2-dp mean/max
    /// (`fmtNumber`); every other series formats all three stats identically.
    private static func statFormatter(
        for kind: DriveSeriesKind,
        units: DriveUnitLabels,
        locale: Locale
    ) -> (Double, Bool) -> String {
        switch kind {
        case .speed:
            { value, isMin in
                let number = isMin
                    ? DriveNumberFormat.int(value, locale: locale)
                    : DriveNumberFormat.number(value, locale: locale)
                return "\(number) \(units.speed)"
            }
        case .idealRange, .estRange:
            { value, _ in "\(DriveNumberFormat.int(value, locale: locale)) \(units.distance)" }
        case .soc, .usableSoc:
            { value, _ in DriveNumberFormat.percent(value, locale: locale) }
        case .power:
            { value, _ in DriveNumberFormat.withUnit(value, unit: "kW", locale: locale) }
        }
    }

    // MARK: Dual-axis domains (web hidden left axis + right "kW" axis)

    /// The inclusive value span of the left-axis (hidden) series — speed, ranges and
    /// SOC share one scale exactly as the web `yAxisId="speed"` overlay. Lower bound is
    /// clamped to ≤ 0 so the speed area has a sensible baseline. `nil` when empty.
    public static func primaryDomain(_ samples: [DriveChartSample]) -> ClosedRange<Double>? {
        var values: [Double] = samples.map(\.speed) + samples.map(\.battery)
        values += samples.compactMap(\.idealRange)
        values += samples.compactMap(\.estOrRated)
        values += samples.compactMap(\.usableSoc)
        guard let lower = values.min(), let upper = values.max() else { return nil }
        return Swift.min(0, lower) ... Swift.max(upper, lower + 1)
    }

    /// The inclusive span of the right-axis power series (kW), always including 0 (web
    /// `<ReferenceLine y={0}>`). `nil` when empty.
    public static func powerDomain(_ samples: [DriveChartSample]) -> ClosedRange<Double>? {
        let powers = samples.map(\.power)
        guard let lower = powers.min(), let upper = powers.max() else { return nil }
        let low = Swift.min(0, lower)
        let high = Swift.max(0, upper)
        return low ... Swift.max(high, low + 1)
    }

    /// Linearly maps a power value (kW) from `power` onto the `primary` domain so the
    /// power line can overlay the hidden left-axis scale (web's secondary-axis trick).
    public static func rescale(
        power value: Double,
        from power: ClosedRange<Double>,
        onto primary: ClosedRange<Double>
    ) -> Double {
        let span = power.upperBound - power.lowerBound
        guard span > 0 else { return primary.lowerBound }
        let fraction = (value - power.lowerBound) / span
        return primary.lowerBound + fraction * (primary.upperBound - primary.lowerBound)
    }

    /// Evenly spaced power ticks (kW) for the trailing axis, paired with the plotted
    /// position each maps to on the primary scale. Used to label the rescaled axis.
    public static func powerAxisTicks(
        power: ClosedRange<Double>,
        primary: ClosedRange<Double>,
        count: Int = 4
    ) -> [(value: Double, plotted: Double)] {
        guard count > 1, power.upperBound > power.lowerBound else { return [] }
        let step = (power.upperBound - power.lowerBound) / Double(count - 1)
        return (0 ..< count).map { stepIndex in
            let value = power.lowerBound + Double(stepIndex) * step
            return (value, rescale(power: value, from: power, onto: primary))
        }
    }

    /// The inverse of `rescale`: the power value (kW) a plotted position on the primary
    /// scale represents. Used to label the trailing axis at framework-chosen ticks.
    public static func power(
        forPlotted plotted: Double,
        primary: ClosedRange<Double>,
        power: ClosedRange<Double>
    ) -> Double {
        let span = primary.upperBound - primary.lowerBound
        guard span > 0 else { return power.lowerBound }
        let fraction = (plotted - primary.lowerBound) / span
        return power.lowerBound + fraction * (power.upperBound - power.lowerBound)
    }

    // MARK: Phase

    /// Resolves the render phase from the bound load status + the sample count (web
    /// `chartData.length > 1 ? chart : empty`).
    public static func resolvePhase(
        _ status: DriveOverviewLoadStatus,
        sampleCount: Int
    ) -> DriveOverviewPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            sampleCount >= minSamplesForChart ? .content : .empty
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle,
/// exactly like the view's P1/S10 facade.
public enum DriveOverviewAccessibility {
    /// The chart-level summary: title + sample count + the present series' names.
    public static func chartSummary(
        samples: [DriveChartSample],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("driveDetail.driveChart", "Drive Overview")
        guard samples.count >= DriveOverviewProjection.minSamplesForChart else {
            let empty = localize("driveDetail.noChartData", "No telemetry data available")
            return "\(title): \(empty)"
        }
        let samplesWord = localize("driveDetail.chart.samples", "samples")
        let names = DriveOverviewProjection.plottedKinds(samples)
            .map { localize($0.localizationKey, $0.titleFallback) }
            .joined(separator: ", ")
        return "\(title): \(samples.count) \(samplesWord) — \(names)"
    }

    /// One legend row's VoiceOver value: "{label}: Mean M, Max X, Min N".
    public static func legendLabel(
        _ item: DriveLegendItem,
        localize: (String, String) -> String
    ) -> String {
        let label = localize(item.kind.legendKey, item.kind.legendFallback)
        let meanWord = localize("driveDetail.chart.mean", "Mean")
        let maxWord = localize("driveDetail.chart.max", "Max")
        let minWord = localize("driveDetail.chart.min", "Min")
        return "\(label): \(meanWord) \(item.mean), \(maxWord) \(item.max), \(minWord) \(item.min)"
    }
}
