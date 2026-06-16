import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the range-projection `useQuery`)

/// Supplies every datum the Projected-Range page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the sibling
/// Battery `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadProjection` ← the range `useQuery` → `GET /analytics/range-projection?vehicle_id`.
/// The source returns SI (it normalises the endpoint's wire km / km·h⁻¹ / Wh·km⁻¹ to
/// metres / m·s⁻¹ / Wh·m⁻¹), so the view formats straight through the `Units` facade.
public protocol ProjectedRangeDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadProjection(vehicleID: Int64) async throws -> ProjectedRangeSnapshot?
}

// MARK: - Page phase (web `isLoading ? loading : error ? error : !data ? empty : body`)

/// The page's terminal phase, driven by the range-projection query. `.empty` is a successful load
/// that yielded no projection (web `!data && !isLoading`); `.error` is a retryable failure (web
/// `PageContainer error`); `.ready` carries the snapshot. Every data state is modelled so the page
/// renders a dedicated surface and never a blank region.
public enum ProjectedRangePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - One range-maximising tip (web `tips` memo)

/// A single range tip (web `tips[]`): the SF Symbol and the string-catalog key for its copy. The
/// four tips are static page content (web hardcodes them with i18n keys).
public struct ProjectedRangeTip: Identifiable, Sendable {
    public let id: String
    public let systemImage: String
    public let textKey: String

    public init(id: String, systemImage: String, textKey: String) {
        self.id = id
        self.systemImage = systemImage
        self.textKey = textKey
    }
}

// MARK: - Page model

/// The `@Observable` state holder the Projected-Range page binds to (ADR-004 — no networking in
/// the view). Owns the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`),
/// the per-vehicle projection (web `data`, which drives the phase), and the live what-if inputs
/// (web `whatIfSpeed` / `whatIfTemp` `useState`s) — stored in SI so the interpolation never touches
/// non-SI values. Every panel / chart / scenario reads its derived data from the bound state.
@MainActor
@Observable
public final class ProjectedRangePageModel {
    public private(set) var phase: ProjectedRangePhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var projection: ProjectedRangeSnapshot?

    /// The what-if speed in SI m·s⁻¹ (web `whatIfSpeed`, slider domain 30…150 km·h⁻¹). Bound to the
    /// slider, so mutating it re-derives `whatIfResult` and re-renders.
    public var whatIfSpeedMps: Double

    /// The what-if temperature in Celsius (web `whatIfTemp`, slider domain −20…40 °C).
    public var whatIfTempC: Double

    @ObservationIgnored private let dataSource: any ProjectedRangeDataSource

    public init(
        dataSource: any ProjectedRangeDataSource = SampleProjectedRangeDataSource(),
        whatIfSpeedMps: Double = ProjectedRangeDerivations.defaultWhatIfSpeedMps,
        whatIfTempC: Double = ProjectedRangeDerivations.defaultWhatIfTempC
    ) {
        self.dataSource = dataSource
        self.whatIfSpeedMps = whatIfSpeedMps
        self.whatIfTempC = whatIfTempC
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's projection (web `useVehicles` + the
    /// per-vehicle query). The projection source resolves the page phase.
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
        await loadProjection()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its projection.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadProjection()
    }

    private func loadProjection() async {
        guard let id = selectedVehicleID else {
            projection = nil
            phase = .empty
            return
        }

        // The projection source resolves the page phase: throw → error region (web `error`),
        // nil → no-data empty (web `!data`), value → ready.
        do {
            let snapshot = try await dataSource.loadProjection(vehicleID: id)
            projection = snapshot
            phase = snapshot == nil ? .empty : .ready
        } catch {
            projection = nil
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Derived (web memos / inline reads)

    /// The chart-ready efficiency-gauge color index (web `efficiencyColor`).
    public var gaugeColorIndex: Int {
        ProjectedRangeDerivations.gaugeColorIndex(efficiencyFactor: projection?.efficiencyFactor ?? 0)
    }

    /// The live what-if result (web `whatIfResult` memo); nil until a projection is loaded.
    public var whatIfResult: ProjectedRangeDerivations.WhatIfResult? {
        guard let projection else { return nil }
        let capacity = projection.usableCapacityWh > 0 ? projection.usableCapacityWh : 75_000
        let battery = projection.batteryCardPercent > 0 ? projection.batteryCardPercent : 80
        return ProjectedRangeDerivations.interpolate(
            matrix: projection.efficiencyMatrix,
            speedMps: whatIfSpeedMps,
            tempC: whatIfTempC,
            batteryPct: battery,
            capacityWh: capacity
        )
    }

    /// The four static range-maximising tips (web `tips` memo).
    public let tips: [ProjectedRangeTip] = [
        ProjectedRangeTip(id: "speed", systemImage: "bolt.fill", textKey: "range.tip.speed"),
        ProjectedRangeTip(id: "precondition", systemImage: "thermometer.medium", textKey: "range.tip.precondition"),
        ProjectedRangeTip(id: "seatHeaters", systemImage: "wind", textKey: "range.tip.seatHeaters"),
        ProjectedRangeTip(id: "elevation", systemImage: "chart.line.uptrend.xyaxis", textKey: "range.tip.elevation")
    ]
}
