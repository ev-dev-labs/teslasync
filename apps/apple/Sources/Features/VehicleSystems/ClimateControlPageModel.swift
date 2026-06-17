import Foundation
import Observation
import SwiftUI

// MARK: - Climate snapshot (web `ClimateState`, web/src/types/vehicle-systems.ts)

/// One climate reading — the native peer of the web `ClimateState`. Temperatures
/// are SI °C (Fleet Telemetry / Phase-42 store); the display unit is applied only
/// at the SwiftUI boundary via `ClimateFormat` (ADR-004, P1/S5). Every field is
/// optional to mirror the nullable wire shape; `id`/`timestamp` identify a row in
/// the history table + charts.
struct ClimateSnapshot: Identifiable, Equatable {
    let id: Int
    let timestamp: Date?
    // Temperatures (°C SI)
    let insideTemp: Double?
    let outsideTemp: Double?
    let driverTempSetting: Double?
    let passengerTempSetting: Double?
    // HVAC system
    let hvacPower: String?
    let isAcOn: Bool?
    let hvacAutoMode: String?
    let fanSpeed: Int?
    let hvacFanStatus: Int?
    // Climate modes
    let climateKeeperMode: String?
    let defrostMode: String?
    let defrostForPreconditioning: Bool?
    let rearDefrostEnabled: Bool?
    let wiperHeatEnabled: Bool?
    let rearDisplayHvacEnabled: Bool?
    // Battery & protection
    let batteryHeater: Bool?
    let overheatProtection: String?
    let cabinOverheatProtectionTempLimit: String?
    // Steering wheel
    let hvacSteeringWheelHeatAuto: Bool?
    let hvacSteeringWheelHeatLevel: Int?
    // Seat heaters (0–3)
    let seatHeaterLeft: Int?
    let seatHeaterRight: Int?
    let seatHeaterRearLeft: Int?
    let seatHeaterRearCenter: Int?
    let seatHeaterRearRight: Int?
    // Seat climate
    let autoSeatClimateLeft: Bool?
    let autoSeatClimateRight: Bool?
    let climateSeatCoolingFrontLeft: Int?
    let climateSeatCoolingFrontRight: Int?
    let seatVentEnabled: Bool?

    init(
        id: Int,
        timestamp: Date? = nil,
        insideTemp: Double? = nil,
        outsideTemp: Double? = nil,
        driverTempSetting: Double? = nil,
        passengerTempSetting: Double? = nil,
        hvacPower: String? = nil,
        isAcOn: Bool? = nil,
        hvacAutoMode: String? = nil,
        fanSpeed: Int? = nil,
        hvacFanStatus: Int? = nil,
        climateKeeperMode: String? = nil,
        defrostMode: String? = nil,
        defrostForPreconditioning: Bool? = nil,
        rearDefrostEnabled: Bool? = nil,
        wiperHeatEnabled: Bool? = nil,
        rearDisplayHvacEnabled: Bool? = nil,
        batteryHeater: Bool? = nil,
        overheatProtection: String? = nil,
        cabinOverheatProtectionTempLimit: String? = nil,
        hvacSteeringWheelHeatAuto: Bool? = nil,
        hvacSteeringWheelHeatLevel: Int? = nil,
        seatHeaterLeft: Int? = nil,
        seatHeaterRight: Int? = nil,
        seatHeaterRearLeft: Int? = nil,
        seatHeaterRearCenter: Int? = nil,
        seatHeaterRearRight: Int? = nil,
        autoSeatClimateLeft: Bool? = nil,
        autoSeatClimateRight: Bool? = nil,
        climateSeatCoolingFrontLeft: Int? = nil,
        climateSeatCoolingFrontRight: Int? = nil,
        seatVentEnabled: Bool? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
        self.driverTempSetting = driverTempSetting
        self.passengerTempSetting = passengerTempSetting
        self.hvacPower = hvacPower
        self.isAcOn = isAcOn
        self.hvacAutoMode = hvacAutoMode
        self.fanSpeed = fanSpeed
        self.hvacFanStatus = hvacFanStatus
        self.climateKeeperMode = climateKeeperMode
        self.defrostMode = defrostMode
        self.defrostForPreconditioning = defrostForPreconditioning
        self.rearDefrostEnabled = rearDefrostEnabled
        self.wiperHeatEnabled = wiperHeatEnabled
        self.rearDisplayHvacEnabled = rearDisplayHvacEnabled
        self.batteryHeater = batteryHeater
        self.overheatProtection = overheatProtection
        self.cabinOverheatProtectionTempLimit = cabinOverheatProtectionTempLimit
        self.hvacSteeringWheelHeatAuto = hvacSteeringWheelHeatAuto
        self.hvacSteeringWheelHeatLevel = hvacSteeringWheelHeatLevel
        self.seatHeaterLeft = seatHeaterLeft
        self.seatHeaterRight = seatHeaterRight
        self.seatHeaterRearLeft = seatHeaterRearLeft
        self.seatHeaterRearCenter = seatHeaterRearCenter
        self.seatHeaterRearRight = seatHeaterRearRight
        self.autoSeatClimateLeft = autoSeatClimateLeft
        self.autoSeatClimateRight = autoSeatClimateRight
        self.climateSeatCoolingFrontLeft = climateSeatCoolingFrontLeft
        self.climateSeatCoolingFrontRight = climateSeatCoolingFrontRight
        self.seatVentEnabled = seatVentEnabled
    }
}

// MARK: - Aggregate (the three web hooks composed)

/// The page payload: the latest climate row (`useClimate`), the climate history
/// (`useClimateHistory`), and the charging-telemetry "insufficient power to heat"
/// flag (`useChargingTelemetryLatest.not_enough_power_to_heat`).
struct ClimateData: Equatable {
    var latest: ClimateSnapshot?
    var history: [ClimateSnapshot]
    var notEnoughPowerToHeat: Bool

    init(latest: ClimateSnapshot? = nil, history: [ClimateSnapshot] = [], notEnoughPowerToHeat: Bool = false) {
        self.latest = latest
        self.history = history
        self.notEnoughPowerToHeat = notEnoughPowerToHeat
    }
}

// MARK: - Page state (web PageContainer phases + section-level empties)

/// The page data state. `.empty` is a successful load with neither a latest row
/// nor any history (web shows every section's own empty-state fallback); `.error`
/// is the retryable `useClimate` failure (web PageContainer `error`); `.loaded`
/// carries data (sections still guard their own nil fields + empty history).
enum ClimateControlState: Equatable {
    case loading
    case empty
    case error(String)
    case loaded(ClimateData)
}

// MARK: - Data source seam (web useClimate / useClimateHistory / useChargingTelemetryLatest)

/// Supplies the climate payload for a selected vehicle. The production
/// implementation binds the shared KMP vehicle-systems store (ADR-004 — the view
/// holds no networking) for `GET /climate/latest`, `GET /climate`, and
/// `GET /charging-telemetry/latest`; previews/tests inject doubles to drive the
/// loading / empty / error / success states.
protocol ClimateControlDataSource: Sendable {
    func load(vehicleID: Int64?) async throws -> ClimateData
}

/// A representative local seed used as the page/preview default until the
/// KMP-backed source is injected at composition time. It is NOT live telemetry —
/// it exists so the surface renders its populated state out of the box (mirroring
/// the sibling `SampleVehicleCostDataSource`). All temperatures are SI °C.
struct SampleClimateControlDataSource: ClimateControlDataSource {
    func load(vehicleID _: Int64?) async throws -> ClimateData {
        ClimateData(
            latest: Self.latest,
            history: Self.history,
            notEnoughPowerToHeat: false
        )
    }

    private static var latest: ClimateSnapshot {
        ClimateSnapshot(
            id: 1000,
            timestamp: Date(),
            insideTemp: 22.4,
            outsideTemp: 13.8,
            driverTempSetting: 21.0,
            passengerTempSetting: 21.5,
            hvacPower: "On",
            isAcOn: true,
            hvacAutoMode: "On",
            fanSpeed: 4,
            hvacFanStatus: 4,
            climateKeeperMode: "Off",
            defrostMode: "Off",
            defrostForPreconditioning: false,
            rearDefrostEnabled: false,
            wiperHeatEnabled: false,
            rearDisplayHvacEnabled: true,
            batteryHeater: false,
            overheatProtection: "On",
            cabinOverheatProtectionTempLimit: "Low",
            hvacSteeringWheelHeatAuto: false,
            hvacSteeringWheelHeatLevel: 2,
            seatHeaterLeft: 2,
            seatHeaterRight: 1,
            seatHeaterRearLeft: 0,
            seatHeaterRearCenter: 0,
            seatHeaterRearRight: 0,
            autoSeatClimateLeft: true,
            autoSeatClimateRight: false,
            climateSeatCoolingFrontLeft: 1,
            climateSeatCoolingFrontRight: 0,
            seatVentEnabled: true
        )
    }

    /// 16 samples across the trailing ~3 hours (newest first, like the backend).
    private static var history: [ClimateSnapshot] {
        let now = Date()
        let inside: [Double] = [
            22.4, 22.1, 21.8, 21.5, 21.0, 20.4, 19.9, 19.5,
            19.2, 19.0, 18.8, 18.9, 19.4, 20.2, 21.1, 21.9
        ]
        let outside: [Double] = [
            13.8, 13.6, 13.3, 13.0, 12.6, 12.1, 11.7, 11.4,
            11.2, 11.1, 11.3, 11.8, 12.4, 12.9, 13.2, 13.5
        ]
        let fan: [Int] = [4, 4, 5, 5, 6, 6, 7, 6, 5, 4, 3, 3, 4, 5, 5, 4]
        return (0 ..< inside.count).map { index in
            ClimateSnapshot(
                id: 900 - index,
                timestamp: now.addingTimeInterval(-Double(index) * 12 * 60),
                insideTemp: inside[index],
                outsideTemp: outside[index],
                driverTempSetting: 21.0,
                isAcOn: fan[index] > 0,
                fanSpeed: fan[index],
                climateKeeperMode: "Off"
            )
        }
    }
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in
/// the view). Owns the load state + selected vehicle and derives the display
/// guards from it, reading the payload through the injected
/// `ClimateControlDataSource` seam.
@MainActor
@Observable
final class ClimateControlPageModel {
    private(set) var state: ClimateControlState = .loading

    /// The vehicle the page reads for (web header `VehiclePicker` is the source of
    /// truth). Settable so the shell's selection drives the reload.
    var vehicleID: Int64?

    @ObservationIgnored private let dataSource: any ClimateControlDataSource

    init(
        dataSource: any ClimateControlDataSource = SampleClimateControlDataSource(),
        vehicleID: Int64? = nil
    ) {
        self.dataSource = dataSource
        self.vehicleID = vehicleID
    }

    /// The latest climate row (web `useClimate` data), or `nil` outside `.loaded`.
    var latest: ClimateSnapshot? {
        if case let .loaded(data) = state { return data.latest }
        return nil
    }

    /// The climate history newest-first (web `useClimateHistory` data).
    var history: [ClimateSnapshot] {
        if case let .loaded(data) = state { return data.history }
        return []
    }

    /// History oldest-first for the trend charts (web `chronoHistory`).
    var chronologicalHistory: [ClimateSnapshot] {
        history.sorted { lhs, rhs in
            (lhs.timestamp ?? .distantPast) < (rhs.timestamp ?? .distantPast)
        }
    }

    /// Web `chargingLatest?.not_enough_power_to_heat` — drives the banner chip.
    var notEnoughPowerToHeat: Bool {
        if case let .loaded(data) = state { return data.notEnoughPowerToHeat }
        return false
    }

    /// Initial load (web first `useClimate` fetch) — shows the skeleton.
    func load() async {
        await fetch()
    }

    /// Re-runs the load from scratch (web `refetch` / error-retry).
    func refresh() async {
        await fetch()
    }

    private func fetch() async {
        state = .loading
        do {
            let data = try await dataSource.load(vehicleID: vehicleID)
            if data.latest == nil, data.history.isEmpty {
                state = .empty
            } else {
                state = .loaded(data)
            }
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
