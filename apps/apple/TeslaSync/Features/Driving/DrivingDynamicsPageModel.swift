//
//  DrivingDynamicsPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — View Model
//
//  Full parity with `web/src/features/driving/pages/DrivingDynamicsPage.tsx`. An
//  `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web hooks keep their names at the Swift call sites (`useMotorLatest`,
//  `useMotorHistory`, `useDrives`, `useDrivingCoach`, `useDriveDynamicsLatest`,
//  `useAutopilot`) in `DrivingDynamicsDataSource`; that file is the only seam that
//  changes when the generated client lands (P1/S2-S3). The view never touches the
//  network and holds no business logic.
//

import Foundation
import Observation

// MARK: - Render state

/// The page's terminal data states (loading · empty · error · success). `.empty`
/// is a successful load with no vehicles to inspect; `.error` is a retryable
/// primary-load failure (web `PageContainer` loading/error chrome); `.success`
/// renders every section, each with its own inner empty state.
enum DrivingDynamicsViewState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - View Model

@MainActor
@Observable
final class DrivingDynamicsPageModel {
    /// Number of history samples requested (web `useMotorHistory(vehicleId, 200)`).
    private static let historyLimit = 200
    /// Coach analysis window in days (web `useDrivingCoach` default).
    private static let coachDays = 30
    /// Live freshness threshold (ADR-013) — older than this is treated as stale.
    private static let staleInterval: TimeInterval = 120

    // Page render state.
    private(set) var viewState: DrivingDynamicsViewState = .loading

    // Selector roster + selection (web `useSelectedVehicle`).
    private(set) var vehicles: [DDynVehicle] = []
    var selectedVehicleID: Int64 = 0

    // Source data (web query results).
    private(set) var motorLatest: MotorSnapshot?
    private(set) var motorHistory: [MotorSnapshot] = []
    private(set) var drives: [DrivingDrive] = []
    private(set) var coach: DDynCoachData?
    private(set) var driveDynamics: DriveDynamicsSnapshot?
    private(set) var autopilot: AutopilotSnapshot?

    // Page-scoped date filter (web `startDate` / `endDate`, default last 30 days).
    private(set) var startDate: Date
    private(set) var endDate: Date

    // Live freshness (ADR-013).
    private(set) var lastUpdated: Date?

    @ObservationIgnored private let dataSource: any DrivingDynamicsDataSource
    @ObservationIgnored private let referenceDate: Date

    init(
        dataSource: any DrivingDynamicsDataSource = SampleDrivingDynamicsDataSource(),
        referenceDate: Date = Date()
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
        endDate = referenceDate
        startDate = Calendar.current.date(byAdding: .day, value: -30, to: referenceDate) ?? referenceDate
    }
}

// MARK: - Lifecycle + actions

extension DrivingDynamicsPageModel {
    /// Initial load: the vehicle roster, then the selected vehicle's telemetry.
    func load() async {
        viewState = .loading
        do {
            if vehicles.isEmpty {
                vehicles = try await dataSource.loadVehicles()
            }
        } catch {
            viewState = .error(Self.message(from: error))
            return
        }
        guard !vehicles.isEmpty else {
            viewState = .empty
            return
        }
        if selectedVehicleID == 0 {
            selectedVehicleID = vehicles.first?.id ?? 0
        }
        await loadVehicleData()
    }

    /// Pull-to-refresh — reloads the active vehicle's telemetry (web refetch).
    func refresh() async {
        guard !vehicles.isEmpty else {
            await load()
            return
        }
        await loadVehicleData()
    }

    /// Switch the active vehicle (web global `VehicleSelect`) and reload its data.
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID, vehicles.contains(where: { $0.id == vehicleID }) else {
            return
        }
        selectedVehicleID = vehicleID
        await loadVehicleData()
    }

    /// Applies a new page-scoped date range (web `RangePicker.onChange`).
    func setDateRange(start: Date, end: Date) {
        startDate = start
        endDate = end
    }

    /// Loads the per-vehicle sources. The live motor read is primary (web
    /// `motorLoading` drives the page chrome); every other source degrades to its
    /// own section empty state rather than failing the whole page.
    private func loadVehicleData() async {
        let id = selectedVehicleID
        do {
            motorLatest = try await dataSource.useMotorLatest(vehicleID: id)
        } catch {
            viewState = .error(Self.message(from: error))
            return
        }
        motorHistory = (try? await dataSource.useMotorHistory(vehicleID: id, limit: Self.historyLimit)) ?? []
        drives = (try? await dataSource.useDrives(vehicleID: id)) ?? []
        coach = try? await dataSource.useDrivingCoach(vehicleID: id, days: Self.coachDays)
        driveDynamics = try? await dataSource.useDriveDynamicsLatest(vehicleID: id)
        autopilot = try? await dataSource.useAutopilot(vehicleID: id)
        lastUpdated = referenceDate > Date() ? referenceDate : Date()
        viewState = .success
    }

    private static func message(from error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}

// MARK: - Derivations (web useMemo blocks)

extension DrivingDynamicsPageModel {
    /// The active vehicle's display label (web selector value).
    var activeVehicleName: String {
        vehicles.first { $0.id == selectedVehicleID }?.displayName ?? ""
    }

    /// Web `filteredDrives`: drives whose start falls within `[startDate, endDate + 1 day)`.
    var filteredDrives: [DrivingDrive] {
        let calendar = Calendar.current
        let lowerBound = calendar.startOfDay(for: startDate)
        let upperDay = calendar.startOfDay(for: endDate)
        let upperBound = calendar.date(byAdding: .day, value: 1, to: upperDay) ?? upperDay
        return drives.filter { $0.startTs >= lowerBound && $0.startTs < upperBound }
    }

    /// Web `motorStats = computeMotorStats(motorHistory)`.
    var motorStats: MotorStats? {
        DDynFormat.computeMotorStats(motorHistory)
    }

    /// Web `throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null`.
    var throttleStyle: ThrottleStyle? {
        motorStats.map { DDynFormat.throttleStyle(avgPowerKw: $0.avgPower) }
    }

    /// Web `avgDriveSpeedMps` across the filtered drives (nil when empty).
    var avgDriveSpeedMps: Double? {
        guard !filteredDrives.isEmpty else { return nil }
        let sum = filteredDrives.reduce(0.0) { $0 + ($1.avgSpeedMps ?? 0) }
        return sum / Double(filteredDrives.count)
    }

    /// Web `topDriveSpeedMps = max(...maxSpeedMps)` (nil when empty).
    var topDriveSpeedMps: Double? {
        guard !filteredDrives.isEmpty else { return nil }
        return filteredDrives.map { $0.maxSpeedMps ?? 0 }.max()
    }

    /// Live `> 2 min` staleness indicator (ADR-013).
    var isStale: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) > Self.staleInterval
    }
}
