//
//  CostPerKwhChart.Adapter.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  The testable projection core for the "Cost per kWh Trend" surface — the
//  faithful port of features/charging/components/cost-analysis/CostPerKwhChart.tsx.
//  Everything here is pure and dependency-free (Foundation only) so it can be
//  unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component is presentational: it takes `data: { date, costPerKwh }[]`
//      (the parent `CostAnalysisPage` derives `costPerKwhTrend` from the charging
//      sessions) and renders a Recharts `LineChart`, or the `noData` empty message
//      when the array is empty. The native source seam provides that same ordered
//      list of samples and this adapter projects the plotted points + render phase.
//    • `costPerKwh` is a currency rate (already SI-agnostic — a price, not a unit),
//      so there is NO unit conversion here; the value is formatted at the display
//      boundary via the injected formatter (web `useFormatting().formatCurrency`).
//    • The web `data.length > 0 ? <LineChart> : <noData>` split becomes the resolved
//      `.content` vs `.empty` phase, widened with the loading / error load envelope
//      the parent page owns (prompt P4 states).
//

import Foundation

// MARK: - Numeric guard (port of the web charts `safe`)

/// Numeric helper shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used wherever a
/// rate feeds an axis / a label so a `NaN` / `Infinity` never reaches the plot.
public enum CostPerKwhNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Sample (raw web `{ date, costPerKwh }`)

/// One raw trend sample as delivered by the bound source — the native parity of a
/// web `data[i]` entry (`{ date: string; costPerKwh: number }`). Projected into a
/// plotted `CostPerKwhPoint` (with a stable index) by `CostPerKwhProjection`.
public struct CostPerKwhSample: Sendable, Equatable {
    /// The category label plotted on the X axis (web `dataKey="date"`).
    public var date: String
    /// The cost-per-kWh rate plotted on the Y axis (web `dataKey="costPerKwh"`).
    public var costPerKwh: Double

    public init(date: String, costPerKwh: Double) {
        self.date = date
        self.costPerKwh = costPerKwh
    }
}

// MARK: - Point (one plotted line vertex)

/// One plotted vertex of the trend line: its input-order index (the stable
/// `Identifiable` id + tie-break), the X-axis date label, and the sanitized
/// Y-axis rate. The index keeps `ForEach` / selection stable even when two
/// samples share a `date` string (which the web category axis would also merge).
public struct CostPerKwhPoint: Sendable, Equatable, Identifiable {
    /// Input order — the `Identifiable` id and the deterministic plot order.
    public var index: Int
    /// The category label plotted on the X axis (web `date`).
    public var date: String
    /// The finite cost-per-kWh rate plotted on the Y axis (web `costPerKwh`).
    public var costPerKwh: Double

    public var id: Int {
        index
    }

    public init(index: Int, date: String, costPerKwh: Double) {
        self.index = index
        self.date = date
        self.costPerKwh = costPerKwh
    }
}

// MARK: - Load envelope (web parent `isLoading` / resolved / failure)

/// The bound source's load status for the cost-analysis slice, projected into a
/// render phase by `resolvePhase`.
public enum CostPerKwhLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so the trend is clearly labeled while reconnecting / offline.
public enum CostPerKwhConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web source only distinguishes content vs
/// empty (`data.length > 0`); the loading / error envelope around it (prompt P4
/// states) is supplied by the bound source, mirroring the parent page's wiring.
public enum CostPerKwhPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Summary statistics (a11y + readouts)

/// Descriptive statistics over the plotted trend, used by the VoiceOver summary
/// (and available to readouts). Pure derivation from the points; `nil` when empty.
public struct CostPerKwhStats: Sendable, Equatable {
    public var count: Int
    public var minimum: Double
    public var maximum: Double
    public var average: Double
    public var first: Double
    public var latest: Double

    public init(
        count: Int,
        minimum: Double,
        maximum: Double,
        average: Double,
        first: Double,
        latest: Double
    ) {
        self.count = count
        self.minimum = minimum
        self.maximum = maximum
        self.average = average
        self.first = first
        self.latest = latest
    }
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw samples to plotted points + render
/// phase + axis ticks + summary stats. A faithful port of the web component's
/// read of `data` (`data.length > 0 ? <LineChart> : <noData>`).
public enum CostPerKwhProjection {
    /// Ordered plotted points from the raw samples. Input order is preserved (the
    /// web trusts the upstream order); each `costPerKwh` is sanitized through
    /// `safe` so a non-finite rate never reaches the plot.
    public static func points(from samples: [CostPerKwhSample]) -> [CostPerKwhPoint] {
        samples.enumerated().map { offset, sample in
            CostPerKwhPoint(
                index: offset,
                date: sample.date,
                costPerKwh: CostPerKwhNumeric.safe(sample.costPerKwh)
            )
        }
    }

    /// Resolves the render phase from the bound load status + the plotted count
    /// (web `data.length > 0 ? content : empty`).
    public static func resolvePhase(_ status: CostPerKwhLoadStatus, count: Int) -> CostPerKwhPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            count > 0 ? .content : .empty
        }
    }

    /// Descriptive statistics over the points, or `nil` when there are none.
    public static func stats(_ points: [CostPerKwhPoint]) -> CostPerKwhStats? {
        guard let firstPoint = points.first, let lastPoint = points.last else { return nil }
        let values = points.map(\.costPerKwh)
        let total = values.reduce(0, +)
        return CostPerKwhStats(
            count: points.count,
            minimum: values.min() ?? 0,
            maximum: values.max() ?? 0,
            average: total / Double(points.count),
            first: firstPoint.costPerKwh,
            latest: lastPoint.costPerKwh
        )
    }

    /// A thinned, ordered subset of the date labels for the X axis so a long trend
    /// does not crowd the axis (the native parity of Recharts' automatic tick
    /// thinning). Always includes the first and last sample; returns at most
    /// `maxTicks` unique labels in input order.
    public static func axisTicks(_ points: [CostPerKwhPoint], maxTicks: Int = 6) -> [String] {
        guard !points.isEmpty else { return [] }
        let limit = Swift.max(1, maxTicks)
        guard points.count > limit else { return orderedUniqueDates(points) }

        let stride = Int((Double(points.count - 1) / Double(limit - 1)).rounded(.up))
        var picked: [CostPerKwhPoint] = []
        var offset = 0
        while offset < points.count {
            picked.append(points[offset])
            offset += Swift.max(1, stride)
        }
        if let last = points.last, picked.last?.index != last.index {
            picked.append(last)
        }
        return orderedUniqueDates(picked)
    }

    /// The date labels in order, de-duplicated (keeping first appearance) so an
    /// axis-tick set never contains a repeated category.
    private static func orderedUniqueDates(_ points: [CostPerKwhPoint]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for point in points where seen.insert(point.date).inserted {
            result.append(point.date)
        }
        return result
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum CostPerKwhSurface {
    public static let slug = "CostPerKwhChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) and the rate is rendered through an
/// injected currency formatter, so the summaries are testable without a bundle or
/// a settings store (exactly like the view's P1/S10 + formatting facades).
public enum CostPerKwhAccessibility {
    /// The chart-level summary: title + sample count + latest / range / average,
    /// or the friendly `noData` message when the trend is empty.
    public static func chartSummary(
        _ points: [CostPerKwhPoint],
        localize: (String, String) -> String,
        formatCurrency: (Double) -> String
    ) -> String {
        let title = localize("costAnalysis.charts.costPerKwh", "Cost per kWh Trend")
        guard let stats = CostPerKwhProjection.stats(points) else {
            return title + ": " + localize("costAnalysis.charts.noData", "Not enough data")
        }
        let pointsWord = localize("costAnalysis.charts.a11y.points", "data points")
        let latestWord = localize("costAnalysis.charts.a11y.latest", "latest")
        let rangeWord = localize("costAnalysis.charts.a11y.range", "range")
        let averageWord = localize("costAnalysis.charts.a11y.average", "average")
        let range = "\(formatCurrency(stats.minimum)) – \(formatCurrency(stats.maximum))"
        return "\(title): \(stats.count) \(pointsWord), "
            + "\(latestWord) \(formatCurrency(stats.latest)), "
            + "\(rangeWord) \(range), "
            + "\(averageWord) \(formatCurrency(stats.average))"
    }

    /// One vertex's VoiceOver label: the date category (web X value).
    public static func pointLabel(_ point: CostPerKwhPoint) -> String {
        point.date
    }

    /// One vertex's VoiceOver value: the formatted rate (web Y value).
    public static func pointValue(
        _ point: CostPerKwhPoint,
        formatCurrency: (Double) -> String
    ) -> String {
        formatCurrency(point.costPerKwh)
    }
}
