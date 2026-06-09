//
//  PowerProfileChart.Projection.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  The pure projection core for the "Power Profile" drive-detail surface — split from the
//  value types in PowerProfileChart.Adapter.swift to honor the file-length budget.
//  Reproduces the web component's `chartData.length > 1` render gate, the `DriveStats`
//  power reducer (`powerMax` / `powerMin` / `avgPower`), the zero-crossing y-domain (web
//  `<ReferenceLine y={0}>`), and the VoiceOver summaries. Foundation only — unit-tested
//  without a bundle or a rendered view.
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from raw samples to the footer summary, the chart's
/// zero-crossing y-domain, and the render phase. A faithful port of the web component's
/// `chartData.length > 1` gate and the parent `useDriveDetailData` power reducer.
public enum PowerProfileProjection {
    /// The web `chartData.length > 1` threshold (a dense trace needs ≥ 2 points).
    public static let minSamplesForChart = 2

    /// The footer summary derived from the samples (the web parent's `useDriveDetailData`
    /// power reducer): max / min / mean of the per-sample power. Zeros when empty (web
    /// `DriveStats` defaults to 0). This is the canonical projection the parent passes as
    /// the `stats` prop; the model prefers an explicit snapshot value when the source
    /// supplies one.
    public static func stats(from samples: [PowerProfileSample]) -> PowerProfileStats {
        let powers = samples.map(\.power)
        guard !powers.isEmpty else { return .zero }
        let total = powers.reduce(0, +)
        return PowerProfileStats(
            powerMax: powers.max() ?? 0,
            powerMin: powers.min() ?? 0,
            avgPower: total / Double(powers.count)
        )
    }

    /// The inclusive y-domain for the area, always including 0 (web `<ReferenceLine
    /// y={0}>`) so regeneration (negative) and drive power (positive) share a zero
    /// baseline. The span is widened to at least 1 kW so a flat trace still has height.
    /// `nil` when empty.
    public static func powerDomain(_ samples: [PowerProfileSample]) -> ClosedRange<Double>? {
        let powers = samples.map(\.power)
        guard let lower = powers.min(), let upper = powers.max() else { return nil }
        let low = Swift.min(0, lower)
        let high = Swift.max(0, upper)
        return low ... Swift.max(high, low + 1)
    }

    /// The first + last sample indices for the endpoint-only x-axis (web
    /// `interval="preserveStartEnd"`). One element for a single sample, empty when empty.
    public static func endpointIndices(_ samples: [PowerProfileSample]) -> [Int] {
        guard let first = samples.first?.index, let last = samples.last?.index else { return [] }
        return first == last ? [first] : [first, last]
    }

    /// Resolves the render phase from the bound load status + the sample count (web
    /// `chartData.length > 1 ? chart : empty`).
    public static func resolvePhase(
        _ status: PowerProfileLoadStatus,
        sampleCount: Int
    ) -> PowerProfilePhase {
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
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly
/// like the view's P1/S10 facade.
public enum PowerProfileAccessibility {
    /// The chart-level summary: title + sample count (web `chartData.length`), or the
    /// empty message when the trace is too short to plot.
    public static func chartSummary(
        samples: [PowerProfileSample],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("driveDetail.powerProfile", "Power Profile")
        guard samples.count >= PowerProfileProjection.minSamplesForChart else {
            let empty = localize("driveDetail.noChartData", "No telemetry data available")
            return "\(title): \(empty)"
        }
        let power = localize("driveDetail.power", "Power")
        let samplesWord = localize("driveDetail.chart.samples", "samples")
        return "\(title): \(samples.count) \(power) \(samplesWord)"
    }

    /// The footer summary as one VoiceOver value: "Max Power M kW, Max Regen N kW, Avg A
    /// kW" — the spoken parity of the web stat row.
    public static func statsSummary(
        _ stats: PowerProfileStats,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let maxPower = localize("driveDetail.maxPower", "Max Power")
        let maxRegen = localize("driveDetail.maxRegen", "Max Regen")
        let avg = localize("driveDetail.avgLabel", "Avg")
        let maxValue = PowerNumberFormat.kilowattInt(stats.powerMax, locale: locale)
        let minValue = PowerNumberFormat.kilowattInt(stats.powerMin, locale: locale)
        let avgValue = PowerNumberFormat.kilowatt(stats.avgPower, locale: locale)
        return "\(maxPower) \(maxValue), \(maxRegen) \(minValue), \(avg) \(avgValue)"
    }
}
