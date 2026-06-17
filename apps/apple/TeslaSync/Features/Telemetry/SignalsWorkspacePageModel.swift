//
//  SignalsWorkspacePageModel.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  `@Observable` state holder for the unified `/signals` workspace, mirroring
//  web/src/features/telemetry/pages/SignalsWorkspacePage.tsx. The web page
//  orchestrates four data hooks; each is bound as an async method on the KMP
//  shared core (ADR-004) and surfaced through an explicit per-source phase so
//  the View renders loading / empty / error / success for every source:
//
//    useSignals          → GET /signals/{vehicleId}/available      (catalog)
//    usePinned           → GET /pinned{query}                      (pinned set)
//    useSignalDiffServer → GET /signals/{vehicleId}/diff           (compare)
//    useTogglePin        → POST /pinned · DELETE /pinned/{id}       (mutation)
//
//  Main-actor-isolated: SwiftUI views are main-actor bound, so a main-actor
//  model keeps mutation on one actor and stays Swift-6 complete-concurrency
//  clean. The data-source binding points live in the `+Data` extension.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class SignalsWorkspacePageModel {
    // ── Vehicle context ───────────────────────────────────────────────
    var vehicles: [WorkspaceVehicle] = []
    var selectedVehicleID: Int64 = 0

    // ── Mode (Live / Compare mutually exclusive; default historical) ──
    var mode: WorkspaceMode = .historical
    var chartLayout: WorkspaceChartLayout = .auto

    // ── Catalog selection (useSignals) ────────────────────────────────
    var availableSignals: [String] = []
    var selectedSignals: [String] = []
    var catalogSearch: String = ""
    var expandedCategories: Set<String> = []
    var catalogOpen: Bool = false
    var signalsPhase: WorkspaceDataPhase = .loading

    // ── Pinned (usePinned) ─────────────────────────────────────────────
    var pinnedSignals: Set<String> = []
    var pinnedPhase: WorkspaceDataPhase = .loading

    // ── Time range + pagination (historical) ──────────────────────────
    var rangeStart: Date = Calendar.current.startOfDay(for: Date())
    var rangeEnd: Date = Date()
    var perPage: Int = 25
    var page: Int = 1
    let perPageOptions: [Int] = [25, 50, 100, 500]

    // ── Historical query (useSignals history, manual Run) ─────────────
    var historyRows: [SignalHistoryEntry] = []
    var historyStats: [WorkspaceSignalStat] = []
    var historyPhase: WorkspaceDataPhase = .empty
    var hasRunHistory: Bool = false

    // ── Live SSE (useLiveSignalStream) ────────────────────────────────
    var liveTail: [LiveTailEntry] = []
    var liveStats: [WorkspaceSignalStat] = []
    var liveRate: Int = 0
    var liveChartPointCount: Int = 0
    var liveConnected: Bool = false
    var livePaused: Bool = false
    var lastLiveUpdate: Date?
    var livePhase: WorkspaceDataPhase = .empty
    var liveBuffer: [String: [Double]] = [:]
    let liveTailMax = 500
    var liveTask: Task<Void, Never>?

    // ── Compare (useSignalDiffServer) ─────────────────────────────────
    var atA: Date = Date(timeIntervalSinceNow: -3600)
    var atB: Date = Date()
    var diffSearch: String = ""
    var diffCategory: String?
    var diffRows: [WorkspaceDiffEntry] = []
    var diffPhase: WorkspaceDataPhase = .empty

    // ── Mutation (useTogglePin) ───────────────────────────────────────
    var togglePinPhase: WorkspaceDataPhase = .success
    var actionError: String?

    // ── Page-level errors (web `anyError` banner) ─────────────────────
    var bannerError: String?

    /// Catalog category definitions (web CATEGORY_PREFIXES).
    let categories: [SignalCategory] = [
        SignalCategory(key: "battery", title: "Battery", prefixes: ["battery", "soc", "charge"]),
        SignalCategory(key: "climate", title: "Climate", prefixes: ["climate", "cabin", "hvac"]),
        SignalCategory(key: "drive", title: "Drive", prefixes: ["drive", "speed", "gear", "pedal"]),
        SignalCategory(key: "location", title: "Location", prefixes: ["location", "gps", "heading"]),
        SignalCategory(key: "tire", title: "Tire", prefixes: ["tire", "tpms", "pressure"]),
        SignalCategory(key: "media", title: "Media", prefixes: ["media", "volume", "audio"]),
        SignalCategory(key: "security", title: "Security", prefixes: ["security", "lock", "door"]),
        SignalCategory(key: "motor", title: "Motor", prefixes: ["motor", "power", "torque"])
    ]

    public init() {}

    // MARK: - Derived values (web useMemo)

    var selectedCount: Int { selectedSignals.count }
    var pinnedCount: Int { pinnedSignals.count }
    var pinnedSignalNames: [String] { pinnedSignals.sorted() }
    var hasVehicle: Bool { selectedVehicleID > 0 }

    var modeLabel: String {
        switch mode {
        case .compare: WSText.compare
        case .live: WSText.live
        case .historical: WSText.historical
        }
    }

    var liveRateText: String { mode == .live ? "\(liveRate) /s" : "—" }
    var changedCount: Int { diffRows.count }
    var visibleCount: Int { visibleDiffRows.count }

    var visibleDiffRows: [WorkspaceDiffEntry] {
        var rows = diffRows
        let needle = diffSearch.trimmingCharacters(in: .whitespaces).lowercased()
        if !needle.isEmpty {
            rows = rows.filter { $0.name.lowercased().contains(needle) }
        }
        if let key = diffCategory, let category = categories.first(where: { $0.key == key }) {
            rows = rows.filter { category.matches($0.name) }
        }
        return rows
    }

    var diffFilterActive: Bool {
        !diffSearch.trimmingCharacters(in: .whitespaces).isEmpty || diffCategory != nil
    }

    var windowSpanText: String {
        let span = abs(atB.timeIntervalSince(atA))
        if span >= 3600 { return String(format: "%.1f h", span / 3600) }
        if span >= 60 { return String(format: "%.0f min", span / 60) }
        return String(format: "%.0f s", span)
    }

    /// Live values older than 2 minutes are stale (ADR-013).
    var isLiveStale: Bool {
        guard mode == .live, let last = lastLiveUpdate else { return false }
        return Date().timeIntervalSince(last) > 120
    }

    var activeStats: [WorkspaceSignalStat] { mode == .live ? liveStats : historyStats }

    /// Paginated slice of the historical rows (web `paginatedRows`).
    var paginatedHistory: [SignalHistoryEntry] {
        let startIndex = max(0, (page - 1) * perPage)
        guard startIndex < historyRows.count else { return [] }
        let endIndex = min(startIndex + perPage, historyRows.count)
        return Array(historyRows[startIndex..<endIndex])
    }

    var totalHistoryPages: Int {
        guard perPage > 0 else { return 1 }
        return max(1, Int(ceil(Double(historyRows.count) / Double(perPage))))
    }

    // MARK: - Lifecycle

    /// Initial load: vehicles + catalog (useSignals) + pinned (usePinned).
    func load() async {
        bannerError = nil
        if vehicles.isEmpty {
            vehicles = await fetchVehicles()
            if selectedVehicleID == 0, let first = vehicles.first { selectedVehicleID = first.id }
        }
        await reloadCatalog()
        await reloadPinned()
    }

    /// Vehicle change / refresh: re-fetch catalog + pinned (+ diff if active) and
    /// clear historical results to avoid intermixing vehicles.
    func refresh() async {
        hasRunHistory = false
        historyRows = []
        historyStats = []
        historyPhase = .empty
        await reloadCatalog()
        await reloadPinned()
        if mode == .compare { await loadDiff() }
    }

    func onVehicleChange() async {
        selectedSignals = []
        await refresh()
    }

    // MARK: - Source: useSignals (catalog)

    func reloadCatalog() async {
        guard hasVehicle else { signalsPhase = .empty; availableSignals = []; return }
        signalsPhase = .loading
        let result = await fetchAvailableSignals(vehicleID: selectedVehicleID)
        availableSignals = result
        signalsPhase = result.isEmpty ? .empty : .success
    }

    // MARK: - Source: usePinned

    func reloadPinned() async {
        guard hasVehicle else { pinnedPhase = .empty; pinnedSignals = []; return }
        pinnedPhase = .loading
        let result = await fetchPinned(vehicleID: selectedVehicleID)
        pinnedSignals = result
        pinnedPhase = result.isEmpty ? .empty : .success
    }

    // MARK: - Selection + mode toggles

    func isSelected(_ signal: String) -> Bool { selectedSignals.contains(signal) }

    func toggleSignal(_ signal: String) {
        if let index = selectedSignals.firstIndex(of: signal) {
            selectedSignals.remove(at: index)
        } else {
            selectedSignals.append(signal)
        }
    }

    func toggleCategoryExpanded(_ key: String) {
        if expandedCategories.contains(key) {
            expandedCategories.remove(key)
        } else {
            expandedCategories.insert(key)
        }
    }

    func toggleLive() {
        if mode == .live {
            mode = .historical
            stopLive()
        } else {
            mode = .live
            startLive()
        }
    }

    func toggleCompare() {
        if mode == .compare {
            mode = .historical
        } else {
            mode = .compare
            stopLive()
            Task { await loadDiff() }
        }
    }

    var canRunHistory: Bool { !selectedSignals.isEmpty && hasVehicle }

    // MARK: - Source: historical (useSignals history)

    func runHistory() async {
        guard canRunHistory else { return }
        page = 1
        hasRunHistory = true
        historyPhase = .loading
        let rows = await fetchHistory(
            vehicleID: selectedVehicleID,
            signals: selectedSignals,
            from: rangeStart,
            to: rangeEnd
        )
        historyRows = rows.sorted { $0.timestamp > $1.timestamp }
        historyStats = computeStats(from: historyRows)
        historyPhase = historyRows.isEmpty ? .empty : .success
    }

    // MARK: - Source: useSignalDiffServer (compare)

    func loadDiff() async {
        guard hasVehicle else { diffPhase = .empty; return }
        diffPhase = .loading
        let rows = await fetchDiff(vehicleID: selectedVehicleID, atA: atA, atB: atB)
        diffRows = rows
        diffPhase = rows.isEmpty ? .empty : .success
    }

    func exportDiffCSV() -> String {
        var csv = "signal,value_a,value_b,source_a,source_b\n"
        for row in visibleDiffRows {
            let sourceA = row.sourceA ?? ""
            let sourceB = row.sourceB ?? ""
            csv += "\(row.name),\(row.valueA.csv),\(row.valueB.csv),\(sourceA),\(sourceB)\n"
        }
        return csv
    }

    // MARK: - Source: useTogglePin (mutation)

    func isPinned(_ signal: String) -> Bool { pinnedSignals.contains(signal) }

    func togglePin(_ signal: String) async {
        togglePinPhase = .loading
        let shouldPin = !pinnedSignals.contains(signal)
        let ok = await persistPin(signal: signal, pin: shouldPin, vehicleID: selectedVehicleID)
        if ok {
            if shouldPin { pinnedSignals.insert(signal) } else { pinnedSignals.remove(signal) }
            pinnedPhase = pinnedSignals.isEmpty ? .empty : .success
            togglePinPhase = .success
            actionError = nil
        } else {
            togglePinPhase = .error("pin")
            actionError = WSText.loadFailed
        }
    }

    func pinSelected(_ signals: [String]) async {
        for signal in signals where !pinnedSignals.contains(signal) { await togglePin(signal) }
    }

    func unpinSelected(_ signals: [String]) async {
        for signal in signals where pinnedSignals.contains(signal) { await togglePin(signal) }
    }

    // MARK: - Live SSE lifecycle

    func startLive() {
        guard hasVehicle else { livePhase = .empty; return }
        livePhase = .loading
        liveConnected = false
        liveBuffer = [:]
        liveChartPointCount = 0
        liveTask?.cancel()
        liveTask = Task { [weak self] in
            await self?.runLiveStream()
        }
    }

    func stopLive() {
        liveTask?.cancel()
        liveTask = nil
        liveConnected = false
    }

    func setLivePaused(_ paused: Bool) { livePaused = paused }

    func clearLiveTail() {
        liveTail = []
        liveRate = 0
    }

    // MARK: - Retry helpers (error-state CTAs)

    func retryCatalog() async { await reloadCatalog() }
    func retryPinned() async { await reloadPinned() }
    func retryDiff() async { await loadDiff() }
    func retryHistory() async { await runHistory() }
}
