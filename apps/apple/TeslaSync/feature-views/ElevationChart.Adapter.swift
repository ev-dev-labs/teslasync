//
//  ElevationChart.Adapter.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  The testable projection core for the drive-detail "Elevation Profile" surface —
//  the faithful port of the area+line chart in
//  features/drive-detail/ElevationChart.tsx and the `elevGain` / `elevLoss`
//  reduction its parent `useDriveDetailData` feeds it. Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view. The value types it projects live in `ElevationChart.Models.swift`.
//
//  Web parity notes:
//    • `points` converts each sample's speed from SI (m/s) into the user's display
//      unit (web `convertSpeedFromSI(speed, unitPrefs.speed)`); elevation stays in
//      meters (web passes `elevation` straight through).
//    • `stats` is the web `elevGain` / `elevLoss` reduction: Σ of positive
//      consecutive elevation diffs (gain) and Σ of |negative diffs| (loss); `netM`
//      is `elevGain - elevLoss`.
//    • The web renders the chart only when `chartData.length > 1`; `resolvePhase`
//      reproduces that exact threshold (a single sample → the empty branch).
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from raw drive samples to chart-ready points,
/// the elevation summary, and the render phase. A faithful port of the web
/// `ElevationChart` data handling + the `elevGain` / `elevLoss` reduction.
public enum ElevationProjection {
    /// Projects each sample into an `ElevationPoint`, converting speed from SI into
    /// the display unit (web `convertSpeedFromSI`) and carrying elevation in meters.
    public static func points(from samples: [ElevationSample], speedUnit: SpeedUnit) -> [ElevationPoint] {
        samples.map { sample in
            ElevationPoint(
                index: sample.index,
                time: sample.time,
                elevationM: sample.elevationM,
                speedDisplay: speedUnit.convert(mps: sample.speedMps)
            )
        }
    }

    /// The elevation gain / loss totals (web `elevGain` / `elevLoss`): walk the
    /// samples in order and accumulate the positive diffs as gain and the absolute
    /// negative diffs as loss. Fewer than two samples → zero of both.
    public static func stats(from samples: [ElevationSample]) -> ElevationStats {
        guard samples.count > 1 else { return ElevationStats(gainM: 0, lossM: 0) }
        var gain = 0.0
        var loss = 0.0
        for index in 1 ..< samples.count {
            let diff = samples[index].elevationM - samples[index - 1].elevationM
            if diff > 0 {
                gain += diff
            } else {
                loss += -diff
            }
        }
        return ElevationStats(gainM: gain, lossM: loss)
    }

    /// Resolves the render phase from the bound load status + whether the trace has
    /// enough samples to draw (web `chartData.length > 1 ? <chart> : <empty>`).
    public static func resolvePhase(_ status: ElevationLoadStatus, sampleCount: Int) -> ElevationPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            sampleCount > 1 ? .content : .empty
        }
    }

    /// Whether the web chart branch would render for this many samples (`> 1`).
    public static func hasTrace(sampleCount: Int) -> Bool {
        sampleCount > 1
    }

    /// The inclusive elevation range across the points (left y-domain), padded so a
    /// perfectly flat trace still yields a non-degenerate axis.
    public static func elevationDomain(_ points: [ElevationPoint]) -> ClosedRange<Double> {
        let values = points.map(\.elevationM)
        let lower = values.min() ?? 0
        let upper = values.max() ?? 0
        return paddedDomain(lower: lower, upper: upper)
    }

    /// The speed range across the points (right y-domain), pinned to a zero floor
    /// (speeds are non-negative) and padded at the top so a stationary trace still
    /// has a scale.
    public static func speedDomain(_ points: [ElevationPoint]) -> ClosedRange<Double> {
        let upper = points.map(\.speedDisplay).max() ?? 0
        let padded = paddedDomain(lower: 0, upper: max(upper, 0))
        return 0 ... padded.upperBound
    }

    /// Maps a speed value into the elevation domain so the speed line can share the
    /// chart's single y-scale while a trailing axis still reads true speed (the
    /// native technique for the web's dual y-axes).
    public static func projectSpeedToElevation(
        _ speed: Double,
        speedDomain: ClosedRange<Double>,
        elevationDomain: ClosedRange<Double>
    ) -> Double {
        let speedSpan = speedDomain.upperBound - speedDomain.lowerBound
        guard speedSpan > 0 else { return elevationDomain.lowerBound }
        let ratio = (speed - speedDomain.lowerBound) / speedSpan
        let elevSpan = elevationDomain.upperBound - elevationDomain.lowerBound
        return elevationDomain.lowerBound + ratio * elevSpan
    }

    /// The web `fmtNumber(value, decimals)` — a locale-aware decimal string with a
    /// fixed fraction width and grouping separators.
    public static func decimalString(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// The web `fmtInt(value)` — `fmtNumber(value, 0)`.
    public static func intString(_ value: Double, locale: Locale) -> String {
        decimalString(value, decimals: 0, locale: locale)
    }

    /// Pads a `[lower, upper]` pair into a non-degenerate closed range.
    private static func paddedDomain(lower: Double, upper: Double) -> ClosedRange<Double> {
        guard upper > lower else {
            let center = lower
            return (center - 1) ... (center + 1)
        }
        let pad = (upper - lower) * 0.08
        return (lower - pad) ... (upper + pad)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ElevationSurface {
    public static let slug = "ElevationChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade. The web chart opts out of a
/// per-sample data table (its `chart-a11y:no-table` marker); native likewise
/// exposes a concise spoken summary rather than reading every sample.
public enum ElevationAccessibility {
    /// The chart-level summary: title + elevation gain / loss / net + the speed
    /// range, carrying the same figures the header + axes encode.
    public static func chartSummary(
        points: [ElevationPoint],
        stats: ElevationStats,
        speedUnit: SpeedUnit,
        locale: Locale,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("driveDetail.elevProfile", "Elevation Profile")
        guard points.count > 1 else {
            return "\(title): \(localize("driveDetail.noChartData", "No telemetry data available"))"
        }
        let gain = localize("driveDetail.gain", "gain")
        let loss = localize("driveDetail.loss", "loss")
        let net = localize("driveDetail.net", "Net")
        let speedLabel = localize("driveDetail.speed", "Speed")
        let meters = localize("driveDetail.unit.meters", "meters")
        let gainText = ElevationProjection.decimalString(stats.gainM, decimals: 0, locale: locale)
        let lossText = ElevationProjection.decimalString(stats.lossM, decimals: 0, locale: locale)
        let netText = ElevationProjection.decimalString(stats.netM, decimals: 0, locale: locale)
        let maxSpeed = points.map(\.speedDisplay).max() ?? 0
        let speedText = ElevationProjection.decimalString(maxSpeed, decimals: 0, locale: locale)
        return "\(title): \(gainText) \(meters) \(gain), \(lossText) \(meters) \(loss), "
            + "\(net) \(netText) \(meters). \(speedLabel) \(localize("driveDetail.upTo", "up to")) "
            + "\(speedText) \(speedUnit.label)."
    }

    /// One sample's spoken value for the chart cursor (web hover): "{time}:
    /// Elevation X meters, Speed Y {unit}".
    public static func cursorLabel(
        _ point: ElevationPoint,
        speedUnit: SpeedUnit,
        locale: Locale,
        localize: (String, String) -> String
    ) -> String {
        let elevation = localize("driveDetail.elevation", "Elevation")
        let speed = localize("driveDetail.speed", "Speed")
        let meters = localize("driveDetail.unit.meters", "meters")
        let elevText = ElevationProjection.decimalString(point.elevationM, decimals: 0, locale: locale)
        let speedText = ElevationProjection.decimalString(point.speedDisplay, decimals: 0, locale: locale)
        return "\(point.time): \(elevation) \(elevText) \(meters), \(speed) \(speedText) \(speedUnit.label)"
    }
}
