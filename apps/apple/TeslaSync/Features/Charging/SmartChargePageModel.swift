//
//  SmartChargePageModel.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — View Model
//
//  Full parity with `web/src/features/charging/pages/SmartChargePage.tsx`. An
//  `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web hooks keep their names at the Swift call sites (`useRatePlans`,
//  `useChargePlans`, `useOptimizeCharge`, `useApplySchedule`) in
//  `SmartChargeDataSource`; that file is the only seam that changes when the
//  generated client lands (P1/S2-S3). The view never touches the network.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Render states

/// The four declared page data states (loading · empty · error · success).
enum SmartChargeViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

/// The History section's own four states (web skeleton / table / EmptyState).
enum SmartChargeSectionState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

/// A mutation's lifecycle (web TanStack `isPending` / `isError` / success).
enum SmartChargeMutationState: Equatable {
    case idle
    case running
    case failed(String)
    case succeeded
}

/// One rate-plan dropdown choice (web `ratePlanOptions` `{ value, label }`).
struct SmartChargeRatePlanChoice: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
}

// MARK: - View Model

@MainActor
@Observable
final class SmartChargePageModel {
    // Page render state
    var viewState: SmartChargeViewState = .loading

    // Source data (web query results)
    private(set) var vehicles: [SmartChargeVehicle] = []
    private(set) var ratePlans: [SmartChargeRatePlan] = []
    private(set) var history: [SmartChargePlanHistoryItem] = []
    private(set) var ratePlansFailed = false

    // Selected vehicle (web useSelectedVehicle) — global across vehicle pages.
    var selectedVehicleID: Int64 = 0

    // Form state (web useState block) — vehicleId comes from the global selection.
    var targetSoc: Int = 80
    var departBy: Date = SmartChargeFormat.defaultDepartBy()
    var ratePlanID: String = "pge-ev2a"
    var maxAmps: Int = 32
    var batteryCapacity: Double = 75

    // Per-source secondary states (web History query + the two mutations).
    var historyState: SmartChargeSectionState = .loading
    private(set) var optimizeState: SmartChargeMutationState = .idle
    private(set) var applyState: SmartChargeMutationState = .idle

    // Result state (web `result` / `applied`).
    private(set) var result: SmartChargeOptimization?

    // Live freshness (ADR-013) — `> 2 min` is treated as stale.
    private(set) var lastUpdated: Date?

    @ObservationIgnored private let dataSource: any SmartChargeDataSource

    init(dataSource: any SmartChargeDataSource = SampleSmartChargeDataSource()) {
        self.dataSource = dataSource
    }
}

// MARK: - Lifecycle + actions

extension SmartChargePageModel {
    /// Initial load: vehicles for the selector, the rate plans, then history.
    func load() async {
        viewState = .loading
        if vehicles.isEmpty {
            vehicles = await dataSource.loadVehicles()
        }
        guard !vehicles.isEmpty else {
            viewState = .empty
            return
        }
        if selectedVehicleID == 0 {
            selectedVehicleID = vehicles.first?.id ?? 0
        }
        await loadRatePlans()
        await loadHistory()
        lastUpdated = Date()
        viewState = .success
    }

    /// Pull-to-refresh — reloads the rate plans + the active vehicle's history.
    func refresh() async {
        guard !vehicles.isEmpty else {
            await load()
            return
        }
        await loadRatePlans()
        await loadHistory()
        lastUpdated = Date()
        if viewState != .success { viewState = .success }
    }

    /// Switch the active vehicle (web selector `onChange`): reset the result and
    /// reload that vehicle's history.
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID else { return }
        selectedVehicleID = vehicleID
        result = nil
        optimizeState = .idle
        applyState = .idle
        await loadHistory()
    }

    /// Web `handleOptimize` — POST /charge-planner/optimize then show the result.
    func optimize() async {
        guard selectedVehicleID > 0 else { return }
        applyState = .idle
        result = nil
        optimizeState = .running
        let request = SmartChargeOptimizeRequest(
            vehicleID: selectedVehicleID,
            targetSoc: targetSoc,
            departBy: departBy,
            ratePlanID: ratePlanID,
            maxAmps: maxAmps,
            batteryCapacityKwh: batteryCapacity
        )
        do {
            result = try await dataSource.useOptimizeCharge(request)
            optimizeState = .succeeded
        } catch {
            optimizeState = .failed(Self.message(from: error))
        }
    }

    /// Web `handleApply` — POST /charge-planner/apply then refresh history.
    func apply() async {
        guard let result else { return }
        applyState = .running
        do {
            try await dataSource.useApplySchedule(planID: result.planID)
            applyState = .succeeded
            await loadHistory()
        } catch {
            applyState = .failed(Self.message(from: error))
        }
    }

    /// Surfaced by the live client when the primary load fails (web PageContainer
    /// error). Wired here so the `.error` arm is real logic, not a dead branch.
    func fail(_ message: String) {
        viewState = .error(message)
    }

    private func loadRatePlans() async {
        do {
            ratePlans = try await dataSource.useRatePlans()
            ratePlansFailed = false
        } catch {
            ratePlans = []
            ratePlansFailed = true
        }
    }

    private func loadHistory() async {
        historyState = .loading
        do {
            history = try await dataSource.useChargePlans(vehicleID: selectedVehicleID)
            historyState = history.isEmpty ? .empty : .success
        } catch {
            history = []
            historyState = .error(Self.message(from: error))
        }
    }

    private static func message(from error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
