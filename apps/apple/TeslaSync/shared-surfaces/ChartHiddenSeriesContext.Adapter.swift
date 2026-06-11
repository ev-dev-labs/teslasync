//
//  ChartHiddenSeriesContext.Adapter.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  The testable, dependency-light core for the chart hidden-series bridge — the SwiftUI parity of
//  components/charts/ChartHiddenSeriesContext.tsx + its data hook hooks/useHiddenSeries.ts (which is
//  itself `useUrlArray` from hooks/useUrlState.ts). The web source is a coordination primitive, not a
//  visual component: a React context (`ChartHiddenSeriesProvider`) hands every descendant legend the
//  URL-persisted set of currently-hidden series `dataKey`s for one named chart, so clicking a legend
//  entry toggles a series off and the toggle survives a reload and is carried by a shared deep-link.
//  This file is the Foundation-only heart of the native peer: the surface slug, the URL-param codec
//  (`HiddenSeriesParam`, the verbatim port of `useUrlArray`'s parse/serialize plus the canonical sort
//  `useHiddenSeries.toggle` applies), and the pure set algebra (`HiddenSeriesReducer`). No SwiftUI, no
//  Charts, no @Observable store — so every branch is unit testable in isolation.
//
//  Faithful-parity note: the web source renders NO chrome of its own — it is a transparent provider
//  whose only outputs are the `HiddenSeriesState` it broadcasts (the hidden set + toggle/isHidden/
//  reset) and, when no `chartKey` is supplied, a `null` context (the chart did not opt into legend
//  toggling). It performs NO fetch and reads NO remote data — the state lives entirely in the URL — so
//  it has no loading / empty / error / stale / offline branches. Inventing such chrome would
//  contradict the spec, so this surface reproduces only the source's REAL branches: inside vs. outside
//  a provider (`chartKey` present vs. absent), the hidden set empty vs. non-empty, and a given series
//  hidden vs. shown — exactly mirroring the sibling coordination primitives (ChartTimeRangeContext
//  0069, withAiFeature) which likewise render only their real outcomes.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web source is anonymous (it has no slug of its own); the prompt assigns this surface the
/// canonical slug `ChartHiddenSeriesContext`, kept here (SwiftUI-free) so the state-holder can emit
/// telemetry without depending on the view layer.
public enum ChartHiddenSeriesSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ChartHiddenSeriesContext"
}

// MARK: - HiddenSeriesParam (web useUrlArray + useHiddenSeries serialization)

/// The URL-param codec for one chart's hidden-series set — the verbatim port of how the web persists
/// the state: `useHiddenSeries(chartKey)` stores an alphabetically sorted, comma-joined list under
/// `?hidden_{chartKey}=…`, so
///
///     /battery/degradation?hidden_battery-degradation-trend=health,projected
///
/// is a bookmarkable view with two series toggled off. `useUrlArray`'s `parse` maps `''` → `[]` and
/// otherwise splits on the delimiter; its `serialize` joins on the delimiter; and `omitDefault` drops
/// the param entirely when the value is the empty default. `useHiddenSeries.toggle` keeps the written
/// list sorted so toggling A then B yields the same URL as B then A (a pasted-link string compare).
/// All of that lives here as pure, allocation-light functions so the rules are unit tested without a
/// store, a view, or a router.
public enum HiddenSeriesParam {
    /// The query-key prefix (web `HIDDEN_PARAM_PREFIX`).
    public static let prefix = "hidden_"

    /// The delimiter the list is joined with (web `useUrlArray` default `,`).
    public static let delimiter: Character = ","

    /// The full query-param name for a chart — web `` `${HIDDEN_PARAM_PREFIX}${chartKey}` ``.
    public static func name(forChartKey chartKey: String) -> String {
        prefix + chartKey
    }

    /// Decodes a raw query value into the hidden set — the port of `useUrlArray`'s
    /// `parse: raw === '' ? [] : raw.split(',')` followed by `new Set(arr)`. A `nil` (param absent) or
    /// empty value yields the empty set (web `omitDefault` / `parse('')`). Empty tokens are dropped so
    /// a malformed `a,,b` never seeds a phantom `""` series — canonical inputs round-trip unchanged.
    public static func decode(_ raw: String?) -> Set<String> {
        guard let raw, !raw.isEmpty else { return [] }
        return Set(raw.split(separator: delimiter, omittingEmptySubsequences: true).map(String.init))
    }

    /// Encodes a hidden set into the canonical query value — the port of `useUrlArray`'s
    /// `serialize: v.join(',')` over the sorted array `useHiddenSeries.toggle` writes. Returns `nil`
    /// when the set is empty so the caller drops the param entirely (web `omitDefault` / `reset`),
    /// keeping a "fresh chart" URL clean.
    public static func encode(_ hidden: Set<String>) -> String? {
        guard !hidden.isEmpty else { return nil }
        return canonical(hidden).joined(separator: String(delimiter))
    }

    /// The canonical (alphabetically sorted) ordering of a hidden set — the order
    /// `useHiddenSeries.toggle` writes so two equivalent views produce byte-identical URLs.
    public static func canonical(_ hidden: Set<String>) -> [String] {
        hidden.sorted()
    }
}

// MARK: - HiddenSeriesReducer (web HiddenSeriesState mutations, pure)

/// The pure set semantics behind the native `HiddenSeriesState` — the toggle / membership / clear
/// operations the web `useHiddenSeries` exposes, kept as pure functions over a caller-owned set so
/// they are unit tested without an `@Observable` store or a router. The toggle delegates to the shared
/// `TSChartFormat.toggleHidden` so every chart in the app shares one set-mutation definition (DRY);
/// the canonical ordering for persistence lives in ``HiddenSeriesParam/canonical(_:)``.
public enum HiddenSeriesReducer {
    /// Toggles a series `dataKey` in the hidden set — web `toggle(seriesKey)` (add when shown, remove
    /// when hidden). Delegates to the shared `TSChartFormat.toggleHidden` so the set algebra matches
    /// every other chart legend in the app.
    public static func toggle(_ hidden: Set<String>, _ seriesKey: String) -> Set<String> {
        TSChartFormat.toggleHidden(hidden, seriesKey)
    }

    /// Whether a given series `dataKey` is currently hidden — web `isHidden(seriesKey)`.
    public static func isHidden(_ hidden: Set<String>, _ seriesKey: String) -> Bool {
        hidden.contains(seriesKey)
    }

    /// The fully-cleared set — web `reset()` (which drops `?hidden_{chartKey}` from the URL).
    public static func cleared() -> Set<String> {
        []
    }
}
