//
//  ChartHiddenSeriesContext.Projection.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  The pure projection from the cached URL value (the `?hidden_{chartKey}=…` query string) to the
//  resolved, view-ready state every descendant legend reads — the native port of what the web
//  `useHiddenSeries(chartKey)` returns (the `HiddenSeriesState`: the hidden set + the derived reads).
//  The view (and the legend bridge) is a pure function of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for: it
//  takes the cached query string for one chart, decodes it through ``HiddenSeriesParam``, and derives
//  the hidden set, the canonical (sorted) ordering, and the round-trip query value, collapsing the
//  empty / non-empty branch exactly as the web hook does.
//

import Foundation

// MARK: - Resolved read-model (web useHiddenSeries return value)

/// The resolved, view-ready projection of one chart's hidden-series state — the native peer of the
/// web `HiddenSeriesState` reads. `hidden` mirrors `HiddenSeriesState.hidden`, `isHidden(_:)` mirrors
/// `HiddenSeriesState.isHidden`, `sortedKeys` is the canonical (URL) ordering, and `queryValue` is the
/// shareable deep-link value (`nil` when nothing is hidden, i.e. the param is dropped). The legend
/// bridge dims/strikes any series for which `isHidden` is `true` and the chart omits its mark (web
/// `<Line hide={state.isHidden(key)} />`).
public struct HiddenSeriesResolved: Sendable, Equatable {
    /// The chart this state belongs to (web `chartKey`).
    public let chartKey: String
    /// The set of series `dataKey`s currently hidden (web `HiddenSeriesState.hidden`).
    public let hidden: Set<String>

    public init(chartKey: String, hidden: Set<String>) {
        self.chartKey = chartKey
        self.hidden = hidden
    }

    /// Whether a given series `dataKey` is hidden (web `HiddenSeriesState.isHidden`).
    public func isHidden(_ seriesKey: String) -> Bool {
        HiddenSeriesReducer.isHidden(hidden, seriesKey)
    }

    /// `true` when no series is hidden — the chart renders every mark (web `hidden.size === 0`).
    public var isEmpty: Bool {
        hidden.isEmpty
    }

    /// The number of currently-hidden series (web `hidden.size`).
    public var count: Int {
        hidden.count
    }

    /// The canonical, alphabetically sorted hidden keys — the URL ordering `useHiddenSeries.toggle`
    /// writes; also the stable order a legend's VoiceOver summary reads.
    public var sortedKeys: [String] {
        HiddenSeriesParam.canonical(hidden)
    }

    /// The shareable deep-link value for this chart (`nil` when nothing is hidden, dropping the
    /// param) — web `serialize(Array.from(hidden).sort())` under `omitDefault`.
    public var queryValue: String? {
        HiddenSeriesParam.encode(hidden)
    }

    /// The "nothing hidden" projection for a chart — every series shown (web fresh page / `reset()`).
    public static func empty(chartKey: String) -> HiddenSeriesResolved {
        HiddenSeriesResolved(chartKey: chartKey, hidden: [])
    }
}

// MARK: - Projection (cached URL value → resolved)

/// Pure projection from the cached query value (or an already-decoded set) to the resolved read-model
/// for one chart. `resolve(chartKey:raw:)` decodes the raw `?hidden_{chartKey}=…` string through
/// ``HiddenSeriesParam`` (web `useUrlArray.parse` + `new Set`); `resolve(chartKey:hidden:)` projects an
/// in-memory set (used by the live store, which already holds the decoded set).
public enum ChartHiddenSeriesProjection {
    /// Projects a raw query value into the resolved state (web `parse` → `new Set` → `HiddenSeriesState`).
    public static func resolve(chartKey: String, raw: String?) -> HiddenSeriesResolved {
        HiddenSeriesResolved(chartKey: chartKey, hidden: HiddenSeriesParam.decode(raw))
    }

    /// Projects an already-decoded set into the resolved state (the live store path).
    public static func resolve(chartKey: String, hidden: Set<String>) -> HiddenSeriesResolved {
        HiddenSeriesResolved(chartKey: chartKey, hidden: hidden)
    }
}
