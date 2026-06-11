//
//  MetricSwitcherChart.Source.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  The pure, Foundation-only data types + chart logic for the metric-switcher chart — the native
//  parity of the web `MetricSwitcherMetric` config, the projected `{date, value}` series, and the
//  `formatValue` / `formatTick` closures. View-free and fully value-typed (Sendable + Equatable) so
//  the projection and every helper are unit tested without rendering a view.
//

import Foundation

// MARK: - Chart kind (web `metric.chart`: 'bar' | 'area' | 'line')

/// The visualisation a metric renders as — the native port of the web `chart?: 'bar' | 'area' |
/// 'line'`. `bar` is the safe default for count-like metrics; `area` / `line` suit continuous series.
public enum MetricSwitcherChartKind: String, Sendable, Equatable, CaseIterable {
    case bar
    case area
    case line
}

// MARK: - Value format (web `formatValue` / `formatTick`)

/// A value-typed formatter for a metric's Y values — the native, testable parity of the web
/// `formatValue` / `formatTick` closures. Non-finite input renders an em dash (never "nan"), so a
/// corrupt sample can never surface as a broken axis label or tooltip.
public enum MetricSwitcherValueFormat: Sendable, Equatable {
    /// Trimmed plain number — integers render without a decimal point (web default `String(value)`).
    case plain
    /// Rounded to a whole number.
    case integer
    /// Fixed decimal places.
    case decimal(places: Int)
    /// A trimmed/fixed number followed by a unit suffix, e.g. `"10 mi"` (web ``${v} mi``).
    case suffixed(unit: String, places: Int)

    /// Formats a value for display on the tooltip / axis.
    public func format(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        switch self {
        case .plain:
            return Self.trimmed(value)
        case .integer:
            return String(format: "%.0f", value.rounded())
        case let .decimal(places):
            return String(format: "%.\(max(0, places))f", value)
        case let .suffixed(unit, places):
            let number = places <= 0 ? Self.trimmed(value) : String(format: "%.\(places)f", value)
            return unit.isEmpty ? number : "\(number) \(unit)"
        }
    }

    /// Integer-valued numbers drop the decimal point; fractional numbers print without trailing zeros.
    private static func trimmed(_ value: Double) -> String {
        value.rounded() == value ? String(format: "%.0f", value) : String(format: "%g", value)
    }
}

// MARK: - Localized text (caller-supplied title / labels / empty message)

/// A piece of caller-supplied display text — either a localisation key with its English fallback
/// (resolved through the P1/S10 facade) or a verbatim string (for dynamic, user-derived labels). The
/// native shape of the web props that arrive already-localised from the call site (`title`,
/// `metric.label`, `emptyMessage`, `ariaLabel`).
public enum MetricSwitcherText: Sendable, Equatable {
    case localized(key: String, fallback: String)
    case verbatim(String)
}

// MARK: - Metric spec + point (web `MetricSwitcherMetric` + projected `{date, value}`)

/// A switchable metric — the native port of the web `MetricSwitcherMetric`. The per-point value
/// accessor (`getValue`) is applied by the caller when building the ``MetricSwitcherPoint`` series, so
/// this spec carries only the display concerns: the stable key, the pill label, the chart kind, the
/// palette colour index (tokenised — never a raw hex), and the value / tick formatters.
public struct MetricSwitcherMetricSpec: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: MetricSwitcherText
    public let kind: MetricSwitcherChartKind
    public let colorIndex: Int
    public let valueFormat: MetricSwitcherValueFormat
    public let tickFormat: MetricSwitcherValueFormat?

    public init(
        id: String,
        label: MetricSwitcherText,
        kind: MetricSwitcherChartKind = .bar,
        colorIndex: Int = 0,
        valueFormat: MetricSwitcherValueFormat = .plain,
        tickFormat: MetricSwitcherValueFormat? = nil
    ) {
        self.id = id
        self.label = label
        self.kind = kind
        self.colorIndex = colorIndex
        self.valueFormat = valueFormat
        self.tickFormat = tickFormat
    }

    /// The axis tick formatter — the web `formatTick ?? formatValue` fallback.
    public var resolvedTickFormat: MetricSwitcherValueFormat {
        tickFormat ?? valueFormat
    }
}

/// One projected sample — the native port of the web `{ date, __value }` row: the X-axis category
/// label (already display-ready, web `formatXTick(date)`) and the numeric Y value.
public struct MetricSwitcherPoint: Sendable, Equatable, Identifiable {
    public let dateLabel: String
    public let value: Double

    public var id: String {
        dateLabel
    }

    public init(dateLabel: String, value: Double) {
        self.dateLabel = dateLabel
        self.value = value
    }
}

// MARK: - Dataset (web `metrics` + `series` props)

/// The data the chart renders — the native pairing of the web `metrics` config and the per-metric
/// `series` map. Both arrive from the parent (the web parent's fetch); the surface is presentational.
public struct MetricSwitcherDataset: Sendable, Equatable {
    public let metrics: [MetricSwitcherMetricSpec]
    public let series: [String: [MetricSwitcherPoint]]

    public init(metrics: [MetricSwitcherMetricSpec], series: [String: [MetricSwitcherPoint]]) {
        self.metrics = metrics
        self.series = series
    }

    /// The empty dataset — used when a `LoadableState.empty` resolves with no content at all.
    public static let empty = MetricSwitcherDataset(metrics: [], series: [:])

    /// The series for a metric key (web `series[active.key] ?? []`).
    public func points(for metricID: String) -> [MetricSwitcherPoint] {
        series[metricID] ?? []
    }
}

// MARK: - Connection axis (P4 freshness: live / stale / offline)

/// The freshness of the displayed snapshot — projected from the `LoadableState`'s `stale` flag and
/// the failure shape, driving the stale / offline chip (P4 leaf contract).
public enum MetricSwitcherConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Layout tokens

/// Layout constants for the surface (web `height = 220` default).
public enum MetricSwitcherChartLayout {
    public static let defaultHeight: Double = 220
    public static let maxAxisLabels = 6
}

// MARK: - Pure chart logic (active resolution, sanitising, axis thinning, a11y summary)

/// The view-free decision logic ported from the web component plus the chart-canvas helpers. Each
/// function is a direct translation of a web behaviour (or a Swift Charts adaptation of one) so the
/// view stays a pure function of these and every branch is unit tested in isolation.
public enum MetricSwitcherChartLogic {
    /// The active metric — the web `metrics.find((m) => m.key === activeMetric) ?? metrics[0]`.
    public static func activeMetric(
        in metrics: [MetricSwitcherMetricSpec],
        activeID: String
    ) -> MetricSwitcherMetricSpec? {
        metrics.first { $0.id == activeID } ?? metrics.first
    }

    /// Drops non-finite samples so a corrupt value can never break the axis (web charts skip `NaN`).
    public static func sanitized(_ points: [MetricSwitcherPoint]) -> [MetricSwitcherPoint] {
        points.filter(\.value.isFinite)
    }

    /// An evenly-strided subset of the X-axis labels (keeps endpoints) — the Swift Charts adaptation
    /// of the web `interval="preserveStartEnd" minTickGap={16}` axis thinning.
    public static func axisDateLabels(
        _ points: [MetricSwitcherPoint],
        maxLabels: Int = MetricSwitcherChartLayout.maxAxisLabels
    ) -> [String] {
        let labels = points.map(\.dateLabel)
        guard maxLabels > 1, labels.count > maxLabels else { return labels }
        let step = Double(labels.count - 1) / Double(maxLabels - 1)
        var picked: [String] = []
        var seen = Set<Int>()
        for index in 0 ..< maxLabels {
            let resolved = Int((Double(index) * step).rounded())
            if seen.insert(resolved).inserted { picked.append(labels[resolved]) }
        }
        return picked
    }

    /// A concise VoiceOver summary for the plotted series (min / max / latest), localised.
    public static func accessibilitySummary(
        label: String,
        points: [MetricSwitcherPoint],
        format: MetricSwitcherValueFormat,
        strings: MetricSwitcherResolve
    ) -> String {
        let values = points.map(\.value).filter(\.isFinite)
        guard let first = values.first else { return label }
        let minValue = values.min() ?? first
        let maxValue = values.max() ?? first
        let last = values.last ?? first
        let template = strings("metricSwitcher.a11y.summary", "%1$@: minimum %2$@, maximum %3$@, latest %4$@")
        return String(
            format: template,
            label,
            format.format(minValue),
            format.format(maxValue),
            format.format(last)
        )
    }
}
