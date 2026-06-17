//
//  SmartChargeDataSource.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack hook
//  name so the call sites in `SmartChargePageModel` read like the React page:
//  `useRatePlans` → GET /charge-planner/rate-plans, `useChargePlans` → GET
//  /charge-planner/history, `useOptimizeCharge` → POST /charge-planner/optimize,
//  `useApplySchedule` → POST /charge-planner/apply. Today the bodies resolve from
//  a deterministic in-memory planner; when the generated client lands (P1/S2-S3)
//  only this file changes — the view + model never touch the network.
//

import Foundation

// MARK: - Data source contract (hook-named, web parity at the call site)

/// The Smart Charge data seam. Method names mirror the web hooks verbatim so the
/// model's call sites match `SmartChargePage.tsx`.
protocol SmartChargeDataSource: Sendable {
    /// Vehicle roster for the selector (web `useSelectedVehicle`).
    func loadVehicles() async -> [SmartChargeVehicle]

    /// `useRatePlans` → GET /charge-planner/rate-plans.
    func useRatePlans() async throws -> [SmartChargeRatePlan]

    /// `useChargePlans` → GET /charge-planner/history?vehicle_id={id}.
    func useChargePlans(vehicleID: Int64) async throws -> [SmartChargePlanHistoryItem]

    /// `useOptimizeCharge` → POST /charge-planner/optimize.
    func useOptimizeCharge(_ request: SmartChargeOptimizeRequest) async throws -> SmartChargeOptimization

    /// `useApplySchedule` → POST /charge-planner/apply.
    func useApplySchedule(planID: Int64) async throws
}

// MARK: - Errors (web mutation failure surface)

/// Failures surfaced by the planner seam (web mutation `onError`). Drives the
/// page's reachable error arms.
enum SmartChargeError: LocalizedError {
    case noVehicle
    case optimizationFailed

    var errorDescription: String? {
        switch self {
        case .noVehicle:
            return SmartChargeStrings.text("chargePlanner.optimizeError", "Optimization failed")
        case .optimizationFailed:
            return SmartChargeStrings.text("chargePlanner.optimizeError", "Optimization failed")
        }
    }
}

// MARK: - Sample source (deterministic planner; replaced by the live client)

/// Deterministic planner so every panel, cost card, timeline bar, schedule row
/// and history entry renders without a backend. Costs are plain currency; rates
/// are ¢/kWh, exactly as `/charge-planner/*` serves.
struct SampleSmartChargeDataSource: SmartChargeDataSource {
    func loadVehicles() async -> [SmartChargeVehicle] {
        [
            SmartChargeVehicle(id: 1, displayName: "Model 3"),
            SmartChargeVehicle(id: 2, displayName: "Model Y")
        ]
    }

    func useRatePlans() async throws -> [SmartChargeRatePlan] {
        [
            SmartChargeRatePlan(id: "pge-ev2a", name: "PG&E EV2-A", utility: "PG&E"),
            SmartChargeRatePlan(id: "sce-tou-d", name: "SCE TOU-D", utility: "SCE"),
            SmartChargeRatePlan(id: "sdge-tou-dr1", name: "SDG&E TOU-DR1", utility: "SDG&E")
        ]
    }

    func useChargePlans(vehicleID: Int64) async throws -> [SmartChargePlanHistoryItem] {
        guard vehicleID > 0 else { return [] }
        return SmartChargePlannerEngine.history(vehicleID: vehicleID)
    }

    func useOptimizeCharge(_ request: SmartChargeOptimizeRequest) async throws -> SmartChargeOptimization {
        guard request.vehicleID > 0 else { throw SmartChargeError.noVehicle }
        return SmartChargePlannerEngine.optimize(request)
    }

    func useApplySchedule(planID: Int64) async throws {
        guard planID != 0 else { throw SmartChargeError.optimizationFailed }
    }
}
