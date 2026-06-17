import Foundation
import Observation

// MARK: - Data source seam (web hooks kept by name at the call sites)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject doubles to
/// drive the loading / empty / error / success states. Method names mirror the web hooks verbatim so the
/// model's call sites read like `DrivetrainHealthPage.tsx`:
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`; `useDrivetrainHealth` ← `GET …/drivetrain`;
/// `useDrivingStats` ← `GET /drives/stats`; `useDrives` ← `GET /drives?vehicle_id`;
/// `useMotorLatest` ← `GET /motor/latest`; `useMotorHistory` ← `GET /motor?limit`;
/// `useVehicleLive` ← the SSE live-state stream (`liveState.isolationResistance`).
public protocol DrivetrainHealthPageDataSource: Sendable {
    func loadVehicles() async throws -> [DrivetrainVehicle]
    func useDrivetrainHealth(vehicleID: Int64) async throws -> DrivetrainHealthSummary?
    func useDrivingStats(vehicleID: Int64) async throws -> DrivetrainDrivingStats?
    func useDrives(vehicleID: Int64) async throws -> [DrivetrainDrive]
    func useMotorLatest(vehicleID: Int64) async throws -> DrivetrainMotorSnapshot?
    func useMotorHistory(vehicleID: Int64, limit: Int) async throws -> [DrivetrainMotorSnapshot]
    func useVehicleLive(vehicleID: Int64) async throws -> Double?
}

// MARK: - Page phase (web `PageContainer` + the top-level `health ? … : EmptyState`)

/// The page's terminal phase. `.loading` is the initial health fetch (web `useDrivetrainHealth`
/// `isLoading`); `.empty` is the web `health ? … : EmptyState(noData)` collapse; `.error` is the
/// retryable equivalent of a total health-load failure (web hardcodes `error={null}`, so the native
/// surface offers a retry); `.success` renders the full panel layout, each panel showing its own
/// per-source empty state (web never hides the chrome).
public enum DrivetrainHealthPageViewState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web `useSelectedVehicle`), the date-range filter (web `RangePicker`,
/// default last 30 days), the drivetrain health summary (web `useDrivetrainHealth`), the backend driving
/// stats (web `useDrivingStats`), the drives list (web `useDrives`), the latest + historical motor
/// snapshots (web `useMotorLatest` / `useMotorHistory`), and the live HV-isolation reading (web
/// `useVehicleLive`). Every chart/sensor/recommendation value is derived here, mirroring the web
/// `useMemo` blocks. The active unit preference is mirrored from the view environment so the
/// unit-dependent derivations recompute on change; conversion runs through `Units` at this boundary.
@MainActor
@Observable
public final class DrivetrainHealthPageModel {
    /// The number of `/motor` history rows fetched (web `useMotorHistory(vehicleId, 200)`).
    public static let motorHistoryLimit = 200

    /// Live freshness ceiling (ADR-013): a reading older than this is surfaced as stale.
    public static let stalenessThreshold: TimeInterval = 120

    public private(set) var viewState: DrivetrainHealthPageViewState = .loading

    public private(set) var vehicles: [DrivetrainVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    /// Web `useDrivetrainHealth` result — the page's gating source.
    public private(set) var health: DrivetrainHealthSummary?
    /// Web `useDrivingStats` result — the drive-statistics / thermal-load / power-summary source.
    public private(set) var stats: DrivetrainDrivingStats?
    /// Web `useDrives` result — the per-drive temperature-trend + power-output chart source.
    public private(set) var drives: [DrivetrainDrive] = []
    /// Web `useMotorLatest` result — the live motor-status source.
    public private(set) var motorLatest: DrivetrainMotorSnapshot?
    /// Web `useMotorHistory` result — the stator-temperature + torque chart source.
    public private(set) var motorHistory: [DrivetrainMotorSnapshot] = []
    /// Web `liveState.isolationResistance` (kΩ) from `useVehicleLive`.
    public private(set) var isolationResistance: Double?

    // Date filter (web `startDate` / `endDate`, default last 30 days).
    public private(set) var startDate: Date
    public private(set) var endDate: Date

    /// The active display-unit preference, mirrored from the view environment (web `useUnits`).
    public var units: UnitPreferences = .metric

    /// When the visible data was last refreshed (web live refetch) — drives the staleness chip.
    public private(set) var lastUpdated: Date?

    @ObservationIgnored private let dataSource: any DrivetrainHealthPageDataSource
    @ObservationIgnored private let referenceDate: Date?

    public init(
        dataSource: any DrivetrainHealthPageDataSource = SampleDrivetrainHealthDataSource(),
        referenceDate: Date? = nil
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
        let clock = referenceDate ?? Date()
        endDate = clock
        startDate = Calendar.current.date(byAdding: .day, value: -30, to: clock) ?? clock
    }

    public var selectedVehicle: DrivetrainVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    /// Web ADR-013 staleness: the live reading is older than the 2-minute ceiling.
    public var isStale: Bool {
        guard let lastUpdated else { return false }
        return now.timeIntervalSince(lastUpdated) > Self.stalenessThreshold
    }

    private var now: Date {
        referenceDate ?? Date()
    }
}

// MARK: - Lifecycle + actions

public extension DrivetrainHealthPageModel {
    /// Initial load: the vehicle roster, then the selected vehicle's health + secondary sources.
    func load() async {
        viewState = .loading
        if vehicles.isEmpty {
            vehicles = (try? await dataSource.loadVehicles()) ?? []
        }
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadSelectedVehicle()
    }

    /// Pull-to-refresh / live refetch — reloads the active vehicle's sources.
    func refresh() async {
        guard !vehicles.isEmpty else {
            await load()
            return
        }
        await loadSelectedVehicle()
    }

    /// Switch the active vehicle (web global `VehicleSelect`) and reload its sources.
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID, vehicles.contains(where: { $0.id == vehicleID }) else { return }
        selectedVehicleID = vehicleID
        viewState = .loading
        await loadSelectedVehicle()
    }

    /// Applies a new date range (web `RangePicker.onChange`) — re-filters the per-drive charts.
    func setDateRange(start: Date, end: Date) {
        startDate = start
        endDate = end
    }

    /// Mirrors the active unit preference from the view environment (web `useUnits`).
    func setUnits(_ preferences: UnitPreferences) {
        guard preferences != units else { return }
        units = preferences
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            resetSources()
            viewState = .empty
            return
        }
        // The health summary gates the page: a throw is the retryable error region (web degrades hooks
        // to empties, so this is the native equivalent); a nil result is the web `noData` empty.
        do {
            health = try await dataSource.useDrivetrainHealth(vehicleID: id)
        } catch {
            resetSources()
            viewState = .error(Self.message(from: error))
            return
        }
        // Secondary sources never fail the page — each panel renders its own empty state.
        stats = try? await dataSource.useDrivingStats(vehicleID: id)
        drives = (try? await dataSource.useDrives(vehicleID: id)) ?? []
        motorLatest = try? await dataSource.useMotorLatest(vehicleID: id)
        motorHistory = (try? await dataSource.useMotorHistory(vehicleID: id, limit: Self.motorHistoryLimit)) ?? []
        isolationResistance = (try? await dataSource.useVehicleLive(vehicleID: id)) ?? nil
        lastUpdated = now
        viewState = health == nil ? .empty : .success
    }

    private func resetSources() {
        health = nil
        stats = nil
        drives = []
        motorLatest = nil
        motorHistory = []
        isolationResistance = nil
    }

    private static func message(from error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}

// MARK: - Derivations (web `useMemo` blocks)

public extension DrivetrainHealthPageModel {
    /// Web `overallHealth = health?.overallHealth ?? 'good'`.
    var overallHealth: DrivetrainHealthGrade {
        health?.overallHealth ?? .good
    }

    /// Web `healthScore = HEALTH_SCORE[overallHealth]`.
    var healthScore: Int {
        overallHealth.score
    }

    /// Web `sensors` — front motor / rear motor / inverter / battery, with their critical ceilings.
    var sensors: [DrivetrainTempSensor] {
        guard let health else { return [] }
        return [
            DrivetrainTempSensor(
                id: "frontMotor", labelKey: "drivetrain.frontMotor", valueC: health.frontMotorTempC,
                maxTempC: 150, systemImage: "bolt.fill", paletteIndex: 4
            ),
            DrivetrainTempSensor(
                id: "rearMotor", labelKey: "drivetrain.rearMotor", valueC: health.rearMotorTempC,
                maxTempC: 150, systemImage: "bolt.fill", paletteIndex: 6
            ),
            DrivetrainTempSensor(
                id: "inverter", labelKey: "drivetrain.inverter", valueC: health.inverterTempC,
                maxTempC: 120, systemImage: "cpu.fill", paletteIndex: 1
            ),
            DrivetrainTempSensor(
                id: "battery", labelKey: "drivetrain.battery", valueC: health.batteryTempC,
                maxTempC: 60, systemImage: "battery.100.bolt", paletteIndex: 2
            )
        ]
    }

    /// Web `sensors.filter((s) => s.value !== null).length` — the active-sensor count.
    var activeSensorCount: Int {
        sensors.filter { $0.valueC != nil }.count
    }

    /// Web `chartData`: drives within `[startDate, endDate]`, sorted ascending, capped at the last 30,
    /// mapped to per-drive power (kW) + outside temperature (display unit). `powerMin` is always 0 (web).
    var driveChartPoints: [DrivetrainDriveChartPoint] {
        let calendar = Calendar.current
        let lower = calendar.startOfDay(for: startDate)
        let upper = calendar.startOfDay(for: endDate)
        let windowed = drives
            .filter { drive in
                let day = calendar.startOfDay(for: drive.startTs)
                return day >= lower && day <= upper
            }
            .sorted { $0.startTs < $1.startTs }
            .suffix(30)
        return windowed.enumerated().map { index, drive in
            DrivetrainDriveChartPoint(
                index: index,
                date: DrivetrainHealthPageFormat.dateShort(drive.startTs),
                powerMaxKw: (drive.avgPowerW ?? 0) / 1000,
                powerMinKw: 0,
                outsideTemp: drive.outsideTempAvgC.map { DrivetrainHealthPageFormat.temperatureValue($0, units) }
            )
        }
    }

    /// Web `tempTrendData = chartData.filter((d) => d.outsideTemp !== null)`.
    var temperatureTrendPoints: [DrivetrainDriveChartPoint] {
        driveChartPoints.filter { $0.outsideTemp != nil }
    }

    /// Web `peakPower = Math.max(...chartData.map(powerMax))` (kW).
    var peakPowerKw: Double {
        driveChartPoints.map(\.powerMaxKw).max() ?? 0
    }

    /// Web `avgPowerMax = mean(chartData.powerMax)` (kW).
    var avgPowerKw: Double {
        let values = driveChartPoints.map(\.powerMaxKw)
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// Web `minRegenPower = Math.min(...chartData.map(powerMin))` (kW; always ≤ 0).
    var minRegenKw: Double {
        driveChartPoints.map(\.powerMinKw).min() ?? 0
    }

    /// Web `motorChartData`: stator (front/rear/inverter) temperatures converted to the display unit +
    /// the drive-inverter torque (Nm), one point per `/motor` history row.
    var motorChartPoints: [DrivetrainMotorChartPoint] {
        motorHistory.enumerated().map { index, snapshot in
            DrivetrainMotorChartPoint(
                index: index,
                time: snapshot.ts.map { DrivetrainHealthPageFormat.timeShort($0) } ?? "",
                stator: snapshot.motorTempCFront.map { DrivetrainHealthPageFormat.temperatureValue($0, units) },
                statorRearLeft: snapshot.motorTempCRear.map { DrivetrainHealthPageFormat.temperatureValue($0, units) },
                statorRearRight: snapshot.inverterTempC.map { DrivetrainHealthPageFormat.temperatureValue($0, units) },
                torque: snapshot.torqueNm
            )
        }
    }

    /// Web `HealthRecommendations` tips, tiered by `overallHealth` (high → medium → always-on low).
    var recommendations: [DrivetrainRecommendation] {
        func tips(
            _ pairs: [(String, String)],
            _ priority: DrivetrainRecommendation.Priority
        ) -> [DrivetrainRecommendation] {
            pairs.map { DrivetrainRecommendation(id: $0.0, textKey: $0.1, priority: priority) }
        }
        var result: [DrivetrainRecommendation] = []
        if overallHealth == .critical {
            result += tips([
                ("critical-stop", "drivetrain.tips.criticalStop"),
                ("service-urgent", "drivetrain.tips.serviceUrgent")
            ], .high)
        }
        if overallHealth == .warning || overallHealth == .critical {
            result += tips([
                ("reduce-load", "drivetrain.tips.reduceLoad"),
                ("check-coolant", "drivetrain.tips.checkCoolant"),
                ("avoid-supercharging", "drivetrain.tips.avoidSupercharging")
            ], .medium)
        }
        result += tips([
            ("regular-service", "drivetrain.tips.regularService"),
            ("gentle-accel", "drivetrain.tips.gentleAccel"),
            ("precondition", "drivetrain.tips.precondition"),
            ("monitor-temps", "drivetrain.tips.monitorTemps")
        ], .low)
        return result
    }
}
