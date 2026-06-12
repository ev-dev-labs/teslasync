//
//  WidgetComparisonCard.Adapter.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  The Foundation-only core for the comparison card — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetComparisonCard.tsx`. This file owns the surface identity (the
//  diagnostics slug), the row value type (``ComparisonMetric``, the native peer of the web
//  `ComparisonMetric`), the props (``WidgetComparisonCardInput``), the view-ready row
//  (``ComparisonRow``), the resolved ``WidgetComparisonCardProjection``, and the pure
//  ``WidgetComparisonCardProjector`` that ports the web render decision (the `compact` slice, the
//  `higherIsBetter ?? true` direction resolution, the `visible.length === 0` empty branch). No SwiftUI and
//  no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<WidgetComparisonCard>` is a PURE presentational primitive — a shared
//  widget building block. It takes its data as plain props (`metrics`, `compact`) and renders a column of
//  rows, with no fetch, no React-Query cache, and no Promise, so it has NO loading, error, stale, or offline
//  branch (there is nothing to fetch, fail, age, or lose connectivity to — the host widget that owns the
//  query renders those). Inventing such chrome would fabricate states the source does not have, so this
//  surface reproduces only the source's REAL branches — exactly as the sibling presentational primitives
//  Delta (0081), MetricCard (0095), and Accordion (0203) did. The real branches: the populated column (one
//  ``ComparisonRow`` per visible metric, hairline-separated), the `compact` slice (the first two metrics),
//  and the empty leaf (the web `visible.length === 0` → "No comparison data"). The per-row change indicator
//  is delegated to the shared ``Delta`` surface (0081), the native peer of the web `<Delta>` the row renders.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetComparisonCardSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetComparisonCard"
}

// MARK: - ComparisonMetric (web `ComparisonMetric`)

/// One comparison row's data — the native peer of the web `ComparisonMetric` interface. `current` /
/// `previous` are the two comparison endpoints in display units (caller-converted, the web `number`);
/// `formattedCurrent` is the caller's already-formatted current value (the web `formattedCurrent`); `unit`
/// is the optional trailing affix (the web `unit?`); `higherIsBetter` is the direction hint, resolved with
/// the web default (`higherIsBetter ?? true`) so an omitted value treats a rise as favorable.
public struct ComparisonMetric: Sendable, Equatable {
    /// The row label (web `label`) — caller-supplied + already localized, rendered verbatim.
    public let label: String
    /// Current-period value, in display units (web `current`) — fed to the row's ``Delta``.
    public let current: Double
    /// Previous-period value, in display units (web `previous`) — fed to the row's ``Delta``.
    public let previous: Double
    /// The already-formatted current value shown as the row's headline (web `formattedCurrent`).
    public let formattedCurrent: String
    /// The optional trailing unit affix (web `unit?`); `nil` / empty renders no affix.
    public let unit: String?
    /// Whether a rise is favorable (web `higherIsBetter ?? true`) — drives the ``Delta`` tone.
    public let higherIsBetter: Bool

    public init(
        label: String,
        current: Double,
        previous: Double,
        formattedCurrent: String,
        unit: String? = nil,
        higherIsBetter: Bool = true
    ) {
        self.label = label
        self.current = current
        self.previous = previous
        self.formattedCurrent = formattedCurrent
        self.unit = unit
        self.higherIsBetter = higherIsBetter
    }
}

// MARK: - WidgetComparisonCardInput (web props)

/// The component's props — the native peer of `WidgetComparisonCardProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when a reused card rebinds.
public struct WidgetComparisonCardInput: Sendable, Equatable {
    /// The metrics to compare (web `metrics`). An empty array resolves to the empty branch.
    public let metrics: [ComparisonMetric]
    /// Whether to render the condensed variant — the first two metrics only (web `compact`).
    public let compact: Bool

    public init(metrics: [ComparisonMetric], compact: Bool = false) {
        self.metrics = metrics
        self.compact = compact
    }
}

// MARK: - ComparisonRow (view-ready)

/// A resolved, view-ready row — everything the SwiftUI row needs as a pure function of a
/// ``ComparisonMetric`` plus its position (no derivation in the view). `direction` is the resolved
/// ``DeltaDirection`` (web `higherIsBetter ? 'higher_better' : 'lower_better'`); `isLast` drives the
/// hairline separator (web `border-b … last:border-b-0`); `id` is the stable positional identity for the
/// SwiftUI `ForEach` (more robust than the web `key={label}`, which assumes unique labels).
public struct ComparisonRow: Sendable, Equatable, Identifiable {
    /// Stable positional identity for `ForEach` (the metric's index in the visible list).
    public let id: Int
    /// The row label (web `label`).
    public let label: String
    /// The already-formatted current value (web `formattedCurrent`).
    public let formattedCurrent: String
    /// The optional trailing unit affix (web `unit?`).
    public let unit: String?
    /// Current-period value, passed through to the row's ``Delta`` (web `current`).
    public let current: Double
    /// Previous-period value, passed through to the row's ``Delta`` (web `previous`).
    public let previous: Double
    /// The resolved direction for the row's ``Delta`` (web `{ direction }`).
    public let direction: DeltaDirection
    /// Whether this is the final row — suppresses the trailing separator (web `last:border-b-0`).
    public let isLast: Bool

    public init(
        id: Int,
        label: String,
        formattedCurrent: String,
        unit: String?,
        current: Double,
        previous: Double,
        direction: DeltaDirection,
        isLast: Bool
    ) {
        self.id = id
        self.label = label
        self.formattedCurrent = formattedCurrent
        self.unit = unit
        self.current = current
        self.previous = previous
        self.direction = direction
        self.isLast = isLast
    }
}

// MARK: - WidgetComparisonCardProjection (web render output)

/// The resolved render decision — the two real branches of the web source: the populated column (one
/// ``ComparisonRow`` per visible metric) or the empty leaf (web `visible.length === 0`).
public enum WidgetComparisonCardProjection: Sendable, Equatable {
    /// No visible metrics — the web `<p>No comparison data</p>` branch.
    case empty
    /// One or more visible rows — the web `visible.map(...)` column.
    case populated([ComparisonRow])
}

// MARK: - WidgetComparisonCardProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock) and derives the rendered column. Unit tested across the `compact` slice, the direction
/// resolution, the row mapping, and the empty branch.
public enum WidgetComparisonCardProjector {
    /// The number of metrics kept in `compact` mode — the web `metrics.slice(0, 2)`.
    public static let compactLimit = 2

    /// The visible metrics — the verbatim port of `compact ? metrics.slice(0, 2) : metrics`.
    public static func visibleMetrics(_ input: WidgetComparisonCardInput) -> [ComparisonMetric] {
        input.compact ? Array(input.metrics.prefix(compactLimit)) : input.metrics
    }

    /// Resolves the row direction — the web `higherIsBetter ? 'higher_better' : 'lower_better'`. The
    /// `higherIsBetter ?? true` default is already applied when the ``ComparisonMetric`` is built.
    public static func direction(higherIsBetter: Bool) -> DeltaDirection {
        higherIsBetter ? .higherBetter : .lowerBetter
    }

    /// Builds the view-ready rows from the props — the web `visible.map((m) => <MetricRow … />)`.
    public static func rows(_ input: WidgetComparisonCardInput) -> [ComparisonRow] {
        let visible = visibleMetrics(input)
        let lastIndex = visible.count - 1
        return visible.enumerated().map { index, metric in
            ComparisonRow(
                id: index,
                label: metric.label,
                formattedCurrent: metric.formattedCurrent,
                unit: metric.unit,
                current: metric.current,
                previous: metric.previous,
                direction: direction(higherIsBetter: metric.higherIsBetter),
                isLast: index == lastIndex
            )
        }
    }

    /// Resolves the whole render decision from the props — the native peer of the web component's render.
    public static func resolve(_ input: WidgetComparisonCardInput) -> WidgetComparisonCardProjection {
        let resolvedRows = rows(input)
        return resolvedRows.isEmpty ? .empty : .populated(resolvedRows)
    }
}
