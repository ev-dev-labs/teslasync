//
//  DataRepairPageModel.swift
//  TeslaSync — P4 feature view · P7 · DataRepairPage (Apple) — View Model
//

import SwiftUI
import Observation

// MARK: - Data Models

struct ChargingSession: Identifiable {
    let id: Int
    let vehicleId: Int
    let startTs: String
    let startBatteryPct: Int
    var endBatteryPct: Int?
    var totalEnergyAddedWh: Double?
    var peakPowerW: Double?
    var durationMin: Int?
    var cost: Double?
}

struct Drive: Identifiable {
    let id: Int
    let vehicleId: Int
    let startTs: String
    var startBatteryPct: Int?
    var endBatteryPct: Int?
    var distanceM: Double?
    var durationS: Int?
    var maxSpeedMps: Double?
}

struct StaleData {
    var staleCharging: [ChargingSession]
    var staleDrives: [Drive]
}

enum DataRepairTab {
    case charging
    case drives
}

enum DataRepairState {
    case loading
    case empty
    case error(String)
    case success(StaleData)
}

// MARK: - ViewModel

@Observable
final class DataRepairPageModel {
    var state: DataRepairState = .loading
    var selectedTab: DataRepairTab = .charging
    var expandedId: Int?

    // Computed properties
    var totalStale: Int {
        switch state {
        case .success(let data):
            return data.staleCharging.count + data.staleDrives.count
        default:
            return 0
        }
    }

    var staleCharging: [ChargingSession] {
        switch state {
        case .success(let data):
            return data.staleCharging
        default:
            return []
        }
    }

    var staleDrives: [Drive] {
        switch state {
        case .success(let data):
            return data.staleDrives
        default:
            return []
        }
    }

    func load() async {
        state = .loading

        // Integration point: KMP core API client for /data-repair/stale-sessions
        // Currently returns empty state until KMP integration is wired
        try? await Task.sleep(for: .milliseconds(500))

        state = .success(StaleData(staleCharging: [], staleDrives: []))
    }

    func refresh() async {
        await load()
    }

    func updateChargingSession(
        _ session: ChargingSession,
        data: [String: Any]
    ) async -> Result<Void, Error> {
        // Integration point: PUT /data-repair/charging/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func closeChargingSession(_ sessionId: Int) async -> Result<Void, Error> {
        // Integration point: POST /data-repair/charging/{id}/close via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func discardChargingSession(_ sessionId: Int) async -> Result<Void, Error> {
        // Integration point: DELETE /data-repair/charging/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func updateDrive(_ drive: Drive, data: [String: Any]) async -> Result<Void, Error> {
        // Integration point: PUT /data-repair/drives/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func closeDrive(_ driveId: Int) async -> Result<Void, Error> {
        // Integration point: POST /data-repair/drives/{id}/close via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func discardDrive(_ driveId: Int) async -> Result<Void, Error> {
        // Integration point: DELETE /data-repair/drives/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }
}
