//
//  SignalExplorerPageModel.swift
//  TeslaSync — P4 feature view · P7 · SignalExplorerPage (Apple)
//
//  `@Observable` state holder for the web `/signal-explorer` page, mirroring
//  web/src/features/telemetry/pages/SignalExplorerPage.tsx. The page's declared
//  data source is bound here as an async method on the KMP shared core (ADR-004)
//  and surfaced through an explicit phase so the View renders loading / empty /
//  error / success for it:
//
//    useSignals → GET /signals/{vehicleId}/available   (the signal catalog)
//
//  The page composes three telemetry leaves (the stats panel, the chart panel,
//  and the history table — their own parity units) plus the Helix NL-filter
//  shared surface; this model owns the orchestration the web page owns: the
//  selected-signal set (capped at five), the time range + pagination, the manual
//  Explore run, the Live SSE toggle, and the AI-draft apply path. Main-actor
//  isolated so SwiftUI mutation stays on one actor (Swift-6 strict-concurrency
//  clean). The data-source seams + aggregate maths live in the `+Data` extension.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class SignalExplorerPageModel {
    /// The signal cap the web enforces (`MAX_SIGNALS = 5`).
    static let maxSignals = 5
    /// The web `PER_PAGE_OPTIONS`.
    let perPageOptions: [Int] = [25, 50, 100, 500]

    // ── Vehicle context (web `useSelectedVehicle`) ────────────────────
    var vehicles: [WorkspaceVehicle] = []
    var selectedVehicleID: Int64 = 0

    // ── Source: useSignals catalog (the four-state data source) ───────
    var availableSignals: [String] = []
    var catalogPhase: WorkspaceDataPhase = .loading

    // ── Selection (web `selectedSignals` URL array) ───────────────────
    var selectedSignals: [String] = []
    var catalogSearch: String = ""

    // ── Time range + pagination (web `useRangeState` + URL numbers) ───
    var rangeStart: Date = Calendar.current.startOfDay(for: Date())
    var rangeEnd: Date = Date()
    var perPage: Int = 25
    var page: Int = 1

    // ── Historical query (web `useQuery`, manual Explore) ─────────────
    var hasExplored: Bool = false
    var historicalLoading: Bool = false
    var historyRows: [SignalHistoryEntry] = []
    var historyStats: [WorkspaceSignalStat] = []
    var historyError: String?

    // ── Live SSE (web `useLiveSignalStream`) ──────────────────────────
    var isLive: Bool = false
    var liveConnected: Bool = false
    var liveTail: [LiveTailEntry] = []
    var liveStats: [WorkspaceSignalStat] = []
    var liveChartPointCount: Int = 0
    var liveRate: Int = 0
    var lastLiveUpdate: Date?
    var liveBuffer: [String: [Double]] = [:]
    @ObservationIgnored var liveTask: Task<Void, Never>?
    let liveTailMax = 500

    // ── Page-level error (web `anyError` banner) ──────────────────────
    var bannerError: String?

    // ── AI NL-filter surface (web `<AISignalExplorerNlFilter …/>`) ────
    //  Held so its `@State` survives re-render and its `onApply` routes the
    //  proposed filter back into this deterministic form (web `handleApplyAiDraft`).
    private(set) var aiFilterModel: SignalExplorerFilterModel?
    @ObservationIgnored private(set) var aiFilterSource: InMemorySignalExplorerFilterSource?

    public init() {}


    // MARK: - Derived values (web useMemo)

    var hasVehicle: Bool { selectedVehicleID > 0 }

    /// Web `canExplore = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0`.
    var canExplore: Bool { !selectedSignals.isEmpty && hasVehicle }

    /// Web `isAtCapacity` — the selection has reached the five-signal cap.
    var isAtCapacity: Bool { selectedSignals.count >= Self.maxSignals }

    /// Web `hasHistorical = exploreKey !== null`.
    var hasHistorical: Bool { hasExplored }

    /// Web resting empty-state gate: `!hasHistorical && !isLive`.
    var showsRestingEmpty: Bool { !hasHistorical && !isLive }

    /// Web `activeStats = isLive ? live.chartStats : historicalStats`.
    var activeStats: [WorkspaceSignalStat] { isLive ? liveStats : historyStats }

    /// Web `totalRecords = historicalRows.length`.
    var totalRecords: Int { historyRows.count }

    /// Web `paginatedRows = historicalRows.slice(startIdx, startIdx + perPage)`.
    var paginatedRows: [SignalHistoryEntry] {
        let startIndex = max(0, (page - 1) * perPage)
        guard startIndex < historyRows.count else { return [] }
        let endIndex = min(startIndex + perPage, historyRows.count)
        return Array(historyRows[startIndex ..< endIndex])
    }

    var totalPages: Int {
        guard perPage > 0 else { return 1 }
        return max(1, Int(ceil(Double(historyRows.count) / Double(perPage))))
    }

    /// The active live-chart point count surfaced on the chart panel header.
    var liveEventCount: Int { liveChartPointCount }

    /// Live values older than two minutes are stale (ADR-013).
    var isLiveStale: Bool {
        guard isLive, let last = lastLiveUpdate else { return false }
        return Date().timeIntervalSince(last) > 120
    }

    // MARK: - Lifecycle

    /// Initial load: vehicles + the useSignals catalog, and the AI surface.
    func load() async {
        ensureAIFilter()
        bannerError = nil
        if vehicles.isEmpty {
            vehicles = await fetchVehicles()
            if selectedVehicleID == 0, let first = vehicles.first {
                selectedVehicleID = first.id
            }
        }
        await reloadCatalog()
    }

    /// Pull-to-refresh / manual refresh: re-fetch the catalog only (history is
    /// kept until the operator re-runs Explore).
    func refresh() async {
        bannerError = nil
        await reloadCatalog()
    }

    /// Vehicle change: clear the selection + historical results (web effect that
    /// wipes `exploreKey` on `vehicleId` change) and re-fetch the catalog.
    func onVehicleChange() async {
        selectedSignals = []
        hasExplored = false
        historyRows = []
        historyStats = []
        historyError = nil
        if isLive { toggleLive() }
        aiFilterSource?.pushInput(
            SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: selectedVehicleID)
        )
        await reloadCatalog()
    }

    // MARK: - Source: useSignals (catalog — all four states)

    /// Binds `useSignals → GET /signals/{vehicleId}/available` and projects the
    /// loading / empty / error / success phases the View renders.
    func reloadCatalog() async {
        guard hasVehicle else {
            availableSignals = []
            catalogPhase = .empty
            return
        }
        catalogPhase = .loading
        do {
            let result = try await fetchAvailableSignals(vehicleID: selectedVehicleID)
            availableSignals = result
            catalogPhase = result.isEmpty ? .empty : .success
        } catch {
            availableSignals = []
            catalogPhase = .error(error.localizedDescription)
            bannerError = error.localizedDescription
        }
    }

    func retryCatalog() async { await reloadCatalog() }

    // MARK: - Selection (web `setSelectedSignals(next.slice(0, MAX))`)

    func isSelected(_ signal: String) -> Bool { selectedSignals.contains(signal) }

    /// Toggles a signal, enforcing the five-signal cap on add (web `slice(0, MAX)`).
    func toggleSignal(_ signal: String) {
        if let index = selectedSignals.firstIndex(of: signal) {
            selectedSignals.remove(at: index)
        } else if selectedSignals.count < Self.maxSignals {
            selectedSignals.append(signal)
        }
    }

    func setSelected(_ signals: [String]) {
        selectedSignals = Array(signals.prefix(Self.maxSignals))
    }

    // MARK: - Source: historical (web `handleExplore` → useQuery)

    /// Web `handleExplore`: leaves live, resets to page 1, and runs the query.
    func explore() async {
        guard canExplore else { return }
        if isLive { toggleLive() }
        page = 1
        hasExplored = true
        await runHistorical()
    }

    func runHistorical() async {
        guard canExplore else { return }
        historicalLoading = true
        historyError = nil
        do {
            let rows = try await fetchHistory(
                vehicleID: selectedVehicleID,
                signals: selectedSignals,
                from: rangeStart,
                to: rangeEnd,
                limit: perPage * 10
            )
            historyRows = rows.sorted { $0.timestamp > $1.timestamp }
            historyStats = computeStats(from: historyRows)
        } catch {
            historyRows = []
            historyStats = []
            historyError = error.localizedDescription
            bannerError = error.localizedDescription
        }
        historicalLoading = false
    }

    func retryHistorical() async { await runHistorical() }

    func setPage(_ next: Int) {
        page = max(1, min(next, totalPages))
    }

    func setPerPage(_ next: Int) {
        perPage = next
        page = 1
    }

    // MARK: - Source: live SSE (web `toggleLive` / useLiveSignalStream)

    /// Web `toggleLive`: flips the live monitor on/off (mutually exclusive with
    /// the historical results region).
    func toggleLive() {
        isLive.toggle()
        if isLive {
            startLive()
        } else {
            stopLive()
        }
    }

    func startLive() {
        guard hasVehicle else { isLive = false; return }
        liveConnected = false
        liveBuffer = [:]
        liveTail = []
        liveStats = []
        liveChartPointCount = 0
        liveRate = 0
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

    // MARK: - AI NL-filter (web `handleApplyAiDraft`)

    /// Lazily builds the held NL-filter surface model, scoped to the active
    /// vehicle and wired so an applied proposal lands in this form (never the LLM).
    func ensureAIFilter() {
        guard aiFilterModel == nil else { return }
        let source = InMemorySignalExplorerFilterSource(
            initial: SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: selectedVehicleID)
        )
        aiFilterSource = source
        aiFilterModel = SignalExplorerFilterModel(source: source) { [weak self] draft in
            self?.applyAiDraft(draft)
        }
    }

    /// Web `handleApplyAiDraft`: copies a typed proposal into the deterministic
    /// form — capped signals, an optional page size, resetting to page 1.
    func applyAiDraft(_ draft: SignalExplorerFilterDraft) {
        let next = draft.signals
            .filter { !$0.isEmpty }
            .prefix(Self.maxSignals)
        if !next.isEmpty { selectedSignals = Array(next) }
        if draft.perPage > 0 {
            perPage = draft.perPage
            page = 1
        }
    }
}
