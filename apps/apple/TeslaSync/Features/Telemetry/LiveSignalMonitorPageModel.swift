//
//  LiveSignalMonitorPageModel.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  `@Observable` state holder for the web `/live-monitor` page
//  (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx). The web page is
//  a thin wrapper over `useSelectedVehicle` + `useLiveSignalStream` feeding the
//  shared `LiveSignalTail`. This model owns the same surface: the selected
//  vehicle (web `VehicleSelect`), the live SSE subscription (rate, pause, buffer
//  cap of 500, >2 min staleness per ADR-013) and the tail's local filter /
//  auto-scroll view state.
//
//  Main-actor-isolated: SwiftUI views are main-actor bound, so the model keeps
//  every mutation on one actor and stays Swift-6 complete-concurrency clean. The
//  data-source binding points (KMP shared core, ADR-004) live in the `+Data`
//  extension; both are injected so loading / empty / error / success are unit
//  testable without a live broker.
//

import Observation
import SwiftUI

/// Vehicle list provider (web `useVehicles` feeding `<VehicleSelect>`).
protocol LiveSignalMonitorVehicleSource: Sendable {
    func load() async throws -> [WorkspaceVehicle]
}

/// Live signal stream provider (web `useLiveSignalStream` → SSE, ADR-009).
/// `open` establishes the subscription and may throw to surface the error
/// state; `frame` yields one batch of samples per tick.
protocol LiveSignalStreamProviding: Sendable {
    func open(vehicleID: Int64) async throws
    func frame(tick: Int, at: Date) -> [LiveTailEntry]
}

@MainActor
@Observable
public final class LiveSignalMonitorPageModel {
    // ── Vehicle context (web useSelectedVehicle + VehicleSelect) ──────
    var vehicles: [WorkspaceVehicle] = []
    var selectedVehicleID: Int64 = 0
    var vehiclesPhase: WorkspaceDataPhase = .loading

    // ── Live SSE (web useLiveSignalStream) ────────────────────────────
    var tailEntries: [LiveTailEntry] = []
    var tailRate: Int = 0
    var tailPaused: Bool = false
    var connected: Bool = false
    var lastLiveUpdate: Date?
    var livePhase: WorkspaceDataPhase = .empty
    var buffer: [String: [Double]] = [:]
    let tailMax = 500

    // ── Tail-local view state (web LiveSignalTail useState) ────────────
    var filter: String = ""
    var autoScroll: Bool = true

    // ── Collaborators (injected; KMP binding points in `+Data`) ───────
    let vehicleSource: any LiveSignalMonitorVehicleSource
    let stream: any LiveSignalStreamProviding
    var liveTask: Task<Void, Never>?

    public init() {
        vehicleSource = SampleLiveSignalMonitorVehicleSource()
        stream = SimulatedLiveSignalStream()
        selectedVehicleID = 0
    }

    init(
        vehicleSource: any LiveSignalMonitorVehicleSource,
        stream: any LiveSignalStreamProviding,
        initialVehicleID: Int64 = 0
    ) {
        self.vehicleSource = vehicleSource
        self.stream = stream
        selectedVehicleID = max(0, initialVehicleID)
    }
    // MARK: - Derived values (web useMemo)

    var hasVehicle: Bool { selectedVehicleID > 0 }

    var isFiltering: Bool {
        !filter.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Tail rows after the signal-name filter (web `filtered`).
    var filteredEntries: [LiveTailEntry] {
        let needle = filter.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return tailEntries }
        return tailEntries.filter { $0.signal.lowercased().contains(needle) }
    }

    /// Distinct signal names currently buffered (web `uniqueSignals`).
    var uniqueSignalCount: Int { Set(tailEntries.map(\.signal)).count }

    /// Buffered row count, shown as `N / tailMax` (web `entries.length`).
    var bufferSize: Int { tailEntries.count }

    /// Connection chip label (web Badge text).
    var connectionLabel: String { connected ? LMText.connected : LMText.disconnected }

    /// Empty-state copy: filtered ⇒ "no match", otherwise "waiting".
    var tailEmptyMessage: String { isFiltering ? LMText.noMatch : LMText.waiting }

    /// Live values older than 2 minutes are stale (ADR-013).
    var isLiveStale: Bool {
        guard connected, let last = lastLiveUpdate else { return false }
        return Date().timeIntervalSince(last) > 120
    }

    // MARK: - Lifecycle

    /// Initial load: fetch the fleet (web `useVehicles`), default the selection
    /// to the first vehicle, then open the live stream. Idempotent once loaded.
    func load() async {
        guard vehicles.isEmpty else {
            if hasVehicle, liveTask == nil { startLive() }
            return
        }
        vehiclesPhase = .loading
        do {
            let result = try await vehicleSource.load()
            vehicles = result
            vehiclesPhase = result.isEmpty ? .empty : .success
            if selectedVehicleID == 0, let first = result.first { selectedVehicleID = first.id }
            if hasVehicle { startLive() }
        } catch {
            vehiclesPhase = .error(LMText.loadFailed)
        }
    }

    /// React to a `<VehicleSelect>` change: restart the stream for the new scope.
    func onVehicleChange() {
        stopLive()
        clearTail()
        if hasVehicle { startLive() } else { livePhase = .empty }
    }

    /// Commit a new selection (web `setVehicleId`); clamps non-positive to none.
    func selectVehicle(_ id: Int64?) {
        let next = max(0, id ?? 0)
        guard next != selectedVehicleID else { return }
        selectedVehicleID = next
        onVehicleChange()
    }

    // MARK: - Tail controls (web LiveSignalTail callbacks)

    func togglePause() { tailPaused.toggle() }
    func setTailPaused(_ paused: Bool) { tailPaused = paused }
    func toggleAutoScroll() { autoScroll.toggle() }

    func clearTail() {
        tailEntries = []
        tailRate = 0
        buffer = [:]
    }

    // MARK: - Live stream lifecycle

    func startLive() {
        guard hasVehicle else { livePhase = .empty; connected = false; return }
        liveTask?.cancel()
        liveTask = Task { [weak self] in
            await self?.runLiveStream()
        }
    }

    func stopLive() {
        liveTask?.cancel()
        liveTask = nil
        connected = false
    }

    /// Establishes the subscription and seeds the connected/error phase. Split
    /// out from the pump loop so the connection states are deterministically
    /// unit testable (no sleeps).
    func openStream() async -> Bool {
        livePhase = .loading
        connected = false
        buffer = [:]
        do {
            try await stream.open(vehicleID: selectedVehicleID)
        } catch {
            connected = false
            livePhase = .error(LMText.loadFailed)
            return false
        }
        connected = true
        livePhase = .success
        return true
    }

    /// Folds one frame into the rolling buffer: newest-first, capped at
    /// `tailMax`, with rate + freshness accounting (web `useLiveSignalStream`
    /// reducer). Pure — drives the success state and is unit tested directly.
    func ingest(_ frame: [LiveTailEntry], at now: Date) {
        guard !frame.isEmpty else { return }
        for entry in frame {
            tailEntries.insert(entry, at: 0)
            if let numeric = entry.value.numeric {
                buffer[entry.signal, default: []].append(numeric)
            }
        }
        if tailEntries.count > tailMax {
            tailEntries = Array(tailEntries.prefix(tailMax))
        }
        tailRate = frame.count * 2
        lastLiveUpdate = now
    }

    // MARK: - Retry helpers (error-state CTAs)

    func retryLive() { startLive() }

    func retryVehicles() async {
        vehicles = []
        await load()
    }
}
