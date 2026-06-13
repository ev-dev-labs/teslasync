//
//  AreaChartWrapper.Projection.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved, view-ready state — the
//  native port of the web `AreaChartWrapper` render (the per-series gradient areas + the cartesian
//  grid + the tooltip) plus the P4 leaf contract (loading / error / empty / withdrawn / stale /
//  offline). The per-series point projection (`AreaChartProjector.points`) is applied here, then
//  localization (P1/S10, via an injected resolver) so the view is a pure function of the result and
//  every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved series (web `<Area>`, localized for display + VoiceOver)

/// One view-ready series — the localized projection of an ``AreaChartSeries`` joined with its finite
/// points: the tooltip label, the swatch (explicit hex + brand-palette fallback index), the projected
/// points the area + line are drawn from, and the spoken latest / low / high summary. The view renders
/// this verbatim.
public struct AreaChartSeriesRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String
    public let colorIndex: Int
    public let points: [AreaChartPoint]
    public let accessibilitySummary: String

    public init(
        id: String,
        label: String,
        colorHex: String,
        colorIndex: Int,
        points: [AreaChartPoint],
        accessibilitySummary: String
    ) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.colorIndex = colorIndex
        self.points = points
        self.accessibilitySummary = accessibilitySummary
    }
}

// MARK: - Resolved plot (the populated chart payload)

/// The populated chart payload — the resolved series, the formatted x-axis labels for the whole
/// domain, the value formatter the y-axis ticks + tooltip share (web `yFormatter`), and the joined
/// VoiceOver summary. Equatable so the view re-renders only when the projection changes.
public struct AreaChartPlot: Sendable, Equatable {
    public let series: [AreaChartSeriesRow]
    public let labels: [String]
    public let valueFormat: AreaValueFormat
    public let accessibilitySummary: String

    public init(
        series: [AreaChartSeriesRow],
        labels: [String],
        valueFormat: AreaValueFormat,
        accessibilitySummary: String
    ) {
        self.series = series
        self.labels = labels
        self.valueFormat = valueFormat
        self.accessibilitySummary = accessibilitySummary
    }
}

// MARK: - Resolved freshness chip (P4 connectivity axis)

/// The freshness affordance shown above the chart when the snapshot is not live — the localized label,
/// the VoiceOver label, and whether it represents the offline (vs stale) tone.
public struct AreaChartFreshness: Sendable, Equatable {
    public let label: String
    public let accessibilityLabel: String
    public let isOffline: Bool

    public init(label: String, accessibilityLabel: String, isOffline: Bool) {
        self.label = label
        self.accessibilityLabel = accessibilityLabel
        self.isOffline = isOffline
    }
}

// MARK: - Resolved empty / error chrome

/// The friendly empty-state copy (P4 "never a blank box").
public struct AreaChartEmpty: Sendable, Equatable {
    public let title: String
    public let message: String

    public init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}

/// The query-failure copy (the `QueryError` peer).
public struct AreaChartErrorContent: Sendable, Equatable {
    public let message: String
    public let accessibilityLabel: String

    public init(message: String, accessibilityLabel: String) {
        self.message = message
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the rendered body; `chartAccessibilityLabel` names
/// the chart for VoiceOver; `height` is the web `height` prop; `freshness` decorates the populated
/// chart.
public struct AreaChartResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Data still resolving (host fetch) → skeleton chart.
        case loading
        /// Data fetch failed → a `QueryError` peer with retry.
        case error(AreaChartErrorContent)
        /// Resolved + nothing to chart, `.emptyState` policy → friendly empty state.
        case empty(AreaChartEmpty)
        /// Resolved + nothing to chart, `.withdraw` policy → render nothing (host hides the region).
        case withdrawn
        /// Resolved + at least one finite point → the gradient area chart.
        case populated(AreaChartPlot)
    }

    public let phase: Phase
    public let chartAccessibilityLabel: String
    public let height: Double
    public let freshness: AreaChartFreshness?

    public init(
        phase: Phase,
        chartAccessibilityLabel: String,
        height: Double,
        freshness: AreaChartFreshness? = nil
    ) {
        self.phase = phase
        self.chartAccessibilityLabel = chartAccessibilityLabel
        self.height = height
        self.freshness = freshness
    }

    /// Whether the surface is showing its actual content (the chart or the friendly empty state) — the
    /// moment the surface is considered "opened" for the P1/S11 `view.opened` event. Loading is
    /// pre-content, `error` is failure chrome, and `withdrawn` is the host-hidden collapse, so none of
    /// those count.
    public var presentsContent: Bool {
        switch phase {
        case .populated, .empty:
            true
        case .loading, .error, .withdrawn:
            false
        }
    }
}

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AreaChartWrapper` render plus the P4 leaf contract. Unit tested across loading / error / empty
/// (both policies) / populated, the per-series finite-only projection, the multi-series mapping, the
/// y / x formatters, and the carried connectivity axis.
public enum AreaChartProjection {
    public static func resolve(
        _ input: AreaChartInput,
        strings: AreaChartResolve = AreaChartWrapperStrings.string
    ) -> AreaChartResolved {
        let chartLabel = strings("areaChart.a11y.chart", "Area chart")

        switch input.availability {
        case .loading:
            return AreaChartResolved(
                phase: .loading,
                chartAccessibilityLabel: chartLabel,
                height: input.height
            )

        case let .failed(message):
            return AreaChartResolved(
                phase: .error(errorContent(message, strings: strings)),
                chartAccessibilityLabel: chartLabel,
                height: input.height
            )

        case let .resolved(data):
            return resolvePayload(data, input: input, chartLabel: chartLabel, strings: strings)
        }
    }

    // MARK: Resolved payload (web render branch)

    private static func resolvePayload(
        _ data: AreaChartData,
        input: AreaChartInput,
        chartLabel: String,
        strings: AreaChartResolve
    ) -> AreaChartResolved {
        let rows = projectedRows(data, valueFormat: input.valueFormat, strings: strings)
        let hasData = rows.contains { !$0.points.isEmpty }

        guard hasData else {
            switch input.emptyBehavior {
            case .withdraw:
                return AreaChartResolved(
                    phase: .withdrawn,
                    chartAccessibilityLabel: chartLabel,
                    height: input.height
                )
            case .emptyState:
                return AreaChartResolved(
                    phase: .empty(empty(strings: strings)),
                    chartAccessibilityLabel: chartLabel,
                    height: input.height
                )
            }
        }

        let plot = AreaChartPlot(
            series: rows,
            labels: AreaChartProjector.labels(rows: data.rows, format: input.xFormat),
            valueFormat: input.valueFormat,
            accessibilitySummary: AreaChartAccessibility.chartValue(summaries: rows.map(\.accessibilitySummary))
        )
        return AreaChartResolved(
            phase: .populated(plot),
            chartAccessibilityLabel: chartLabel,
            height: input.height,
            freshness: freshness(for: input.connection, strings: strings)
        )
    }

    // MARK: Series (web `<Area>` body, localized)

    private static func projectedRows(
        _ data: AreaChartData,
        valueFormat: AreaValueFormat,
        strings: AreaChartResolve
    ) -> [AreaChartSeriesRow] {
        data.series.map { descriptor in
            let points = AreaChartProjector.points(rows: data.rows, seriesId: descriptor.id)
            return AreaChartSeriesRow(
                id: descriptor.id,
                label: descriptor.label,
                colorHex: descriptor.colorHex,
                colorIndex: descriptor.colorIndex,
                points: points,
                accessibilitySummary: summary(
                    label: descriptor.label,
                    points: points,
                    valueFormat: valueFormat,
                    strings: strings
                )
            )
        }
    }

    private static func summary(
        label: String,
        points: [AreaChartPoint],
        valueFormat: AreaValueFormat,
        strings: AreaChartResolve
    ) -> String {
        guard !points.isEmpty else {
            return AreaChartAccessibility.seriesEmpty(
                template: strings("areaChart.a11y.seriesEmpty", "%1$@: no data"),
                label: label
            )
        }
        let values = points.map(\.value)
        return AreaChartAccessibility.seriesSummary(
            template: strings("areaChart.a11y.series", "%1$@: latest %2$@, low %3$@, high %4$@"),
            label: label,
            latest: AreaChartFormat.number(values.last ?? .nan, format: valueFormat),
            low: AreaChartFormat.number(values.min() ?? .nan, format: valueFormat),
            high: AreaChartFormat.number(values.max() ?? .nan, format: valueFormat)
        )
    }

    // MARK: Empty / error chrome

    private static func empty(strings: AreaChartResolve) -> AreaChartEmpty {
        AreaChartEmpty(
            title: strings("areaChart.empty.title", "No data"),
            message: strings("areaChart.empty.message", "There's nothing to chart yet.")
        )
    }

    private static func errorContent(
        _ message: String,
        strings: AreaChartResolve
    ) -> AreaChartErrorContent {
        let resolved = message.isEmpty
            ? strings("areaChart.error.message", "Couldn't load the chart.")
            : message
        let title = strings("areaChart.error.title", "Couldn't load the chart")
        return AreaChartErrorContent(
            message: resolved,
            accessibilityLabel: "\(title): \(resolved)"
        )
    }

    // MARK: Freshness (P4 connectivity axis)

    /// The freshness chip for a connection — `nil` when live (the chart stands alone), else a stale /
    /// offline chip with a refresh hint.
    private static func freshness(
        for connection: AreaChartConnection,
        strings: AreaChartResolve
    ) -> AreaChartFreshness? {
        switch connection {
        case .live:
            nil
        case .stale:
            AreaChartFreshness(
                label: strings("areaChart.freshness.stale", "Stale"),
                accessibilityLabel: strings("areaChart.freshness.staleA11y", "Stale — tap to refresh"),
                isOffline: false
            )
        case .offline:
            AreaChartFreshness(
                label: strings("areaChart.freshness.offline", "Offline"),
                accessibilityLabel: strings(
                    "areaChart.freshness.offlineA11y",
                    "Offline — showing the last known data"
                ),
                isOffline: true
            )
        }
    }
}
