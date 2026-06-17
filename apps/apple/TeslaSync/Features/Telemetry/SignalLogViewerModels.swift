import Foundation

// Value types + data-source seam for the Signal Log Viewer page — the native SwiftUI parity of
// `web/src/features/telemetry/pages/SignalLogViewerPage.tsx` (route `/signal-log`). The page queries
// signal history from Postgres: pick a vehicle, choose signals (web `useSignals` →
// `/signals/{vehicleId}/available`), set a date range, then "Query" fans out one
// `/signals/{vid}/{name}/history` request per signal, adapts each through the shared
// `SignalQueryHistoryAdapter`, flattens, and sorts newest-first; pagination is local slicing of the
// fetched batch (web `deferred-filter` note). The table row (`SignalLogEntry`), the BE→FE adapter,
// the pagination metadata, and the results-table render axis are reused verbatim from the shared
// `SignalQueryControls` surface so this page stays in lockstep with the unified `/signals` workspace.
//
// Every reading is SI canonical on the wire; the value cell renders verbatim through the shared
// `SignalQueryValueFormat` (the history endpoint already carries display-ready typed values), so no
// non-SI conversion happens here. Networking lives behind `SignalLogViewerDataSource` (ADR-004 — the
// view and model hold no networking); previews/tests inject doubles to drive the data states.

// MARK: - Data-source seam (web `useSignals` + the deferred history query)

/// Supplies the two reads the page performs. The production implementation binds the shared KMP
/// repositories / generated client (ADR-004); previews and tests inject doubles to drive the
/// loading / empty / error / success states. Method ↔ web map:
///   `loadAvailableSignals` ← `useSignals(vehicleId)` / `GET /signals/{vehicleId}/available`.
///   `loadHistory`          ← the web `queryFn`: `selectedSignals.map(GET /signals/{vid}/{name}
///                             /history?from&to&limit)` → `adaptSignalHistoryResp` → flatten → sort
///                             newest-first.
public protocol SignalLogViewerDataSource: Sendable {
    /// The catalog of queryable signals for the vehicle (web `useSignals`); `[]` when none exist.
    func loadAvailableSignals(vehicleID: Int64) async throws -> [SignalLogViewerSignal]

    /// The adapted, newest-first history rows for the selection / range (web `queryFn`). `perPage`
    /// drives the web per-signal `limit = perPage * 10`; the model slices locally for pagination.
    func loadHistory(
        vehicleID: Int64,
        signals: [String],
        from: Date,
        to: Date,
        perPage: Int
    ) async throws -> [SignalLogEntry]
}

// MARK: - Catalog signal (web `availableSignals` entry)

/// One queryable signal in the catalog (web `useSignals` list entry). Modeled as a value type rather
/// than a bare `String` so the selector can carry an optional human label / category alongside the
/// canonical signal name without changing the data-source contract.
public struct SignalLogViewerSignal: Identifiable, Hashable, Sendable {
    /// The canonical signal name the history endpoint is keyed by (web list value).
    public let name: String

    public var id: String { name }

    public init(name: String) {
        self.name = name
    }
}

// MARK: - Available-signals fetch phase (web `useSignals` status)

/// The lifecycle of the catalog fetch the selector binds to (web `useSignals` `isLoading` / data /
/// error). `.loaded` carries the resolved catalog (which may be empty); `.error` is a retryable
/// failure that also raises the page-level `error.loadFailed` banner.
public enum SignalLogAvailablePhase: Equatable, Sendable {
    case loading
    case loaded
    case error(String)
}
