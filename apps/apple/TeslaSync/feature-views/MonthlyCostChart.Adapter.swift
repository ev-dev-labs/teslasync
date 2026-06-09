//
//  MonthlyCostChart.Adapter.swift
//  TeslaSync — P4 feature view · 0116 · MonthlyCostChart (Apple)
//
//  The testable projection core for the "Monthly Cost Trend" surface — the
//  faithful port of
//  features/charging/components/cost-analysis/MonthlyCostChart.tsx. Everything
//  here is pure and dependency-free (Foundation only) so it can be unit-tested
//  without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component is presentational: it takes `data: MonthlyBucket[]`
//      (the parent `CostAnalysisPage` derives the monthly buckets from the
//      charging sessions) plus a `vehicleId`, and renders a Recharts `AreaChart`
//      of `cost` over `month`, or the `noData` empty message when the array is
//      empty. The native source seam provides that same ordered list of buckets
//      and this adapter projects the plotted points + render phase.
//    • `cost` is a currency total (already SI-agnostic — a price, not a unit), so
//      there is NO unit conversion here; the value is formatted at the display
//      boundary via the injected formatter (web `useFormatting().formatCurrency`).
//    • The web X axis `tickFormatter` reduces a `YYYY-MM` bucket to `MM/YY`
//      (`v.split('-')`, `${parts[1]}/${parts[0].slice(2)}`); `MonthlyCostMonthLabel`
//      ports that verbatim.
//    • The web `<ChartContainer annotations={{ vehicleId, scope, chartId }}>` +
//      `renderAnnotationLines(...)` overlay is reproduced as vehicle-annotation
//      `RuleMark`s; the lines are supplied by the bound source (the view never
//      fetches), and `resolvedAnnotations` keeps only those that land on a plotted
//      month so a stray marker never draws off-axis.
//    • The web `data.length > 0 ? <AreaChart> : <noData>` split becomes the
//      resolved `.content` vs `.empty` phase, widened with the loading / error
//      load envelope the parent page owns (prompt P4 states).
//

import Foundation

// MARK: - Numeric guard (port of the web charts `safe`)

/// Numeric helper shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used wherever a
/// cost feeds an axis / a label so a `NaN` / `Infinity` never reaches the plot.
public enum MonthlyCostNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Month label (port of the web X-axis `tickFormatter`)

/// Reduces a `YYYY-MM` bucket key to the compact `MM/YY` axis label — the verbatim
/// port of the web `tickFormatter` (`v.split('-')`, then
/// `${parts[1]}/${parts[0].slice(2)}`). Any value that is not exactly two
/// dash-separated parts is returned unchanged (web `parts.length === 2 ? … : v`).
public enum MonthlyCostMonthLabel {
    /// The compact `MM/YY` label for a `YYYY-MM` bucket, or the raw value when it
    /// is not a two-part dash key.
    public static func short(_ month: String) -> String {
        let parts = month.components(separatedBy: "-")
        guard parts.count == 2 else { return month }
        // `parts[0].slice(2)` — drop the century digits ("2024" → "24").
        return "\(parts[1])/\(String(parts[0].dropFirst(2)))"
    }
}

// MARK: - Sample (raw web `{ month, cost }`)

/// One raw monthly bucket as delivered by the bound source — the native parity of
/// the two fields the web chart reads from a `MonthlyBucket`
/// (`data.map((d) => ({ month: d.month, cost: d.cost }))`). Projected into a
/// plotted `MonthlyCostChartPoint` (with a stable index) by `MonthlyCostProjection`.
public struct MonthlyCostSample: Sendable, Equatable {
    /// The `YYYY-MM` bucket key plotted on the X axis (web `dataKey="month"`).
    public var month: String
    /// The total charging cost for the month, plotted on the Y axis (web `cost`).
    public var cost: Double

    public init(month: String, cost: Double) {
        self.month = month
        self.cost = cost
    }
}

// MARK: - Annotation (web `renderAnnotationLines` overlay)

/// One vehicle-annotation reference line — the native parity of an entry passed to
/// the web `renderAnnotationLines(chartAnnotations, (ts) => ts)`. The bound source
/// supplies these (sourced from the shared annotations slice the web
/// `<ChartContainer>` owns); the view renders a vertical `RuleMark` at `month`.
public struct MonthlyCostAnnotation: Sendable, Equatable, Identifiable {
    /// The `YYYY-MM` bucket the line is anchored to (the web annotation x-accessor).
    public var month: String
    /// The short caption shown on the line.
    public var label: String

    public var id: String {
        month + "|" + label
    }

    public init(month: String, label: String) {
        self.month = month
        self.label = label
    }
}

// MARK: - Point (one plotted area/line vertex)

/// One plotted vertex of the cost area: its input-order index (the stable
/// `Identifiable` id + tie-break), the `YYYY-MM` bucket, and the sanitized cost.
/// The index keeps `ForEach` / selection stable even when two buckets share a
/// `month` string (which the web category axis would also merge).
public struct MonthlyCostChartPoint: Sendable, Equatable, Identifiable {
    /// Input order — the `Identifiable` id and the deterministic plot order.
    public var index: Int
    /// The category key plotted on the X axis (web `month`).
    public var month: String
    /// The finite cost plotted on the Y axis (web `cost`).
    public var cost: Double

    public var id: Int {
        index
    }

    /// The compact `MM/YY` axis/callout label (web `tickFormatter`).
    public var shortMonth: String {
        MonthlyCostMonthLabel.short(month)
    }

    public init(index: Int, month: String, cost: Double) {
        self.index = index
        self.month = month
        self.cost = cost
    }
}

// MARK: - Load envelope (web parent `isLoading` / resolved / failure)

/// The bound source's load status for the cost-analysis slice, projected into a
/// render phase by `resolvePhase`.
public enum MonthlyCostLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so the trend is clearly labeled while reconnecting / offline.
public enum MonthlyCostConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web source only distinguishes content vs
/// empty (`data.length > 0`); the loading / error envelope around it (prompt P4
/// states) is supplied by the bound source, mirroring the parent page's wiring.
public enum MonthlyCostPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Summary statistics (a11y + readouts)

/// Descriptive statistics over the plotted trend, used by the VoiceOver summary
/// (and available to readouts). Pure derivation from the points; `nil` when empty.
public struct MonthlyCostStats: Sendable, Equatable {
    public var count: Int
    public var total: Double
    public var minimum: Double
    public var maximum: Double
    public var average: Double
    public var first: Double
    public var latest: Double
    /// The month of the most recent plotted bucket (for the a11y summary).
    public var latestMonth: String

    public init(
        count: Int,
        total: Double,
        minimum: Double,
        maximum: Double,
        average: Double,
        first: Double,
        latest: Double,
        latestMonth: String
    ) {
        self.count = count
        self.total = total
        self.minimum = minimum
        self.maximum = maximum
        self.average = average
        self.first = first
        self.latest = latest
        self.latestMonth = latestMonth
    }
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw buckets to plotted points + render
/// phase + axis ticks + summary stats. A faithful port of the web component's read
/// of `data` (`data.length > 0 ? <AreaChart> : <noData>`).
public enum MonthlyCostProjection {
    /// Ordered plotted points from the raw buckets. Input order is preserved (the
    /// web trusts the upstream order); each `cost` is sanitized through `safe` so a
    /// non-finite total never reaches the plot.
    public static func points(from samples: [MonthlyCostSample]) -> [MonthlyCostChartPoint] {
        samples.enumerated().map { offset, sample in
            MonthlyCostChartPoint(
                index: offset,
                month: sample.month,
                cost: MonthlyCostNumeric.safe(sample.cost)
            )
        }
    }

    /// Resolves the render phase from the bound load status + the plotted count
    /// (web `data.length > 0 ? content : empty`).
    public static func resolvePhase(_ status: MonthlyCostLoadStatus, count: Int) -> MonthlyCostPhase {
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
    public static func stats(_ points: [MonthlyCostChartPoint]) -> MonthlyCostStats? {
        guard let firstPoint = points.first, let lastPoint = points.last else { return nil }
        let values = points.map(\.cost)
        let total = values.reduce(0, +)
        return MonthlyCostStats(
            count: points.count,
            total: total,
            minimum: values.min() ?? 0,
            maximum: values.max() ?? 0,
            average: total / Double(points.count),
            first: firstPoint.cost,
            latest: lastPoint.cost,
            latestMonth: lastPoint.month
        )
    }

    /// Keeps only the annotation lines that land on a plotted month, in input
    /// order, so a stray marker never draws off-axis (the web overlay only renders
    /// lines whose x maps onto the category axis).
    public static func resolvedAnnotations(
        _ annotations: [MonthlyCostAnnotation],
        points: [MonthlyCostChartPoint]
    ) -> [MonthlyCostAnnotation] {
        guard !annotations.isEmpty, !points.isEmpty else { return [] }
        let months = Set(points.map(\.month))
        return annotations.filter { months.contains($0.month) }
    }

    /// A thinned, ordered subset of the `YYYY-MM` keys for the X axis so a long
    /// trend does not crowd the axis (the native parity of Recharts' automatic tick
    /// thinning). Always includes the first and last bucket; returns at most
    /// `maxTicks` unique keys in input order.
    public static func axisTicks(_ points: [MonthlyCostChartPoint], maxTicks: Int = 6) -> [String] {
        guard !points.isEmpty else { return [] }
        let limit = Swift.max(1, maxTicks)
        guard points.count > limit else { return orderedUniqueMonths(points) }

        let stride = Int((Double(points.count - 1) / Double(limit - 1)).rounded(.up))
        var picked: [MonthlyCostChartPoint] = []
        var offset = 0
        while offset < points.count {
            picked.append(points[offset])
            offset += Swift.max(1, stride)
        }
        if let last = points.last, picked.last?.index != last.index {
            picked.append(last)
        }
        return orderedUniqueMonths(picked)
    }

    /// The `YYYY-MM` keys in order, de-duplicated (keeping first appearance) so an
    /// axis-tick set never contains a repeated category.
    private static func orderedUniqueMonths(_ points: [MonthlyCostChartPoint]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for point in points where seen.insert(point.month).inserted {
            result.append(point.month)
        }
        return result
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum MonthlyCostSurface {
    public static let slug = "MonthlyCostChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) and the cost is rendered through an
/// injected currency formatter, so the summaries are testable without a bundle or
/// a settings store (exactly like the view's P1/S10 + formatting facades).
public enum MonthlyCostAccessibility {
    /// The chart-level summary: title + bucket count + total / latest / range /
    /// average, or the friendly `noData` message when the trend is empty.
    public static func chartSummary(
        _ points: [MonthlyCostChartPoint],
        localize: (String, String) -> String,
        formatCurrency: (Double) -> String
    ) -> String {
        let title = localize("costAnalysis.charts.monthlyCost", "Monthly Cost Trend")
        guard let stats = MonthlyCostProjection.stats(points) else {
            return title + ": " + localize("costAnalysis.charts.noData", "Not enough data")
        }
        let monthsWord = localize("costAnalysis.charts.a11y.months", "months")
        let totalWord = localize("costAnalysis.charts.a11y.total", "total")
        let latestWord = localize("costAnalysis.charts.a11y.latest", "latest")
        let rangeWord = localize("costAnalysis.charts.a11y.range", "range")
        let averageWord = localize("costAnalysis.charts.a11y.average", "average")
        let latestLabel = MonthlyCostMonthLabel.short(stats.latestMonth)
        let range = "\(formatCurrency(stats.minimum)) – \(formatCurrency(stats.maximum))"
        return "\(title): \(stats.count) \(monthsWord), "
            + "\(totalWord) \(formatCurrency(stats.total)), "
            + "\(latestWord) \(latestLabel) \(formatCurrency(stats.latest)), "
            + "\(rangeWord) \(range), "
            + "\(averageWord) \(formatCurrency(stats.average))"
    }

    /// One vertex's VoiceOver label: the `MM/YY` month (web X value, formatted).
    public static func pointLabel(_ point: MonthlyCostChartPoint) -> String {
        point.shortMonth
    }

    /// One vertex's VoiceOver value: the formatted cost (web Y value).
    public static func pointValue(
        _ point: MonthlyCostChartPoint,
        formatCurrency: (Double) -> String
    ) -> String {
        formatCurrency(point.cost)
    }
}
