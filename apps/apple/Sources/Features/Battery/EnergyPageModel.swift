import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the three energy `useQuery`s)

/// Supplies every datum the Energy page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and
/// tests inject doubles to drive the loading / empty / error / success states. Mirrors the
/// sibling analytics `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadStats` ← `useEnergyStats` → `GET /vehicles/{id}/energy?days=30`;
/// `loadSessions` ← `useChargingSessionsPaginated` → `GET /charging`;
/// `loadTelemetry` ← `useChargingTelemetryLatest` → `GET /charging-telemetry/latest`.
public protocol EnergyDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadStats(vehicleID: Int64) async throws -> EnergyStats?
    func loadSessions(vehicleID: Int64) async throws -> [EnergyChargingSession]
    func loadTelemetry(vehicleID: Int64) async throws -> EnergyLiveCharging?
}

// MARK: - Page phase (web `isLoading ? Skeleton : body`)

/// The page's terminal phase, driven by the primary energy-stats source. Unlike the sibling
/// degradation page, the web Energy page never replaces its body on a no-data load — it shows
/// the full layout with an honest empty hero — so there is no page-level `.empty` phase. The
/// stats error is surfaced as a non-blocking banner (web `{statsError && <QueryError/>}`)
/// while the body still renders, exposed here as `statsErrorMessage`.
public enum EnergyPhase: Equatable, Sendable {
    case loading
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the Energy page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`),
/// the per-vehicle stats / sessions / live-telemetry snapshots, and every derived metric the
/// web computes with `useMemo` (now pure `EnergyDerivations` calls).
@MainActor
@Observable
public final class EnergyPageModel {
    public private(set) var phase: EnergyPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    /// The primary stats-source failure surfaced as the web `QueryError` banner; nil clears it.
    public private(set) var statsErrorMessage: String?

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var stats: EnergyStats?
    public private(set) var sessions: [EnergyChargingSession] = []
    public private(set) var telemetry: EnergyLiveCharging?

    /// The analytics window (web default range: 30 days) used for projections + the lifetime
    /// "Last N days" label.
    public let periodDays = EnergyDerivations.defaultPeriodDays

    @ObservationIgnored private let dataSource: any EnergyDataSource

    public init(dataSource: any EnergyDataSource = SampleEnergyDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's stats + sessions + live telemetry
    /// (web `useVehicles` + the three per-vehicle queries). The stats source resolves the
    /// error banner; sessions + telemetry are independent (web separate queries).
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
        await loadSelectedVehicle()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its snapshots.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            stats = nil
            sessions = []
            telemetry = nil
            statsErrorMessage = nil
            phase = .ready
            return
        }

        // The stats source drives the error banner (web `statsError`): a throw surfaces the
        // QueryError region but never blocks the body. Sessions + telemetry are independent
        // (web separate queries): their failure/absence leaves the relevant sections in their
        // own empty states, never a page-level failure.
        do {
            stats = try await dataSource.loadStats(vehicleID: id)
            statsErrorMessage = nil
        } catch {
            stats = nil
            statsErrorMessage = error.localizedDescription
        }
        sessions = await (try? dataSource.loadSessions(vehicleID: id)) ?? []
        telemetry = await (try? dataSource.loadTelemetry(vehicleID: id)) ?? nil
        phase = .ready
    }

    // MARK: Derived totals (web memos)

    public var totalEnergyWh: Double { EnergyDerivations.totalEnergyWh(sessions) }
    public var totalCost: Double { EnergyDerivations.totalCost(sessions) }
    public var totalDistanceM: Double { stats?.totalDistanceM ?? 0 }
    public var co2SavedKg: Double { EnergyDerivations.co2SavedKg(stats: stats, totalEnergyWh: totalEnergyWh) }

    public var efficiencyWhPerM: Double {
        EnergyDerivations.efficiencyWhPerM(stats: stats, totalEnergyWh: totalEnergyWh, totalDistanceM: totalDistanceM)
    }

    public var costPerMeter: Double {
        EnergyDerivations.costPerMeter(totalDistanceM: totalDistanceM, totalCost: totalCost)
    }

    public var costPerKwh: Double {
        EnergyDerivations.costPerKwh(totalEnergyWh: totalEnergyWh, totalCost: totalCost)
    }

    public var gasEquivalent: Double { EnergyDerivations.gasEquivalent(totalDistanceM: totalDistanceM) }

    public var monthlyProjectedCost: Double {
        EnergyDerivations.monthlyProjectedCost(
            costPerMeter: costPerMeter,
            totalDistanceM: totalDistanceM,
            periodDays: periodDays
        )
    }

    public var yearlyProjectedCost: Double {
        EnergyDerivations.yearlyProjectedCost(monthly: monthlyProjectedCost)
    }

    public var projectedAnnualGas: Double {
        EnergyDerivations.projectedAnnualGas(gasEquivalent: gasEquivalent, periodDays: periodDays)
    }

    public var hasNoEnergyData: Bool {
        EnergyDerivations.hasNoEnergyData(stats: stats, sessions: sessions)
    }

    public var dailyBreakdown: [EnergyUsagePoint] { stats?.dailyBreakdown ?? [] }

    /// The four session-count rows (≤15, web `sessions.slice(0, 15)`).
    public var recentSessions: [EnergyChargingSession] { Array(sessions.prefix(15)) }

    /// Web `timeOfDayData` — resolves the localized bucket labels at this boundary, then runs
    /// the pure derivation.
    public var timeOfDayBuckets: [EnergyTimeOfDayBucket] {
        EnergyDerivations.timeOfDay(sessions, labels: timeOfDayLabels)
    }

    public var chargerBreakdown: [EnergyChargerBreakdownRow] {
        EnergyDerivations.chargerBreakdown(sessions)
    }

    /// The four resolved bucket labels (web `t('energy.timeOfDay.*')`), ordered night,
    /// morning, afternoon, evening.
    private var timeOfDayLabels: [String] {
        [
            String(localized: "energy.timeOfDay.night", defaultValue: "Night (0-6)"),
            String(localized: "energy.timeOfDay.morning", defaultValue: "Morning (6-12)"),
            String(localized: "energy.timeOfDay.afternoon", defaultValue: "Afternoon (12-18)"),
            String(localized: "energy.timeOfDay.evening", defaultValue: "Evening (18-24)")
        ]
    }
}
