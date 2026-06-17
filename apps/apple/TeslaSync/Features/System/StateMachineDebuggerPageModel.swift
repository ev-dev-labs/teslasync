//
//  StateMachineDebuggerPageModel.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — View Model
//
//  Native SwiftUI parity of `web/src/features/system/pages/StateMachineDebuggerPage.tsx`
//  (route `/state-debugger`). This file owns the `@Observable` state holder, the FSM-type /
//  range / pagination controls, the injectable data-source seam (the four web hooks ported by
//  name), and the page-state enum — the view holds no networking (ADR-004). Derived analytics
//  (distribution, counts, flap ids) are computed by the pure `StateMachineDerive` helpers so the
//  store stays lean. All copy resolves from `Localizable.xcstrings`.
//

import Observation
import SwiftUI

// MARK: - FSM type filter (web `FSM_TYPE_OPTIONS` — all / vehicle / telemetry_connection)

/// The FSM family the transition log is filtered by (web `fsmType`). The raw value is the wire
/// `fsm_name` query param; `all` sends an empty filter.
public enum FSMTypeFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case vehicle
    case telemetryConnection = "telemetry_connection"

    public var id: String { rawValue }

    var titleKey: LocalizedStringKey {
        switch self {
        case .all: "fsm.typeAll"
        case .vehicle: "fsm.typeVehicle"
        case .telemetryConnection: "fsm.typeTelemetry"
        }
    }

    /// Web `fsm_name` param — empty when `all`.
    var queryName: String { self == .all ? "" : rawValue }

    /// Web `fsmType === 'all' ? 'vehicle' : fsmType` — the FSM used for state styling.
    var stylingName: String { self == .all ? "vehicle" : rawValue }
}

// MARK: - Time range (web `useRangeState` presets, default `7d`)

/// The trailing window the debugger filters by (web `RangePicker`). `all` is unbounded so it
/// matches the API's "all time" (`hours = 0`). Default `last7d` mirrors the web page.
public enum RangePreset: String, CaseIterable, Identifiable, Sendable {
    case last1h
    case last6h
    case last24h
    case last7d
    case last30d
    case last90d
    case all

    public var id: String { rawValue }

    /// The catalog key for this preset's label (reuses the required `fsm.allTime` for `all`).
    var labelKey: String {
        switch self {
        case .last1h: "fsm.range1h"
        case .last6h: "fsm.range6h"
        case .last24h: "fsm.range24h"
        case .last7d: "fsm.range7d"
        case .last30d: "fsm.range30d"
        case .last90d: "fsm.range90d"
        case .all: "fsm.allTime"
        }
    }

    var titleKey: LocalizedStringKey { LocalizedStringKey(labelKey) }

    /// Resolved human label for the empty-state range message (web `activeRangeLabel`).
    func resolvedLabel() -> String { String(localized: String.LocalizationValue(labelKey)) }

    /// Web `hours` — 0 means "all time".
    var hours: Int {
        switch self {
        case .last1h: 1
        case .last6h: 6
        case .last24h: 24
        case .last7d: 168
        case .last30d: 720
        case .last90d: 2160
        case .all: 0
        }
    }
}

// MARK: - Page state (web PageContainer query phases + EmptyState)

/// The transition-source data state. `.empty` is a successful load with zero transitions (web
/// `transitions.length === 0`); `.error` is retryable; `.loaded` carries one or more rows.
public enum DebuggerState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([FSMDebuggerTransition])
}

// MARK: - Data-source seam (the four web hooks, ported by name — ADR-004)

/// Supplies the vehicle list and the four per-vehicle FSM reads the page renders. Production
/// binds the shared KMP store; previews / tests inject doubles. Method names echo the web hooks
/// (`useVehicleStateMachine` / `useFSMStats` / `useFSMTransitions` / `useSignalSnapshot`) so the
/// Swift call sites read 1:1 against the React source.
public protocol StateMachineDataSource: Sendable {
    func vehicles() async throws -> [DebuggerVehicle]
    func useVehicleStateMachine(vehicleID: Int64) async throws -> VehicleLiveState?
    func useFSMStats(vehicleID: Int64) async throws -> FSMStatsData
    func useFSMTransitions(
        vehicleID: Int64, fsmType: String, hours: Int, page: Int, perPage: Int
    ) async throws -> FSMTransitionPage
    func useSignalSnapshot(vehicleID: Int64, at: Date) async throws -> [SignalSnapshotRow]
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004). Owns vehicle selection, the
/// FSM-type / range / pagination filters, the live-vs-frozen timeline toggle, and the four
/// loaded data slices. Networking lives behind the injected `StateMachineDataSource`.
@MainActor
@Observable
public final class StateMachineDebuggerPageModel {
    /// Live staleness threshold (ADR-013 — values older than 2 min are flagged stale).
    public static let stalenessThreshold: TimeInterval = 120
    public static let perPageOptions = [25, 50, 100]

    public private(set) var state: DebuggerState = .loading
    public private(set) var vehicles: [DebuggerVehicle] = []
    public private(set) var currentState: VehicleLiveState?
    public private(set) var stats: FSMStatsData = .empty
    public private(set) var snapshot: [SignalSnapshotRow] = []
    public private(set) var totalRows = 0
    public private(set) var liveUpdatedAt: Date?
    public private(set) var snapshotLoading = false

    public var selectedVehicleID: Int64?
    public var fsmType: FSMTypeFilter = .all
    public var rangePreset: RangePreset = .last7d
    public var perPage = 50
    public var serverPage = 1
    public var selectedID: Int64?
    public var isLive = true
    public var windowMinutes = 10

    @ObservationIgnored private let dataSource: any StateMachineDataSource
    @ObservationIgnored private var snapshotTask: Task<Void, Never>?

    public init(dataSource: any StateMachineDataSource = SampleStateMachineDataSource()) {
        self.dataSource = dataSource
    }

    /// The four web reads, settling the transition page state. Internal so the action
    /// extension can reuse it from `load` / `reload`.
    func fetchAll() async throws {
        guard let vehicleID = selectedVehicleID else {
            currentState = nil
            stats = .empty
            totalRows = 0
            state = .empty
            return
        }
        currentState = try await dataSource.useVehicleStateMachine(vehicleID: vehicleID)
        stats = try await dataSource.useFSMStats(vehicleID: vehicleID)
        let page = try await dataSource.useFSMTransitions(
            vehicleID: vehicleID, fsmType: fsmType.queryName,
            hours: rangePreset.hours, page: serverPage, perPage: perPage
        )
        totalRows = page.total
        liveUpdatedAt = Date()
        state = page.rows.isEmpty ? .empty : .loaded(page.rows)
    }

    /// Fetch the selected transition's point-in-time snapshot (web `useSignalSnapshot`).
    func loadSnapshot() {
        snapshotTask?.cancel()
        guard let vehicleID = selectedVehicleID, let transition = selectedTransition else {
            snapshot = []
            return
        }
        snapshotLoading = true
        snapshotTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let rows = (try? await dataSource.useSignalSnapshot(
                vehicleID: vehicleID, at: transition.ts
            )) ?? []
            guard !Task.isCancelled else {
                snapshotLoading = false
                return
            }
            snapshot = rows
            snapshotLoading = false
        }
    }
}

// MARK: - Derived state (web memos)

public extension StateMachineDebuggerPageModel {
    /// The loaded transitions (empty unless `.loaded`).
    var transitions: [FSMDebuggerTransition] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    var selectedVehicleStringID: String? {
        get { selectedVehicleID.map(String.init) }
        set { selectedVehicleID = newValue.flatMap(Int64.init) }
    }

    /// Web `currentState?.state?.toLowerCase()`.
    var stateName: String? { currentState?.state.lowercased() }

    /// Web `pieData`.
    var slices: [StateDistributionSlice] { StateMachineDerive.slices(from: transitions) }

    /// Web `summaryRows`.
    var summaryRows: [StateSummaryRow] { StateMachineDerive.summaryRows(from: transitions) }

    /// Web `flapIds`.
    var flapIDs: Set<Int64> { StateMachineDerive.flapIDs(from: transitions) }

    /// Web `diagram` nodes (native state-grid adaptation).
    var diagramNodes: [StateDiagramNode] { StateMachineDerive.diagramNodes(from: transitions) }

    /// Web `FSMTimelineChart` series.
    var timelineSeries: TSChartSeries { StateMachineDerive.timelineSeries(from: transitions) }

    /// Web `selectedTransition`.
    var selectedTransition: FSMDebuggerTransition? {
        guard let selectedID else { return nil }
        return transitions.first { $0.id == selectedID }
    }

    /// The in-window transitions for the live state timeline (web `windowed.inWindow`).
    var windowedTransitions: [FSMDebuggerTransition] {
        let sorted = transitions.sorted { $0.ts < $1.ts }
        guard let anchor = sorted.last?.ts else { return [] }
        let cutoff = anchor.addingTimeInterval(-Double(windowMinutes) * 60)
        return sorted.filter { $0.ts >= cutoff }
    }

    /// All transitions oldest-first (web `sortedByTime`).
    var sortedTransitions: [FSMDebuggerTransition] { transitions.sorted { $0.ts < $1.ts } }

    /// The selected transition's index in `sortedTransitions` (web `selectedIndex`).
    var selectedIndex: Int? {
        guard let selectedID else { return nil }
        return sortedTransitions.firstIndex { $0.id == selectedID }
    }

    /// Web `canStepPrev` — frozen, with a selection that isn't the oldest.
    var canStepPrev: Bool { !isLive && !transitions.isEmpty && (selectedIndex ?? 0) > 0 }

    /// Web `canStepNext` — frozen, with a selection that isn't the newest.
    var canStepNext: Bool {
        let sorted = sortedTransitions
        guard !isLive, !sorted.isEmpty else { return false }
        if let index = selectedIndex { return index < sorted.count - 1 }
        return true
    }

    /// Server total page count (web `Pagination` total/perPage).
    var pageCount: Int { max(1, Int(ceil(Double(totalRows) / Double(max(perPage, 1))))) }

    /// Whether the live state is older than the staleness threshold (ADR-013).
    var isLiveStale: Bool {
        guard let liveUpdatedAt else { return false }
        return Date().timeIntervalSince(liveUpdatedAt) > Self.stalenessThreshold
    }

    /// Web `activeRangeLabel` → `emptyRangeMessage`.
    var emptyRangeMessage: String {
        StateMachineFormat.noTransitions(range: rangePreset.resolvedLabel())
    }
}

// MARK: - Actions (web hooks + control handlers)

public extension StateMachineDebuggerPageModel {
    /// Initial load — vehicle list, selection, then the four reads.
    func load() async {
        state = .loading
        do {
            let loaded = try await dataSource.vehicles()
            vehicles = loaded
            if selectedVehicleID == nil || !loaded.contains(where: { $0.id == selectedVehicleID }) {
                selectedVehicleID = loaded.first?.id
            }
            try await fetchAll()
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    func refresh() async { await load() }

    /// Re-query when the vehicle changes (web `useSelectedVehicle` re-key, resets page).
    func vehicleChanged(to id: Int64?) async {
        guard id != selectedVehicleID else { return }
        selectedVehicleID = id
        serverPage = 1
        selectedID = nil
        await reload()
    }

    func fsmTypeChanged(to type: FSMTypeFilter) async {
        guard type != fsmType else { return }
        fsmType = type
        serverPage = 1
        await reload()
    }

    func rangeChanged(to preset: RangePreset) async {
        guard preset != rangePreset else { return }
        rangePreset = preset
        serverPage = 1
        await reload()
    }

    func perPageChanged(to size: Int) async {
        guard size != perPage else { return }
        perPage = size
        serverPage = 1
        await reload()
    }

    /// Bridge the 0-based `TSPagination` index to the 1-based server page.
    func pageChanged(to zeroBased: Int) async {
        let next = zeroBased + 1
        guard next != serverPage else { return }
        serverPage = next
        await reload()
    }

    /// Toggle the selected transition (web detail expander), loading its snapshot when set.
    func toggleSelect(_ id: Int64) {
        if selectedID == id {
            selectedID = nil
            snapshot = []
            return
        }
        select(id)
    }

    /// Select a transition and load its snapshot, freezing the live stream (web `onSelect`).
    func select(_ id: Int64) {
        selectedID = id
        isLive = false
        loadSnapshot()
    }

    /// Web `handleStepPrev` — move the selection one step older.
    func stepPrev() { step(by: -1) }

    /// Web `handleStepNext` — move the selection one step newer.
    func stepNext() { step(by: 1) }

    private func step(by delta: Int) {
        let sorted = sortedTransitions
        guard !sorted.isEmpty else { return }
        isLive = false
        let target: Int
        if let current = selectedIndex {
            target = min(max(current + delta, 0), sorted.count - 1)
        } else {
            target = delta < 0 ? 0 : sorted.count - 1
        }
        select(sorted[target].id)
    }

    /// Web `handleClearBuffer` — drop the selection and resume the live stream.
    func clearBuffer() {
        selectedID = nil
        snapshot = []
        isLive = true
    }

    func setLive(_ live: Bool) {
        isLive = live
        if live {
            selectedID = nil
            snapshot = []
        }
    }

    func windowChanged(to minutes: Int) { windowMinutes = minutes }

    private func reload() async {
        state = .loading
        do {
            try await fetchAll()
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
