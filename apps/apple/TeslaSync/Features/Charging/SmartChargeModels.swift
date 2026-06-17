//
//  SmartChargeModels.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Data Models
//
//  Wire-faithful Swift peers of the Smart Charge contract. Field names + JSON
//  keys mirror `web/src/types/charging.ts` (OptimizeChargeResponse, ChargeWindow,
//  CostComparison, HourlyRate, ChargePlan, RatePlanInfo) exactly — snake_case on
//  the wire. Costs are plain currency amounts and rates are ¢/kWh, matching the
//  `/charge-planner/*` endpoints (a planner contract, not telemetry — there is no
//  SI unit to convert here; the page formats currency/energy/percent only at the
//  render boundary). Timestamps decode as ISO-8601 `Date`s at the data seam.
//

import Foundation

// MARK: - Optimize request (web OptimizeChargeRequest)

/// `POST /charge-planner/optimize` body (web `OptimizeChargeRequest`). Built from
/// the page's form state; `batteryCapacityKwh` is energy in kWh per the contract.
struct SmartChargeOptimizeRequest: Equatable, Sendable {
    let vehicleID: Int64
    let targetSoc: Int
    let departBy: Date
    let ratePlanID: String
    let maxAmps: Int
    let batteryCapacityKwh: Double
}

// MARK: - Hourly rate (web HourlyRate)

/// One hour of the 24-hour TOU curve (web `HourlyRate`). `tier` is the raw wire
/// tier token (`OFF_PEAK` / `SUPER_OFF_PEAK` / `MID_PEAK` / `ON_PEAK`).
struct SmartChargeHourlyRate: Codable, Identifiable, Equatable, Sendable {
    let hour: Int
    let rateCents: Double
    let tier: String

    var id: Int { hour }
    var rateTier: SmartChargeRateTier { SmartChargeRateTier(wire: tier) }

    enum CodingKeys: String, CodingKey {
        case hour
        case rateCents = "rate_cents"
        case tier
    }
}

// MARK: - Charge window (web ChargeWindow)

/// A candidate charge window (web `ChargeWindow`) — the recommended schedule and
/// each alternative. `rateTier` is the raw wire tier token.
struct SmartChargeWindow: Codable, Identifiable, Equatable, Sendable {
    let startTime: Date
    let endTime: Date
    let rateCentsKwh: Double
    let estimatedCost: Double
    let rateTier: String

    var id: String { "\(startTime.timeIntervalSince1970)-\(endTime.timeIntervalSince1970)" }
    var tier: SmartChargeRateTier { SmartChargeRateTier(wire: rateTier) }

    enum CodingKeys: String, CodingKey {
        case startTime = "start_time"
        case endTime = "end_time"
        case rateCentsKwh = "rate_cents_kwh"
        case estimatedCost = "estimated_cost"
        case rateTier = "rate_tier"
    }
}

// MARK: - Cost comparison (web CostComparison)

/// Charge-now vs optimized cost comparison (web `CostComparison`).
struct SmartChargeCostComparison: Codable, Equatable, Sendable {
    let chargeNowCost: Double
    let optimizedCost: Double
    let savings: Double
    let savingsPercent: Double

    enum CodingKeys: String, CodingKey {
        case chargeNowCost = "charge_now_cost"
        case optimizedCost = "optimized_cost"
        case savings
        case savingsPercent = "savings_percent"
    }
}

// MARK: - Optimize response (web OptimizeChargeResponse)

/// `POST /charge-planner/optimize` response (web `OptimizeChargeResponse`).
struct SmartChargeOptimization: Codable, Equatable, Sendable {
    let planID: Int64
    let currentSoc: Int
    let targetSoc: Int
    let kwhNeeded: Double
    let estimatedDurationHours: Double
    let schedule: SmartChargeWindow
    let comparison: SmartChargeCostComparison
    let alternativeWindows: [SmartChargeWindow]
    let hourlyRates: [SmartChargeHourlyRate]

    enum CodingKeys: String, CodingKey {
        case planID = "plan_id"
        case currentSoc = "current_soc"
        case targetSoc = "target_soc"
        case kwhNeeded = "kwh_needed"
        case estimatedDurationHours = "estimated_duration_hours"
        case schedule
        case comparison
        case alternativeWindows = "alternative_windows"
        case hourlyRates = "hourly_rates"
    }
}

// MARK: - Plan history item (web ChargePlan)

/// One row of plan history (web `ChargePlan`) for the History panel.
struct SmartChargePlanHistoryItem: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let vehicleID: Int64
    let targetSoc: Int
    let scheduledStart: Date
    let scheduledEnd: Date
    let ratePlan: String
    let estimatedCost: Double?
    let savings: Double?
    let status: String
    let createdAt: Date

    var planStatus: SmartChargePlanStatus { SmartChargePlanStatus(wire: status) }

    enum CodingKeys: String, CodingKey {
        case id
        case vehicleID = "vehicle_id"
        case targetSoc = "target_soc"
        case scheduledStart = "scheduled_start"
        case scheduledEnd = "scheduled_end"
        case ratePlan = "rate_plan"
        case estimatedCost = "estimated_cost"
        case savings
        case status
        case createdAt = "created_at"
    }
}

// MARK: - Rate plan (web RatePlanInfo)

/// A selectable TOU rate plan (web `RatePlanInfo`) for the settings dropdown.
struct SmartChargeRatePlan: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let utility: String
}

// MARK: - Vehicle identity (web useSelectedVehicle roster)

/// Minimal vehicle identity for the picker (web `display_name`).
struct SmartChargeVehicle: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}
