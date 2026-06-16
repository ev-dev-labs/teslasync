import Foundation
import Observation

// MARK: - Date range (web header `RangePicker` presets → the sessions query `start` / `end`)

/// The lookback window the header range picker offers — the web `RangePicker`'s default preset
/// set (`['today','7d','30d','mtd','ytd','all']`) with the page's `defaultPresetId: 'all'`. Each
/// maps to the inclusive `start` bound the web `useChargingSessionsPaginated(vehicleId,
/// { start, end })` query receives; `.all` is unbounded (web start `2015-01-01`, i.e. every
/// session). The label resolves from the string catalog.
public enum ChargingHeatmapRange: String, CaseIterable, Identifiable, Sendable {
    case all
    case today
    case last7
    case last30
    case monthToDate
    case yearToDate

    public var id: String { rawValue }

    /// The string-catalog key for the preset's menu label (web `date.preset.*`).
    public var labelKey: String { "charging.heatmap.range.\(rawValue)" }

    /// The inclusive lower bound of the window for a given "now", or `nil` for `.all` (web
    /// preset `start`). The upper bound is the present, so only this lower bound filters the
    /// past charging history.
    public func startDate(now: Date = .now, calendar: Calendar = .current) -> Date? {
        switch self {
        case .all:
            return nil
        case .today:
            return calendar.startOfDay(for: now)
        case .last7:
            return calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: now))
        case .last30:
            return calendar.date(byAdding: .day, value: -29, to: calendar.startOfDay(for: now))
        case .monthToDate:
            return calendar.date(from: calendar.dateComponents([.year, .month], from: now))
        case .yearToDate:
            return calendar.date(from: calendar.dateComponents([.year], from: now))
        }
    }

    /// Whether a session's ISO start timestamp falls within the window (web's server-side
    /// `start`/`end` filter, applied client-side here). `.all` admits everything.
    public func contains(_ startedAt: String, now: Date = .now, calendar: Calendar = .current) -> Bool {
        guard let lowerBound = startDate(now: now, calendar: calendar) else { return true }
        guard let date = ChargingHeatmapDerivations.parseDate(startedAt) else { return false }
        return date >= lowerBound
    }
}

// MARK: - Data source seam (web `useSelectedVehicle` + `useChargingSessionsPaginated`)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the sibling Battery /
/// Charging `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadSessions` ← `useChargingSessionsPaginated(vehicleId, { limit: 2000, start, end })` →
/// `GET /charging?vehicle_id&limit=2000&start&end`.
public protocol ChargingHeatmapDataSource: Sendable {
    func loadVehicles() async throws -> [ChargingHeatmapVehicle]
    func loadSessions(vehicleID: Int64, range: ChargingHeatmapRange) async throws -> [ChargingHeatmapSession]
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`), the active
/// range preset (web header `RangePicker` / `useRangeState`), and the session list the
/// `useChargingSessionsPaginated` query resolves to. Every section reads its data from the pure
/// derivations (`stats` / `grid` / `locations`) over that list; the sections always render, each
/// resolving success vs. empty itself, exactly as the web page does.
@MainActor
@Observable
public final class ChargingHeatmapPageModel {
    public private(set) var phase: ChargingHeatmapPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`); surfaced through the pull-to-refresh affordance.
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [ChargingHeatmapVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var sessions: [ChargingHeatmapSession] = []

    /// The active range preset (web `useRangeState({ defaultPresetId: 'all' })`).
    public private(set) var range: ChargingHeatmapRange = .all

    @ObservationIgnored private let dataSource: any ChargingHeatmapDataSource

    public init(dataSource: any ChargingHeatmapDataSource = SampleChargingHeatmapDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: ChargingHeatmapVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Derived view state (web `stats` / `buildGrid` / `locationData` memos)

    /// Web `stats` — nil when there are no sessions (the stat cards then show zeros).
    public var stats: ChargingHeatmapStats? { ChargingHeatmapDerivations.stats(sessions) }

    /// Web `{ grid, maxCount, favDay, favHour }` — the always-rendered weekly heatmap.
    public var grid: ChargingHeatGrid { ChargingHeatmapDerivations.buildGrid(sessions) }

    /// Web `locationData` — the top charging locations for the bar chart.
    public var locations: [ChargingLocation] { ChargingHeatmapDerivations.locations(sessions) }

    /// Whether the selected vehicle/range yielded any sessions (drives the success vs. empty
    /// content of the body sections).
    public var hasSessions: Bool { !sessions.isEmpty }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's sessions for the active range (web
    /// `useVehicles` + `useChargingSessionsPaginated`).
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / `onRetry`).
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

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its sessions.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSessions()
    }

    /// Selects a range preset (web header `RangePicker` `onChange`) and reloads.
    public func selectRange(_ newRange: ChargingHeatmapRange) async {
        guard newRange != range else { return }
        range = newRange
        phase = .loading
        await loadSessions()
    }

    private func loadSessions() async {
        // No vehicle → the web query is disabled and the page renders with no sessions (the stat
        // cards show zeros and each section its own empty), so resolve ready with an empty list.
        guard let id = selectedVehicleID else {
            sessions = []
            phase = .ready
            return
        }

        // The sessions fetch resolves the phase: throw → retryable error region (web
        // `PageContainer error`); value → ready (each section then resolves its own
        // success/empty from the list, web's always-rendered body).
        do {
            sessions = try await dataSource.loadSessions(vehicleID: id, range: range)
            phase = .ready
        } catch {
            sessions = []
            phase = .error(error.localizedDescription)
        }
    }
}
