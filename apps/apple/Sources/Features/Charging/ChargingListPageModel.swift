import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the three charging hooks)

/// Supplies every datum the page renders. The production implementation binds the shared
/// KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the
/// sibling feature `*DataSource` seams.
///
/// Method ↔ web hook map:
/// `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadSessions` ← `useChargingSessionsPaginated` → `GET /charging?vehicle_id&start&end&limit&offset`;
/// `loadOptimizer` ← `useChargingOptimizer` → `GET /analytics/charging-optimizer?vehicle_id`;
/// `bulkDelete` ← `useBulkDeleteCharging` → `DELETE /charging/bulk`.
public protocol ChargingListDataSource: Sendable {
    func loadVehicles() async throws -> [ChargingVehicle]
    func loadSessions(vehicleID: Int64, range: ChargingDateRange) async throws -> [ChargingSession]
    func loadOptimizer(vehicleID: Int64) async throws -> ChargingListOptimizer?
    func bulkDelete(ids: [Int64]) async throws
}

// MARK: - One date-grouped bucket (web `groupedSessions` / `DateGroupedList`)

/// A day bucket of the paginated list (web `DateGroupedListGroup`): the long date header,
/// its relative label, a per-day summary, and the day's sessions.
public struct ChargingDayGroup: Identifiable, Sendable {
    public let dateKey: String
    public let dateLabel: String
    public let relativeLabel: String
    public let summary: String
    public let sessions: [ChargingSession]

    public var id: String { dateKey }

    public init(
        dateKey: String,
        dateLabel: String,
        relativeLabel: String,
        summary: String,
        sessions: [ChargingSession]
    ) {
        self.dateKey = dateKey
        self.dateLabel = dateLabel
        self.relativeLabel = relativeLabel
        self.summary = summary
        self.sessions = sessions
    }
}

// MARK: - Conditional-section thresholds (web `THRESHOLD_*`)

/// The per-section session-count thresholds that gate the analytical sections (web
/// `THRESHOLD_OPTIMIZER` / `THRESHOLD_SPECS` / `THRESHOLD_BATTERY_DIST` / `THRESHOLD_AC_DC`).
public enum ChargingThreshold {
    public static let acDc = 1
    public static let batteryDist = 5
    public static let specs = 5
    public static let optimizer = 10
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the vehicle list + selection (web `VehicleSelect`), the date window (web
/// `RangePicker`), the search / collection / sort / density / page URL state, the bulk
/// selection (web `BulkActionsToolbar`), and the per-vehicle sessions + optimizer the
/// queries resolve to. Every panel / chart / row reads its data from the bound state —
/// the web `useMemo` pipeline reproduced as pure `ChargingAggregation` derivations.
@MainActor
@Observable
public final class ChargingListPageModel {
    public private(set) var phase: ChargingListPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [ChargingVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var range: ChargingDateRange
    public var search: String = "" { didSet { page = 0 } }
    public private(set) var collection: ChargingCollection = .all
    public private(set) var sortField: ChargingSortField = .date
    public private(set) var sortDescending = true
    public var trendMetric: ChargingTrendMetric = .sessions
    public var density: ChargingDensity = .comfortable
    public private(set) var page = 0
    public let pageSize = 50

    public private(set) var sessions: [ChargingSession] = []
    public private(set) var optimizer: ChargingListOptimizer?

    public private(set) var selectedIDs: Set<Int64> = []
    public private(set) var isDeleting = false

    /// Web `settings.currency_symbol` (default `'$'`) — the prefix `formatCurrency` applies.
    public let currencySymbol: String

    @ObservationIgnored private let dataSource: any ChargingListDataSource
    @ObservationIgnored private let referenceDate: Date

    public init(
        dataSource: any ChargingListDataSource = SampleChargingListDataSource(),
        currencySymbol: String = "$",
        referenceDate: Date = Date()
    ) {
        self.dataSource = dataSource
        self.currencySymbol = currencySymbol
        self.referenceDate = referenceDate
        self.range = Self.defaultRange(referenceDate: referenceDate)
    }

    /// Web default window — the 30 days ending today.
    static func defaultRange(referenceDate: Date) -> ChargingDateRange {
        let calendar = ChargingAggregation.dayCalendar
        let end = referenceDate
        let start = calendar.date(byAdding: .day, value: -30, to: end) ?? end
        return ChargingDateRange(start: ChargingAggregation.dayKey(start), end: ChargingAggregation.dayKey(end))
    }

    // MARK: Selection

    public var selectedVehicle: ChargingVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's sessions + optimizer (web
    /// `useVehicles` + the per-vehicle queries). The sessions query resolves the page phase.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadSessions()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its data.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        page = 0
        selectedIDs.removeAll()
        phase = .loading
        await loadSessions()
    }

    /// Changes the date window (web `RangePicker onChange`) and reloads (a fresh query).
    public func setRange(_ newRange: ChargingDateRange) async {
        guard newRange != range else { return }
        range = newRange
        page = 0
        phase = .loading
        await loadSessions()
    }

    private func loadSessions() async {
        guard let id = selectedVehicleID else {
            sessions = []
            optimizer = nil
            phase = .empty
            return
        }
        do {
            let loaded = try await dataSource.loadSessions(vehicleID: id, range: range)
            sessions = loaded
            optimizer = try? await dataSource.loadOptimizer(vehicleID: id)
            pruneSelection()
            phase = loaded.isEmpty ? .empty : .ready
        } catch {
            sessions = []
            optimizer = nil
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Filter / sort / page mutations (web URL-state setters)

    public func setCollection(_ value: ChargingCollection) {
        guard !value.isDisabled else { return }
        collection = value
        page = 0
    }

    public func setSort(field: ChargingSortField) {
        sortField = field
    }

    public func setSortDescending(_ descending: Bool) {
        sortDescending = descending
    }

    public func goToPage(_ index: Int) {
        page = max(0, min(index, max(0, pageCount - 1)))
    }

    /// Web anomaly callout action — jump to the Anomalies collection.
    public func showAnomalies() {
        collection = .anomalies
        page = 0
    }

    /// Web `Reset filters` empty-state CTA.
    public func resetFilters() {
        search = ""
        collection = .all
        sortField = .date
        sortDescending = true
        range = Self.defaultRange(referenceDate: referenceDate)
        page = 0
    }

    // MARK: Bulk selection (web `BulkActionsToolbar`)

    public func isSelected(_ id: Int64) -> Bool {
        selectedIDs.contains(id)
    }

    public func toggleSelected(_ id: Int64, _ on: Bool) {
        if on { selectedIDs.insert(id) } else { selectedIDs.remove(id) }
    }

    public func clearSelection() {
        selectedIDs.removeAll()
    }

    /// Web `bulkDeleteMut.mutateAsync(ids)` then `clearBulk()` — deletes the selected
    /// sessions, drops them locally, and clears the selection.
    public func deleteSelected() async {
        let ids = Array(selectedIDs)
        guard !ids.isEmpty else { return }
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await dataSource.bulkDelete(ids: ids)
            let removed = Set(ids)
            sessions.removeAll { removed.contains($0.id) }
            selectedIDs.removeAll()
            if sessions.isEmpty { phase = .empty }
            page = min(page, max(0, pageCount - 1))
        } catch {
            // Web surfaces the mutation error via the toolbar; the selection is preserved
            // so the user can retry. The list is unchanged.
        }
    }

    /// Drops any selected IDs no longer present after a reload (web selection-prune effect).
    private func pruneSelection() {
        let present = Set(sessions.map(\.id))
        selectedIDs = selectedIDs.intersection(present)
    }
}
