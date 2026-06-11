//
//  MetricSwitcherChart.Projection.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  The pure projection from a cache-then-network `LoadableState` (P1/S8) to the resolved, view-ready
//  state — the native port of the web `MetricSwitcherChart` body (the active-metric resolution, the
//  per-metric projection, the chart / empty branch) plus the P4 leaf contract (loading / error /
//  stale / offline). Localisation is applied here (P1/S10, via an injected resolver) so the view is a
//  pure function of the result and every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Input (the coalesced snapshot the projection consumes)

/// The pure, view-free snapshot the projection consumes — the availability of the dataset plus the
/// freshness axis and the raw active-metric key. Built from a `LoadableState` by ``from(_:activeID:)``
/// (the "cached → projection" adapter), or directly in previews / tests.
public struct MetricSwitcherInput: Sendable, Equatable {
    /// Whether the dataset has resolved, is still loading, or failed with no cached value.
    public enum Availability: Sendable, Equatable {
        case loading
        case failed(retryable: Bool)
        case resolved(MetricSwitcherDataset)
    }

    public let availability: Availability
    public let connection: MetricSwitcherConnection
    public let activeID: String

    public init(availability: Availability, connection: MetricSwitcherConnection, activeID: String) {
        self.availability = availability
        self.connection = connection
        self.activeID = activeID
    }
}

public extension MetricSwitcherInput {
    /// Projects the shared-core cache-then-network ``LoadableState`` (P1/S8) into the pure input.
    ///
    /// A cached value (carried by `loading` and `failed`) is kept on screen behind the freshness axis:
    /// a connectivity failure surfaces it as offline, a `stale` flag as stale. A failure with no cache
    /// becomes the error chrome; an in-flight load with no cache becomes the loading chrome.
    static func from(_ state: LoadableState<MetricSwitcherDataset>, activeID: String) -> MetricSwitcherInput {
        switch state {
        case .idle:
            return MetricSwitcherInput(availability: .loading, connection: .live, activeID: activeID)
        case let .loading(cached, stale):
            if let cached {
                return MetricSwitcherInput(
                    availability: .resolved(cached),
                    connection: stale ? .stale : .live,
                    activeID: activeID
                )
            }
            return MetricSwitcherInput(availability: .loading, connection: .live, activeID: activeID)
        case let .loaded(data, stale):
            return MetricSwitcherInput(
                availability: .resolved(data),
                connection: stale ? .stale : .live,
                activeID: activeID
            )
        case let .empty(stale):
            return MetricSwitcherInput(
                availability: .resolved(.empty),
                connection: stale ? .stale : .live,
                activeID: activeID
            )
        case let .failed(error, cached, stale):
            if let cached {
                return MetricSwitcherInput(
                    availability: .resolved(cached),
                    connection: connection(for: error, stale: stale),
                    activeID: activeID
                )
            }
            return MetricSwitcherInput(
                availability: .failed(retryable: error.isRetryable),
                connection: .live,
                activeID: activeID
            )
        }
    }

    /// Connectivity failures surface a cached value as offline; other failures keep the stale axis.
    private static func connection(for error: FacadeError, stale: Bool) -> MetricSwitcherConnection {
        switch error {
        case .offline, .network, .timeout, .circuitOpen:
            .offline
        case .api, .decode, .auth, .cancelled, .unknown:
            stale ? .stale : .live
        }
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// One pill in the metric switcher — the localised label keyed by its metric id (web `PillItem`).
public struct MetricSwitcherPill: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

/// The freshness chip shown beside the title when the snapshot is not live — the localised label, the
/// VoiceOver label, and whether it represents the offline (vs stale) tone.
public struct MetricSwitcherFreshness: Sendable, Equatable {
    public let label: String
    public let accessibilityLabel: String
    public let isOffline: Bool

    public init(label: String, accessibilityLabel: String, isOffline: Bool) {
        self.label = label
        self.accessibilityLabel = accessibilityLabel
        self.isOffline = isOffline
    }
}

/// A view-ready metric ready to plot — the active metric's localised label, kind, colour, sanitised
/// points, thinned axis labels, value / tick formatters, and a VoiceOver summary. The chart canvas is
/// a pure function of this, so the projection is fully unit tested without rendering Swift Charts.
public struct MetricSwitcherPlottedMetric: Sendable, Equatable, Identifiable {
    public let id: String
    public let labelText: String
    public let kind: MetricSwitcherChartKind
    public let colorIndex: Int
    public let points: [MetricSwitcherPoint]
    public let axisDateLabels: [String]
    public let valueFormat: MetricSwitcherValueFormat
    public let tickFormat: MetricSwitcherValueFormat
    public let accessibilitySummary: String

    public init(
        id: String,
        labelText: String,
        kind: MetricSwitcherChartKind,
        colorIndex: Int,
        points: [MetricSwitcherPoint],
        axisDateLabels: [String],
        valueFormat: MetricSwitcherValueFormat,
        tickFormat: MetricSwitcherValueFormat,
        accessibilitySummary: String
    ) {
        self.id = id
        self.labelText = labelText
        self.kind = kind
        self.colorIndex = colorIndex
        self.points = points
        self.axisDateLabels = axisDateLabels
        self.valueFormat = valueFormat
        self.tickFormat = tickFormat
        self.accessibilitySummary = accessibilitySummary
    }

    /// The display value for a point's tooltip (web `tooltipFormatter`).
    public func tooltipValue(_ point: MetricSwitcherPoint) -> String {
        valueFormat.format(point.value)
    }
}

/// The resolved, view-ready state. `body` selects the rendered chart area; `pills` + `freshness`
/// decorate the title bar, present whenever the dataset (fresh or cached) is known.
public struct MetricSwitcherResolved: Sendable, Equatable {
    /// The chart-area body — the web render branch layered with the P4 loading / error chrome.
    public enum Body: Sendable, Equatable {
        case loading
        case error(message: String, retryable: Bool)
        case empty(message: String)
        case chart(MetricSwitcherPlottedMetric)
    }

    public let title: String
    public let accessibilityLabel: String
    public let pills: [MetricSwitcherPill]
    public let activeID: String
    public let freshness: MetricSwitcherFreshness?
    public let body: Body
    public let height: Double

    public init(
        title: String,
        accessibilityLabel: String,
        pills: [MetricSwitcherPill],
        activeID: String,
        freshness: MetricSwitcherFreshness?,
        body: Body,
        height: Double
    ) {
        self.title = title
        self.accessibilityLabel = accessibilityLabel
        self.pills = pills
        self.activeID = activeID
        self.freshness = freshness
        self.body = body
        self.height = height
    }

    /// The metric currently plotted, if the body is a chart.
    public var plottedMetric: MetricSwitcherPlottedMetric? {
        if case let .chart(metric) = body { return metric }
        return nil
    }
}

// MARK: - Projection (web component body + P4 leaf contract)

/// A localisation resolver — `(key, englishFallback) -> resolved`. Defaults to the P1/S10 facade; the
/// tests inject an identity resolver so the projection is asserted against the web English fallbacks.
/// `@Sendable` because resolvers are pure (the facade reads `NSLocalizedString`) and are threaded
/// through value-typed projections under Swift 6 strict concurrency.
public typealias MetricSwitcherResolve = @Sendable (String, String) -> String

/// Pure projection from the coalesced input to the resolved view-state — the native port of the web
/// `MetricSwitcherChart` body (active-metric resolution, the per-metric projection, the chart / empty
/// branch) plus the P4 leaf contract. Localisation is applied here so the view is a pure function of
/// the result and every branch is unit tested without a store or SwiftUI.
public enum MetricSwitcherProjection {
    public static func resolve(
        _ input: MetricSwitcherInput,
        title: MetricSwitcherText,
        accessibilityLabel: MetricSwitcherText? = nil,
        emptyMessage: MetricSwitcherText? = nil,
        height: Double = MetricSwitcherChartLayout.defaultHeight,
        strings: MetricSwitcherResolve = MetricSwitcherChartStrings.string
    ) -> MetricSwitcherResolved {
        let resolvedTitle = MetricSwitcherChartStrings.resolve(title, strings)
        let resolvedA11y = accessibilityLabel
            .map { MetricSwitcherChartStrings.resolve($0, strings) } ?? resolvedTitle
        let resolvedEmpty = emptyMessage
            .map { MetricSwitcherChartStrings.resolve($0, strings) }
            ?? strings("metricSwitcher.empty.message", "No data available for this metric yet.")

        switch input.availability {
        case .loading:
            return MetricSwitcherResolved(
                title: resolvedTitle,
                accessibilityLabel: resolvedA11y,
                pills: [],
                activeID: input.activeID,
                freshness: nil,
                body: .loading,
                height: height
            )
        case let .failed(retryable):
            return MetricSwitcherResolved(
                title: resolvedTitle,
                accessibilityLabel: resolvedA11y,
                pills: [],
                activeID: input.activeID,
                freshness: nil,
                body: .error(
                    message: strings("metricSwitcher.error.message", "Couldn't load chart data."),
                    retryable: retryable
                ),
                height: height
            )
        case let .resolved(data):
            let pills = data.metrics.map {
                MetricSwitcherPill(id: $0.id, label: MetricSwitcherChartStrings.resolve($0.label, strings))
            }
            return MetricSwitcherResolved(
                title: resolvedTitle,
                accessibilityLabel: resolvedA11y,
                pills: pills,
                activeID: input.activeID,
                freshness: freshness(for: input.connection, strings: strings),
                body: chartBody(for: data, activeID: input.activeID, emptyMessage: resolvedEmpty, strings: strings),
                height: height
            )
        }
    }

    // MARK: Chart / empty branch (web `projected.length === 0 ? EmptyState : Chart`)

    private static func chartBody(
        for data: MetricSwitcherDataset,
        activeID: String,
        emptyMessage: String,
        strings: MetricSwitcherResolve
    ) -> MetricSwitcherResolved.Body {
        guard let active = MetricSwitcherChartLogic.activeMetric(in: data.metrics, activeID: activeID) else {
            return .empty(message: emptyMessage)
        }
        let points = MetricSwitcherChartLogic.sanitized(data.points(for: active.id))
        guard !points.isEmpty else {
            return .empty(message: emptyMessage)
        }
        return .chart(plot(active, points: points, strings: strings))
    }

    private static func plot(
        _ metric: MetricSwitcherMetricSpec,
        points: [MetricSwitcherPoint],
        strings: MetricSwitcherResolve
    ) -> MetricSwitcherPlottedMetric {
        let label = MetricSwitcherChartStrings.resolve(metric.label, strings)
        return MetricSwitcherPlottedMetric(
            id: metric.id,
            labelText: label,
            kind: metric.kind,
            colorIndex: metric.colorIndex,
            points: points,
            axisDateLabels: MetricSwitcherChartLogic.axisDateLabels(points),
            valueFormat: metric.valueFormat,
            tickFormat: metric.resolvedTickFormat,
            accessibilitySummary: MetricSwitcherChartLogic.accessibilitySummary(
                label: label,
                points: points,
                format: metric.valueFormat,
                strings: strings
            )
        )
    }

    // MARK: Freshness (P4 connectivity axis)

    private static func freshness(
        for connection: MetricSwitcherConnection,
        strings: MetricSwitcherResolve
    ) -> MetricSwitcherFreshness? {
        switch connection {
        case .live:
            nil
        case .stale:
            MetricSwitcherFreshness(
                label: strings("metricSwitcher.freshness.stale", "Stale"),
                accessibilityLabel: strings(
                    "metricSwitcher.freshness.staleA11y",
                    "Showing stale data — tap to refresh"
                ),
                isOffline: false
            )
        case .offline:
            MetricSwitcherFreshness(
                label: strings("metricSwitcher.freshness.offline", "Offline"),
                accessibilityLabel: strings(
                    "metricSwitcher.freshness.offlineA11y",
                    "Offline — showing the last known data"
                ),
                isOffline: true
            )
        }
    }
}
