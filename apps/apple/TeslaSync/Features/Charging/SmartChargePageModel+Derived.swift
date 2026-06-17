//
//  SmartChargePageModel+Derived.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Derived state
//
//  The web `useMemo` / inline derivations, kept off the model's stored-state body:
//  the rate-plan dropdown options (with the web fallback list), the highlighted
//  charge window for the timeline, the active vehicle label, the mutation
//  surfaces, and the `> 2 min` live-staleness flag (ADR-013).
//

import Foundation

extension SmartChargePageModel {
    /// Web `ratePlanOptions` — `${name} (${utility})`, falling back to the three
    /// built-in plans when the rate-plan query is empty or failed.
    var ratePlanChoices: [SmartChargeRatePlanChoice] {
        guard !ratePlans.isEmpty else { return Self.fallbackRatePlans }
        return ratePlans.map { plan in
            SmartChargeRatePlanChoice(id: plan.id, label: "\(plan.name) (\(plan.utility))")
        }
    }

    /// The three built-in plan choices (web fallback array).
    static var fallbackRatePlans: [SmartChargeRatePlanChoice] {
        [
            SmartChargeRatePlanChoice(id: "pge-ev2a", label: "PG&E EV2-A"),
            SmartChargeRatePlanChoice(id: "sce-tou-d", label: "SCE TOU-D"),
            SmartChargeRatePlanChoice(id: "sdge-tou-dr1", label: "SDG&E TOU-DR1")
        ]
    }

    /// Web `chargeWindow` — the optimal window's start/end hours for the timeline
    /// highlight (`end.getHours() || 24`).
    var chargeWindow: SmartChargeWindowHours? {
        guard let result else { return nil }
        let calendar = Calendar.current
        let startHour = calendar.component(.hour, from: result.schedule.startTime)
        let rawEnd = calendar.component(.hour, from: result.schedule.endTime)
        return SmartChargeWindowHours(startHour: startHour, endHour: rawEnd == 0 ? 24 : rawEnd)
    }

    /// Web `historyItems` (`plans ?? []`).
    var historyItems: [SmartChargePlanHistoryItem] { history }

    /// Active vehicle display name (web selector label).
    var activeVehicleName: String {
        vehicles.first { $0.id == selectedVehicleID }?.displayName ?? ""
    }

    /// Whether the optimize request is in flight (web `optimizeMutation.isPending`).
    var isOptimizing: Bool { optimizeState == .running }

    /// Whether the apply request is in flight (web `applyMutation.isPending`).
    var isApplying: Bool { applyState == .running }

    /// Whether the schedule has been applied (web `applied`).
    var isApplied: Bool { applyState == .succeeded }

    /// Web `optimizeMutation.isError` message, if any.
    var optimizeErrorMessage: String? {
        if case let .failed(message) = optimizeState { return message }
        return nil
    }

    /// Web `applyMutation.isError` message, if any.
    var applyErrorMessage: String? {
        if case let .failed(message) = applyState { return message }
        return nil
    }

    /// The optimize button is disabled without a vehicle or while pending
    /// (web `disabled={!vehicleIdNum || optimizeMutation.isPending}`).
    var canOptimize: Bool { selectedVehicleID > 0 && !isOptimizing }

    /// `> 2 min` since the last successful refresh (live staleness indicator).
    var isStale: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) > 120
    }
}

/// The optimal window's start/end hour pair (web `chargeWindow`).
struct SmartChargeWindowHours: Equatable, Sendable {
    let startHour: Int
    let endHour: Int

    /// Whether `hour` falls inside the window (web `isInWindow`, cross-midnight aware).
    func contains(hour: Int) -> Bool {
        if startHour <= endHour {
            return hour >= startHour && hour < endHour
        }
        return hour >= startHour || hour < endHour
    }
}
