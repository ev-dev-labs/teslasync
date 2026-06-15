import Foundation
import Observation

/// The `@Observable` state holder the Redis Signal Viewer page binds to (ADR-004 — no
/// networking in the view). Owns the two query states the web page drives (web `useVehicles`
/// for the picker and the `['redis-signals', vehicleId]` query for the table), the operator
/// selections (web `selectedVehicleId` / `search` / `categoryFilter` / `autoRefresh`
/// `useState`), and the destructive two-path purge flow (web `purgeMode` / `purgeTargetId` /
/// `isPurging` + the outcome toasts). Reads both feeds through the injected seams; mirrors the
/// sibling self-contained admin page models (`LiveSignalInspectorPageModel`,
/// `DiskForecastPageModel`).
@MainActor
@Observable
public final class RedisSignalViewerPageModel {
    // MARK: Query states (web `useVehicles` + `['redis-signals', id]`)

    public private(set) var vehiclesState: RedisVehiclesState = .loading
    public private(set) var signalsState: RedisSignalsState = .idle

    // MARK: Operator selections (web `useState`)

    /// The selected vehicle id, or `nil` for the "select a vehicle" prompt (web
    /// `selectedVehicleId`, initialised to `null`).
    public private(set) var selectedVehicleID: Int64?
    public var search: String = ""
    public private(set) var categoryFilter: RedisCategoryFilter = .all
    public private(set) var autoRefresh: Bool = false

    // MARK: Purge UI state (web purge block)

    /// The active destructive path, or `nil` when no dialog is open (web `purgeMode`).
    public private(set) var purgeMode: RedisPurgeMode?
    /// The per-vehicle purge target pinned at dialog-open time so a mid-confirmation
    /// vehicle-picker change can't retarget the destructive call (web `purgeTargetId`).
    public private(set) var purgeTargetID: Int64?
    public private(set) var purgeTargetLabel: String = ""
    /// Keeps the dialog open with disabled buttons + spinner while the DELETE is in flight
    /// (web `isPurging`).
    public private(set) var isPurging: Bool = false
    /// The typed cluster-wide confirmation (web `requireTypedConfirmation='PURGE ALL'`).
    public var purgeAllConfirmation: String = ""
    /// The dismissible result banner (web `toast.*`).
    public private(set) var outcome: RedisPurgeOutcome?

    /// The literal an operator must type to arm the cluster-wide purge (web `'PURGE ALL'`).
    public static let purgeAllPhrase = "PURGE ALL"

    @ObservationIgnored private let vehicleSource: any RedisSignalViewerVehicleSource
    @ObservationIgnored private let store: any RedisSignalStore
    /// Generation token so a stale in-flight signals load (selection changed mid-fetch)
    /// never overwrites a newer one (the native analogue of re-keying the web query).
    @ObservationIgnored private var loadGeneration = 0

    public enum RedisPurgeMode: Equatable, Sendable {
        case one
        case all
    }

    public init(
        vehicleSource: any RedisSignalViewerVehicleSource = SampleRedisSignalViewerVehicleSource(),
        store: any RedisSignalStore = SampleRedisSignalStore()
    ) {
        self.vehicleSource = vehicleSource
        self.store = store
    }

    // MARK: - Derived: vehicles

    /// The loaded vehicles (empty unless the list is `.loaded`).
    public var vehicles: [RedisSignalVehicle] {
        if case let .loaded(list) = vehiclesState { return list }
        return []
    }

    /// Whether a vehicle is selected (web `selectedVehicleId !== null`).
    public var hasSelection: Bool {
        selectedVehicleID != nil
    }

    /// The currently selected vehicle, if any.
    public var selectedVehicle: RedisSignalVehicle? {
        guard let selectedVehicleID else { return nil }
        return vehicles.first { $0.id == selectedVehicleID }
    }

    /// Web `selectedVehicle?.display_name || selectedVehicle?.vin || `Vehicle ${id}``.
    public var selectedVehicleLabel: String {
        if let selectedVehicle { return selectedVehicle.label }
        if let selectedVehicleID { return "Vehicle \(selectedVehicleID)" }
        return ""
    }

    // MARK: - Derived: signals

    /// The current snapshot's rows, pre-sorted by name (empty unless `.loaded`).
    public var rows: [RedisSignalRow] {
        if case let .loaded(snapshot) = signalsState { return snapshot.rows }
        return []
    }

    /// The current diagnostic meta from whichever signals phase carries it.
    public var meta: RedisSignalsMeta? {
        switch signalsState {
        case let .loaded(snapshot): snapshot.meta
        case let .empty(meta): meta
        case let .error(_, meta): meta
        case .idle, .loading: nil
        }
    }

    /// Web `signalData?.signal_count ?? 0`.
    public var totalSignals: Int {
        if case let .loaded(snapshot) = signalsState { return snapshot.signalCount }
        return 0
    }

    public var isLoading: Bool {
        signalsState == .loading
    }

    public var isError: Bool {
        if case .error = signalsState { return true }
        return false
    }

    /// The stat cards render a dash while loading or on error (web `isLoading || isError`).
    public var showsStatDash: Bool {
        isLoading || isError
    }

    /// Web `rows.filter(r => r.type === 'number').length`.
    public var numbersCount: Int {
        rows.count(where: { $0.value.typeLabel == "number" })
    }

    public var stringsCount: Int {
        rows.count(where: { $0.value.typeLabel == "string" })
    }

    public var booleansCount: Int {
        rows.count(where: { $0.value.typeLabel == "boolean" })
    }

    /// Web `categoryCounts` — per-category tally over the unfiltered rows.
    public func count(for category: RedisSignalCategory) -> Int {
        rows.count(where: { $0.category == category })
    }

    /// Web `filteredRows` — name search (case-insensitive substring) then category filter.
    public var filteredRows: [RedisSignalRow] {
        var result = rows
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty {
            result = result.filter { $0.name.lowercased().contains(query) }
        }
        if let category = categoryFilter.category {
            result = result.filter { $0.category == category }
        }
        return result
    }

    /// The table panel's render phase (web select-prompt / skeleton / diagnostic / no-match
    /// / table ladder).
    public var tablePhase: RedisTablePhase {
        guard hasSelection else { return .selectPrompt }
        switch signalsState {
        case .idle, .loading:
            return .loading
        case let .empty(meta):
            return .diagnostic(meta: meta, errorMessage: nil)
        case let .error(message, meta):
            return .diagnostic(meta: meta, errorMessage: message)
        case .loaded:
            let filtered = filteredRows
            if filtered.isEmpty {
                if rows.isEmpty {
                    return .diagnostic(meta: meta, errorMessage: nil)
                }
                return .noMatch
            }
            return .table(filtered)
        }
    }

    /// Whether the persistent meta chips show (web `selectedVehicleId !== null && meta`).
    public var showsMetaChips: Bool {
        hasSelection && meta != nil
    }

    /// Whether the stat grid shows (web `selectedVehicleId !== null`).
    public var showsStats: Bool {
        hasSelection
    }

    /// Whether the Refresh button is enabled (web `disabled={selectedVehicleId === null ||
    /// isFetching}`).
    public var canRefresh: Bool {
        hasSelection && !isLoading
    }

    // MARK: - Loading (web `useVehicles` + `['redis-signals', id]` queries)

    /// Loads the vehicle list and resolves its terminal state (web `useVehicles`).
    public func load() async {
        vehiclesState = .loading
        do {
            let list = try await vehicleSource.loadVehicles()
            vehiclesState = list.isEmpty ? .empty : .loaded(list)
        } catch {
            vehiclesState = .error(error.localizedDescription)
        }
    }

    /// Re-runs the vehicle-list load (web error-retry / refetch).
    public func refresh() async {
        await load()
    }

    /// Selects a vehicle (or clears with `nil`) — web `setSelectedVehicleId`. Setting the
    /// loading state synchronously and letting the view drive `loadSignals()` through a
    /// `.task(id: selectedVehicleID)` mirrors re-keying the `['redis-signals', id]` query;
    /// clearing returns to the select prompt.
    public func selectVehicle(_ id: Int64?) {
        guard id != selectedVehicleID else { return }
        selectedVehicleID = id
        loadGeneration += 1
        signalsState = id == nil ? .idle : .loading
    }

    /// Loads the selected vehicle's cached signals (web `getRedisSignals(vehicleId)`),
    /// guarding against a stale apply when the selection changed mid-fetch.
    public func loadSignals() async {
        guard let vehicleID = selectedVehicleID else {
            signalsState = .idle
            return
        }
        loadGeneration += 1
        let generation = loadGeneration
        signalsState = .loading
        do {
            let snapshot = try await store.loadSignals(vehicleID: vehicleID)
            guard generation == loadGeneration, selectedVehicleID == vehicleID else { return }
            if snapshot.rows.isEmpty {
                signalsState = .empty(snapshot.meta)
            } else {
                signalsState = .loaded(snapshot)
            }
        } catch {
            guard generation == loadGeneration, selectedVehicleID == vehicleID else { return }
            signalsState = .error(message: error.localizedDescription, meta: nil)
        }
    }

    /// Re-runs the signals load (web Refresh button / `refetch`).
    public func refreshSignals() async {
        guard hasSelection else { return }
        await loadSignals()
    }

    // MARK: - Filters (web setters)

    public func setCategoryFilter(_ filter: RedisCategoryFilter) {
        categoryFilter = filter
    }

    public func setAutoRefresh(_ enabled: Bool) {
        autoRefresh = enabled
    }

    // MARK: - Purge flow (web purge block)

    /// Opens the per-vehicle confirm, pinning the target so a later picker change can't
    /// retarget it (web `openPurgeOne`).
    public func openPurgeOne() {
        guard let selectedVehicleID else { return }
        purgeTargetID = selectedVehicleID
        purgeTargetLabel = selectedVehicleLabel
        purgeMode = .one
    }

    /// Opens the cluster-wide confirm (web `openPurgeAll`).
    public func openPurgeAll() {
        purgeTargetID = nil
        purgeTargetLabel = ""
        purgeAllConfirmation = ""
        purgeMode = .all
    }

    /// Whether the confirm button is armed. The cluster-wide path additionally requires the
    /// operator to type the exact phrase (web `requireTypedConfirmation`).
    public var canConfirmPurge: Bool {
        switch purgeMode {
        case .none: false
        case .one: !isPurging
        case .all: !isPurging && purgeAllConfirmation == Self.purgeAllPhrase
        }
    }

    /// Cancels the open confirm unless a purge is in flight (web `onCancel`).
    public func cancelPurge() {
        guard !isPurging else { return }
        purgeMode = nil
        purgeTargetID = nil
        purgeTargetLabel = ""
        purgeAllConfirmation = ""
    }

    public func dismissOutcome() {
        outcome = nil
    }

    /// Runs the confirmed purge and resolves the outcome banner (web `handlePurgeConfirm`).
    public func confirmPurge() async {
        guard let mode = purgeMode, canConfirmPurge else { return }
        isPurging = true
        defer { isPurging = false }
        do {
            switch mode {
            case .one:
                guard let targetID = purgeTargetID else { return }
                let label = purgeTargetLabel
                let result = try await store.purge(vehicleID: targetID)
                outcome = result.purged ? .purgeSucceeded(vehicle: label) : .purgeNoOp(vehicle: label)
                if selectedVehicleID == targetID {
                    await loadSignals()
                }
            case .all:
                let result = try await store.purgeAll()
                outcome = result.hasMore
                    ? .purgeAllPartial(count: result.purged, limit: result.limit)
                    : .purgeAllSucceeded(count: result.purged)
                await loadSignals()
            }
            purgeMode = nil
            purgeTargetID = nil
            purgeTargetLabel = ""
            purgeAllConfirmation = ""
        } catch {
            outcome = .failed(message: error.localizedDescription)
        }
    }
}

/// The table panel's render phase (web select-prompt / skeleton / diagnostic / no-match /
/// table ladder). Kept UI-free so the model stays testable.
public enum RedisTablePhase: Equatable, Sendable {
    case selectPrompt
    case loading
    case diagnostic(meta: RedisSignalsMeta?, errorMessage: String?)
    case noMatch
    case table([RedisSignalRow])
}
