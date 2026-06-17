//
//  DataRepairPageModel.swift
//  TeslaSync — P4 feature view · P7 · DataRepairPage (Apple) — View Model
//

import Observation
import SwiftUI

// MARK: - Data Models

struct DataRepairPageModelChargingSession: Identifiable {
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
    var staleCharging: [DataRepairPageModelChargingSession]
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

    /// Computed properties
    var totalStale: Int {
        switch state {
        case let .success(data):
            data.staleCharging.count + data.staleDrives.count
        default:
            0
        }
    }

    var staleCharging: [DataRepairPageModelChargingSession] {
        switch state {
        case let .success(data):
            data.staleCharging
        default:
            []
        }
    }

    var staleDrives: [Drive] {
        switch state {
        case let .success(data):
            data.staleDrives
        default:
            []
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
        _: DataRepairPageModelChargingSession,
        data _: [String: Any]
    ) async -> Result<Void, Error> {
        // Integration point: PUT /data-repair/charging/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func closeChargingSession(_: Int) async -> Result<Void, Error> {
        // Integration point: POST /data-repair/charging/{id}/close via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func discardChargingSession(_: Int) async -> Result<Void, Error> {
        // Integration point: DELETE /data-repair/charging/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func updateDrive(_: Drive, data _: [String: Any]) async -> Result<Void, Error> {
        // Integration point: PUT /data-repair/drives/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func closeDrive(_: Int) async -> Result<Void, Error> {
        // Integration point: POST /data-repair/drives/{id}/close via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }

    func discardDrive(_: Int) async -> Result<Void, Error> {
        // Integration point: DELETE /data-repair/drives/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))
        return .success(())
    }
}
