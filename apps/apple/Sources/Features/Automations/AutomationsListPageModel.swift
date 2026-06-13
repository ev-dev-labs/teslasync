import Foundation
import Observation

// The `@Observable` state holder for the `AutomationsListPage` parity surface (web
// `AutomationsListPage.tsx`). Owns the automation list (driving the page phase), the vehicle
// lookup, the pin order, the live activity feed, and the status/search filters; derives the
// header stats, the filtered + pin-sorted card list, and the cards-region state. All data
// flows through the injected `AutomationsListDataSource` — no networking in the view (ADR-004).

// MARK: - Live feed bundle (web `useAutomationHistory` + `useAutomationEvents`)

/// One coalesced snapshot of the activity feed inputs — the execution history + aggregate
/// stats (web `useAutomationHistory`) merged with the live SSE rows, connection state, and the
/// currently-firing automation ids (web `useAutomationEvents`). Bundled so a single
/// `useAutomationHistory` call site feeds both the embedded feed and the per-card firing ring.
public struct AutomationLiveFeed: Sendable, Equatable {
    public var snapshot: AutomationActivityFeedSnapshot
    public var firingIDs: Set<Int64>

    public init(
        snapshot: AutomationActivityFeedSnapshot = AutomationActivityFeedSnapshot(),
        firingIDs: Set<Int64> = []
    ) {
        self.snapshot = snapshot
        self.firingIDs = firingIDs
    }
}

// MARK: - Data source seam (web hooks, names kept at the Swift call sites)

/// Supplies every datum the page renders and performs the row mutations. The production
/// implementation binds the shared KMP repositories / use-cases (ADR-004); previews + tests
/// inject doubles to drive the loading / empty / success / error states. The method names mirror
/// the ported web hooks verbatim so the parity mapping is visible at the call sites.
public protocol AutomationsListDataSource: Sendable {
    /// web `useAutomations` → `GET /automations`
    func useAutomations() async throws -> [AutomationListItem]
    /// web `useVehicles` → `GET /vehicles`
    func useVehicles() async throws -> [AutomationVehicleRef]
    /// web `usePinned('automation')` → `GET /pinned?type=automation`
    func usePinned(_ type: String) async throws -> [AutomationPin]
    /// web `useAutomationHistory(limit)` (+ `useAutomationEvents`) → `GET /automations/history`
    func useAutomationHistory(limit: Int) async throws -> AutomationLiveFeed?
    /// web `useToggleAutomation` → `PATCH /automations/{id}/toggle`
    func useToggleAutomation(id: Int64, enabled: Bool) async throws
    /// web `useReEnableAutomation` → `PATCH /automations/{id}/re-enable`
    func useReEnableAutomation(id: Int64) async throws
    /// web `useDeleteAutomation` → `DELETE /automations/{id}`
    func useDeleteAutomation(id: Int64) async throws
    /// web `useTestRunAutomation` → `POST /automations/{id}/test-run`
    func useTestRunAutomation(id: Int64) async throws
    /// web inline `POST /automations/import`
    func importAutomations(_ envelope: AutomationImportEnvelope) async throws
}

// MARK: - Page phase (web `PageContainer loading` + content / error)

/// The page's terminal phase, driven by the primary `useAutomations` source. `.error` is a
/// retryable failure (never a blank region, ADR-013); `.ready` renders the full body whose
/// cards region resolves its own success / empty / no-match state.
public enum AutomationsListPhase: Sendable, Equatable {
    case loading
    case ready
    case error(String)
}

// MARK: - Cards region state (web `filteredItems.length` / `items.length`)

/// The cards-region render state (web ternary `filteredItems.length ? cards : items.length === 0
/// ? <EmptyState create/> : <EmptyState reset/>`).
public enum AutomationsCardsState: Sendable, Equatable {
    case success
    case empty
    case noMatch
}

// MARK: - Page model

@MainActor
@Observable
public final class AutomationsListPageModel {
    /// Web `useAutomationHistory(20)`.
    public static let historyLimit = 20

    public private(set) var phase: AutomationsListPhase = .loading
    public private(set) var items: [AutomationListItem] = []
    public private(set) var vehicles: [AutomationVehicleRef] = []
    public private(set) var pins: [AutomationPin] = []

    /// The embedded activity feed inputs (web `<AutomationActivityFeed/>` props).
    public private(set) var activity = AutomationActivityFeedSnapshot(isLoading: true)
    public private(set) var firingIDs: Set<Int64> = []

    /// Web `statusFilter` / `search` local state. Mutated through `setStatusFilter` / `setSearch`
    /// so the bindings stay funneled through the model (and observable).
    public private(set) var statusFilter: AutomationStatusFilter = .all
    public private(set) var search = ""

    /// The last failed typed-import outcome (web `window.alert` on the import `catch`). Surfaced
    /// as an alert and cleared on dismissal.
    public private(set) var importError: AutomationImportError?

    @ObservationIgnored private let dataSource: any AutomationsListDataSource

    public init(dataSource: any AutomationsListDataSource = SampleAutomationsListDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Loading

    /// Loads the automation list (driving the phase), then the vehicle lookup, pin order, and
    /// the live activity feed (web's parallel queries).
    public func load() async {
        phase = .loading
        activity = AutomationActivityFeedSnapshot(isLoading: true)
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
    public func refresh() async {
        await fetchAll()
    }

    private func fetchAll() async {
        do {
            items = try await dataSource.useAutomations()
            phase = .ready
        } catch {
            phase = .error(error.localizedDescription)
        }
        // Secondary sources degrade to empty on failure (web TanStack → undefined → safe default).
        vehicles = await (try? dataSource.useVehicles()) ?? []
        pins = await (try? dataSource.usePinned("automation")) ?? []
        let feed = await (try? dataSource.useAutomationHistory(limit: Self.historyLimit)) ?? nil
        apply(feed ?? AutomationLiveFeed(snapshot: AutomationActivityFeedSnapshot()))
    }

    private func apply(_ feed: AutomationLiveFeed) {
        activity = feed.snapshot
        firingIDs = feed.firingIDs
    }

    /// Re-fetches just the automation list (used to resync after a failed optimistic mutation).
    private func reloadItems() async {
        if let fresh = try? await dataSource.useAutomations() {
            items = fresh
        }
    }

    // MARK: Filters (web `setStatusFilter` / `setSearch` / reset)

    public func setStatusFilter(_ filter: AutomationStatusFilter) {
        statusFilter = filter
    }

    public func setSearch(_ text: String) {
        search = text
    }

    /// Web `EmptyState` reset action (`setSearch(''); setStatusFilter('all')`).
    public func resetFilters() {
        search = ""
        statusFilter = .all
    }

    // MARK: Derived — stats / lookup / list

    /// Web `computeStats(items)`.
    public var stats: AutomationListStats {
        AutomationListStats.compute(items)
    }

    /// Web `buildVehicleLookup(vehicles)` — last writer wins on duplicate ids (never crashes).
    public var vehicleLookup: [Int64: String] {
        var map: [Int64: String] = [:]
        for vehicle in vehicles {
            map[vehicle.id] = vehicle.displayName
        }
        return map
    }

    /// Web `a.vehicle_id != null ? vehicleLookup.get(a.vehicle_id) : undefined`.
    public func vehicleName(for item: AutomationListItem) -> String? {
        guard let vehicleID = item.vehicleID else { return nil }
        return vehicleLookup[vehicleID]
    }

    /// Web `firingNow.has(a.id)`.
    public func isFiring(_ item: AutomationListItem) -> Bool {
        firingIDs.contains(item.id)
    }

    /// Web `filteredItems` useMemo — status filter then case-insensitive name/description search.
    public var filteredItems: [AutomationListItem] {
        var result = items
        if statusFilter != .all {
            result = result.filter { matchesStatus($0) }
        }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !query.isEmpty {
            result = result.filter { item in
                item.name.lowercased().contains(query)
                    || (item.description ?? "").lowercased().contains(query)
            }
        }
        return result
    }

    private func matchesStatus(_ item: AutomationListItem) -> Bool {
        switch statusFilter {
        case .all: true
        case .active: item.status == .active
        case .disabled: item.status == .disabled
        case .autoDisabled: item.status == .autoDisabled
        }
    }

    /// Web `sortedItems` useMemo — pinned automations first (by stored position), the rest in
    /// their existing relative order.
    public var sortedItems: [AutomationListItem] {
        let filtered = filteredItems
        guard !pins.isEmpty else { return filtered }
        var order: [String: Int] = [:]
        for pin in pins where order[pin.itemID] == nil {
            order[pin.itemID] = pin.position
        }
        return filtered.enumerated().sorted { lhs, rhs in
            let lp = order[String(lhs.element.id)] ?? Int.max
            let rp = order[String(rhs.element.id)] ?? Int.max
            if lp != rp { return lp < rp }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    /// Web cards-region branch.
    public var cardsState: AutomationsCardsState {
        if !filteredItems.isEmpty { return .success }
        return items.isEmpty ? .empty : .noMatch
    }

    /// Web filter-count badge (`{filteredItems.length} / {items.length}`), shown only when a
    /// filter or search is active.
    public var showsFilterCount: Bool {
        statusFilter != .all || !search.isEmpty
    }

    public var filterCountText: String {
        "\(filteredItems.count) / \(items.count)"
    }

    // MARK: Derived — activity feed (web `<AutomationActivityFeed/>`)

    /// Web feed list branch (`isLoading ? skeletons : history.length ? rows : empty`).
    public var activityState: AutomationActivityFeedState {
        if activity.isLoading { return .loading }
        return activity.runs.isEmpty ? .empty : .success
    }

    public var activityRuns: [AutomationActivityRun] {
        activity.runs
    }

    public var activityLiveEvents: [AutomationActivityLiveEvent] {
        Array(activity.liveEvents.prefix(AutomationActivityFeedPageModel.liveEventLimit))
    }

    public var activityConnection: AutomationActivityConnection {
        activity.connection
    }

    /// Web header stats gate (`historyStats && total_executions > 0`).
    public var activityStats: AutomationActivityStats? {
        guard let stats = activity.stats, stats.totalRuns > 0 else { return nil }
        return stats
    }

    // MARK: Mutations (web card menu / toggle handlers)

    /// Web `AutomationCard.handleToggle` — turning an auto-disabled automation on re-enables it;
    /// otherwise it is an ordinary enable/disable.
    public func toggle(_ item: AutomationListItem, to newValue: Bool) async {
        if item.autoDisabled, newValue {
            await reEnable(item)
        } else {
            await setEnabled(item, to: newValue)
        }
    }

    private func setEnabled(_ item: AutomationListItem, to newValue: Bool) async {
        replaceItem(id: item.id) { $0.updating(enabled: newValue) }
        do {
            try await dataSource.useToggleAutomation(id: item.id, enabled: newValue)
        } catch {
            await reloadItems()
        }
    }

    /// Web `useReEnableAutomation` — clears the auto-disabled outcome + reason.
    public func reEnable(_ item: AutomationListItem) async {
        replaceItem(id: item.id) {
            $0.updating(enabled: true, autoDisabled: false, clearAutoDisabledReason: true)
        }
        do {
            try await dataSource.useReEnableAutomation(id: item.id)
        } catch {
            await reloadItems()
        }
    }

    /// Web `useDeleteAutomation`.
    public func delete(_ item: AutomationListItem) async {
        let previous = items
        items.removeAll { $0.id == item.id }
        do {
            try await dataSource.useDeleteAutomation(id: item.id)
        } catch {
            items = previous
        }
    }

    /// Web `useTestRunAutomation` (fire-and-forget; no local state change).
    public func testRun(_ item: AutomationListItem) async {
        try? await dataSource.useTestRunAutomation(id: item.id)
    }

    private func replaceItem(id: Int64, _ transform: (AutomationListItem) -> AutomationListItem) {
        items = items.map { $0.id == id ? transform($0) : $0 }
    }

    // MARK: Pinning (web `PinButton` reorder — local pin order over the read-only `usePinned`)

    /// Whether the automation is currently pinned (web pin badge state).
    public func isPinned(_ item: AutomationListItem) -> Bool {
        let key = String(item.id)
        return pins.contains { $0.itemID == key }
    }

    /// Toggles the automation's pin, reordering `sortedItems` pinned-first (web `PinButton`).
    public func togglePin(_ item: AutomationListItem) {
        let key = String(item.id)
        if let index = pins.firstIndex(where: { $0.itemID == key }) {
            pins.remove(at: index)
        } else {
            let frontPosition = (pins.map(\.position).min() ?? 0) - 1
            pins.insert(AutomationPin(itemID: key, position: frontPosition), at: 0)
        }
    }

    // MARK: Import (web file `<input>` + `POST /automations/import`)

    /// Web import flow: parse + validate the typed envelope, POST it, then reload. A parse or
    /// POST failure records the localized reason for the surfaced alert (web `window.alert`).
    public func importAutomations(from data: Data) async {
        importError = nil
        do {
            let envelope = try AutomationImportEnvelope.parse(data)
            try await dataSource.importAutomations(envelope)
            await load()
        } catch let error as AutomationImportError {
            importError = error
        } catch {
            importError = .unreadable
        }
    }

    public func clearImportError() {
        importError = nil
    }

    /// Web alert body — `automations.importFailedWithReason` wrapping the specific reason
    /// (`automations.importTypedEnvelopeRequired` / `automations.importUnknownError`).
    public var importAlertMessage: String {
        let key = importError?.messageKey ?? AutomationImportError.unreadable.messageKey
        let reason = String(localized: String.LocalizationValue(key))
        let template = String(localized: "automations.importFailedWithReason")
        return String(format: template, reason)
    }
}
