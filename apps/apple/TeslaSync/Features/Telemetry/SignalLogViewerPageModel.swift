import Foundation
import Observation

// MARK: - Page model (web `useSignals` + the deferred history query)

/// The `@Observable` state holder the Signal Log Viewer page binds to (ADR-004 — no networking in
/// the view). Mirrors `web/src/features/telemetry/pages/SignalLogViewerPage.tsx`:
///   • the vehicle scope (web `useSelectedVehicle`) — `0` renders the no-vehicle empty state;
///   • the signal catalog (web `useSignals` → `/signals/{vehicleId}/available`) the selector lists;
///   • the selected signals (web `useUrlArray('signals')`) and the day-granular range (web
///     `useRangeState`, default preset `today`);
///   • the page size + page (web `perPage` / `page`, default 50 / 1) — local pagination only;
///   • the deferred query: nothing fetches until `runQuery()` (web "Query" click), which fans the
///     history fetch out per signal, then slices the batch locally per page.
///
/// Main-actor-isolated: SwiftUI views are main-actor bound, so a main-actor model keeps mutation on
/// one actor and stays Swift-6 complete-concurrency clean. The history rows, the BE→FE adapter, the
/// pagination metadata, and the results-table render axis are the shared `SignalQueryControls` types.
@MainActor
@Observable
public final class SignalLogViewerPageModel {
    /// The active vehicle scope (web `useSelectedVehicle().vehicleId`); `0` = none selected.
    public let vehicleID: Int64

    // ── Catalog (web `useSignals`) ────────────────────────────────────
    public private(set) var availablePhase: SignalLogAvailablePhase = .loading
    public private(set) var availableSignals: [SignalLogViewerSignal] = []

    // ── Selection + range (web `useUrlArray` + `useRangeState`) ────────
    public private(set) var selectedSignals: [String] = []
    public var rangeStart: Date
    public var rangeEnd: Date

    // ── Page size + page (web `perPage` / `page`) ─────────────────────
    public private(set) var perPage: Int
    public private(set) var page: Int = 1
    public let perPageOptions: [Int] = [25, 50, 100, 500]

    // ── Deferred query (web `queryKey` / `useQuery`) ──────────────────
    public private(set) var hasQueried = false
    public private(set) var isFetching = false
    public private(set) var allRows: [SignalLogEntry] = []
    public private(set) var tableState: SignalQueryTableState = .empty
    /// The page-level failure surfaced as the `error.loadFailed` banner (web `anyError`).
    public private(set) var bannerError: String?

    @ObservationIgnored private let dataSource: any SignalLogViewerDataSource

    public init(
        vehicleID: Int64 = 1,
        perPage: Int = 50,
        anchor: Date = Date(),
        dataSource: any SignalLogViewerDataSource = SampleSignalLogViewerDataSource()
    ) {
        self.vehicleID = vehicleID
        self.perPage = perPage
        self.dataSource = dataSource
        let calendar = Calendar.current
        rangeStart = calendar.startOfDay(for: anchor)
        rangeEnd = anchor
    }

    // MARK: Derived (web memos)

    /// Web `vehicleId > 0` — gates the whole workspace behind a selected vehicle.
    public var hasVehicle: Bool { vehicleID > 0 }

    /// The catalog signal names the selector lists (web `availableSignals ?? []`).
    public var availableNames: [String] { availableSignals.map(\.name) }

    /// The catalog phase mapped onto the shared selector's lifecycle axis (web `useQuery` status), so
    /// the reused `SignalMultiSelectView` renders the loading / error / loaded leaf states.
    public var availableSelectState: SignalQueryAvailableState {
        switch availablePhase {
        case .loading: .loading
        case .loaded: .loaded
        case let .error(message): .error(message)
        }
    }

    /// Web `canQuery = selectedSignals.length > 0 && start && end && vehicleId > 0` (both dates are
    /// always present in the native pickers, so this reduces to selection + vehicle).
    public var canQuery: Bool { !selectedSignals.isEmpty && hasVehicle }

    /// Web `totalRecords = allRows.length`.
    public var totalRecords: Int { allRows.count }

    /// Total pages over the fetched batch at the current page size (≥ 1).
    public var totalPages: Int {
        guard perPage > 0 else { return 1 }
        return max(1, Int(ceil(Double(allRows.count) / Double(perPage))))
    }

    /// Server-style pagination metadata the shared results table consumes.
    public var pagination: SignalHistoryPagination {
        SignalHistoryPagination(page: page, perPage: perPage, total: totalRecords, totalPages: totalPages)
    }

    /// Web `rows = allRows.slice((page-1)*perPage, +perPage)` — the visible page slice.
    public var pagedRows: [SignalLogEntry] {
        let startIndex = max(0, (page - 1) * perPage)
        guard startIndex < allRows.count else { return [] }
        let endIndex = min(startIndex + perPage, allRows.count)
        return Array(allRows[startIndex ..< endIndex])
    }

    /// The unselected catalog names the "Add signal" menu offers (web `SignalSelector` candidates).
    public func addableSignals() -> [String] {
        SignalAvailableFilter.filter(available: availableNames, selected: selectedSignals, search: "")
    }

    public func isSelected(_ name: String) -> Bool { selectedSignals.contains(name) }

    // MARK: Lifecycle

    /// Initial load: fetch the signal catalog for the scoped vehicle (web `useSignals`).
    public func load() async {
        await reloadCatalog()
    }

    /// Re-fetches the catalog (vehicle change / retry); resets the prior query so rows never mix
    /// across vehicles (web `useSignals` re-keys on `vehicleId`).
    public func reloadCatalog() async {
        guard hasVehicle else {
            availableSignals = []
            availablePhase = .loaded
            return
        }
        availablePhase = .loading
        do {
            availableSignals = try await dataSource.loadAvailableSignals(vehicleID: vehicleID)
            availablePhase = .loaded
            bannerError = nil
        } catch {
            availableSignals = []
            availablePhase = .error(error.localizedDescription)
            bannerError = error.localizedDescription
        }
    }

    // MARK: Selection + controls (web component handlers)

    /// Web `SignalSelector.onChange` (add): append a new signal.
    public func addSignal(_ name: String) {
        guard !selectedSignals.contains(name) else { return }
        selectedSignals.append(name)
    }

    /// Web `SignalSelector.onChange` (remove): drop a signal from the selection.
    public func removeSignal(_ name: String) {
        selectedSignals.removeAll { $0 == name }
    }

    /// Web Per-Page `onChange`: change the size and reset to the first page.
    public func setPerPage(_ value: Int) {
        perPage = value
        page = 1
    }

    // MARK: Deferred query (web `handleQuery` + `useQuery`)

    /// Web "Query" click: reset to page 1, mark the query run, fetch the history batch, then resolve
    /// the table into rows / empty / error. A guarded no-op when the query is not yet valid.
    public func runQuery() async {
        guard canQuery else { return }
        page = 1
        hasQueried = true
        isFetching = true
        tableState = .loading
        bannerError = nil
        do {
            allRows = try await dataSource.loadHistory(
                vehicleID: vehicleID,
                signals: selectedSignals,
                from: queryFrom,
                to: queryTo,
                perPage: perPage
            )
            tableState = allRows.isEmpty ? .empty : .rows
        } catch {
            allRows = []
            tableState = .error(error.localizedDescription)
            bannerError = error.localizedDescription
        }
        isFetching = false
    }

    /// Web `SignalDataTable.onPageChange`: clamp + slice locally (no refetch).
    public func goToPage(_ requested: Int) {
        page = SignalPaging.clamp(page: requested, totalPages: totalPages)
    }

    /// The table-error retry (re-runs the last query) and the selector-error retry (re-fetch catalog).
    public func retryQuery() async { await runQuery() }
    public func retryCatalog() async { await reloadCatalog() }

    // MARK: Query window (web `${start}T00:00:00` … `${end}T23:59:59.999`)

    /// Day-floored range start (web `new Date(`${start}T00:00:00`)`).
    private var queryFrom: Date { Calendar.current.startOfDay(for: rangeStart) }

    /// End-of-day range end (web `new Date(`${end}T23:59:59.999`)`).
    private var queryTo: Date {
        Calendar.current.startOfDay(for: rangeEnd).addingTimeInterval(86_400 - 0.001)
    }
}
