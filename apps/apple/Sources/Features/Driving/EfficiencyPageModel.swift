import Foundation
import Observation

// MARK: - Data source seam (web hooks: useSelectedVehicle / useDrivingStats / useDrives)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject doubles
/// to drive the loading / empty / error / success states.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`; `useDrivingStats` ← `GET /drives/stats`;
/// `useDrives` ← `GET /drives?vehicle_id`.
public protocol EfficiencyDataSource: Sendable {
    func loadVehicles() async throws -> [EfficiencyVehicle]
    func useDrivingStats(vehicleID: Int64) async throws -> EfficiencyStats?
    func useDrives(vehicleID: Int64) async throws -> [EfficiencyDrive]
}

// MARK: - Page phase (web PageContainer phases)

/// The page's terminal phase. `.error` is a total load failure (both the stats and drives sources
/// threw — web hooks normally degrade to empties, so the native error region is the retryable
/// equivalent); `.ready` always renders the full panel layout, each panel showing its own per-source
/// empty state (web never hides the chrome). There is no global `.empty` collapse — the empty data
/// state is the populated layout with each panel showing its own empty state.
public enum EfficiencyPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web `useSelectedVehicle`), the date-range filter (web `RangePicker`,
/// default last 30 days), the backend driving stats (web `useDrivingStats`) and the drives list (web
/// `useDrives`), and derives every chart/table value through `EfficiencyEngine`. The active unit
/// preference is mirrored from the view's environment so the unit-dependent derivations recompute on
/// change; conversion runs through the shared `Units` facade at this boundary only.
@MainActor
@Observable
public final class EfficiencyPageModel {
    /// The load state (web TanStack `isLoading` / `error` / success).
    public enum LoadState: Equatable, Sendable {
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [EfficiencyVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    /// Web `useDrivingStats` result — the hero / stat-card / summary / insights source.
    public private(set) var stats: EfficiencyStats?
    /// Web `useDrives` result — the unfiltered drive list for the selected vehicle.
    public private(set) var drives: [EfficiencyDrive] = []

    // Date filter (web `startDate` / `endDate`, default last 30 days).
    public private(set) var startDate: Date
    public private(set) var endDate: Date

    /// The active display-unit preference, mirrored from the view environment (web `useUnits`). Drives
    /// the unit-dependent derivations; the view keeps it in sync.
    public var units: UnitPreferences = .metric

    @ObservationIgnored private let dataSource: any EfficiencyDataSource
    @ObservationIgnored private let referenceDate: Date?

    public init(
        dataSource: any EfficiencyDataSource = SampleEfficiencyDataSource(),
        referenceDate: Date? = nil
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
        let clock = referenceDate ?? Date()
        endDate = clock
        startDate = Calendar.current.date(byAdding: .day, value: -30, to: clock) ?? clock
    }

    // MARK: Phase

    /// The displayed phase (web `PageContainer`): loading from the sources, error on a total failure,
    /// else ready (the full layout with per-panel empties).
    public var phase: EfficiencyPhase {
        switch loadState {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded: .ready
        }
    }

    public var selectedVehicle: EfficiencyVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's stats + drives (web `useVehicles` +
    /// `useDrivingStats` + `useDrives`).
    public func load() async {
        loadState = .loading
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
        await loadSelectedVehicle()
    }

    /// Selects a vehicle (web global `VehicleSelect`) and reloads its stats + drives.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        loadState = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            stats = nil
            drives = []
            loadState = .loaded
            return
        }
        var statsError: String?
        var drivesError: String?
        do {
            stats = try await dataSource.useDrivingStats(vehicleID: id)
        } catch {
            stats = nil
            statsError = error.localizedDescription
        }
        do {
            drives = try await dataSource.useDrives(vehicleID: id)
        } catch {
            drives = []
            drivesError = error.localizedDescription
        }
        // Only a total failure (both sources threw) surfaces the error region; a partial failure shows
        // the ready layout with the failing section's own empty state (web degrades each hook to empty).
        if let drivesError, statsError != nil {
            loadState = .failed(drivesError)
        } else {
            loadState = .loaded
        }
    }

    // MARK: Filters (web `RangePicker`)

    /// Applies a new date range (web `RangePicker.onChange` + `handleDateApply`).
    public func setDateRange(start: Date, end: Date) {
        startDate = start
        endDate = end
    }

    /// Mirrors the active unit preference from the view environment (web `useUnits`).
    public func setUnits(_ preferences: UnitPreferences) {
        guard preferences != units else { return }
        units = preferences
    }

    // MARK: Derivations (web useMemo blocks, via `EfficiencyEngine`)

    /// Web `filteredDrives`: drives whose start day falls within `[startDate, endDate]` inclusive.
    public var filteredDrives: [EfficiencyDrive] {
        let calendar = Calendar.current
        let lower = calendar.startOfDay(for: startDate)
        let upper = calendar.startOfDay(for: endDate)
        return drives.filter { drive in
            let day = calendar.startOfDay(for: drive.startTs)
            return day >= lower && day <= upper
        }
    }

    /// Web `dailyTrend` (display efficiency / distance via the active units).
    public var dailyTrend: [EfficiencyTrendPoint] {
        EfficiencyEngine.dailyTrend(
            filteredDrives,
            efficiencyToDisplay: { EfficiencyPageFormat.efficiencyValue($0, self.units) },
            distanceToDisplay: { Units.convertDistance($0, self.units) }
        )
    }

    /// Web `speedVsEff`.
    public var speedVsEfficiency: [EfficiencyScatterPoint] {
        EfficiencyEngine.speedVsEfficiency(
            filteredDrives,
            speedToDisplay: { Units.convertSpeed($0, self.units) },
            efficiencyToDisplay: { EfficiencyPageFormat.efficiencyValue($0, self.units) }
        )
    }

    /// Web `tempVsEff`.
    public var temperatureVsEfficiency: [EfficiencyScatterPoint] {
        EfficiencyEngine.temperatureVsEfficiency(
            filteredDrives,
            temperatureToDisplay: { Units.convertTemperature($0, self.units) },
            efficiencyToDisplay: { EfficiencyPageFormat.efficiencyValue($0, self.units) }
        )
    }

    /// Web `speedDist`.
    public var speedDistribution: [EfficiencySpeedBucket] {
        EfficiencyEngine.speedDistribution(
            filteredDrives,
            speedToDisplay: { Units.convertSpeed($0, self.units) }
        )
    }

    /// Web `tempBuckets` (raw °C boundaries — unit-independent).
    public var temperatureBuckets: [EfficiencyTempBucket] {
        EfficiencyEngine.temperatureBuckets(filteredDrives)
    }
}
