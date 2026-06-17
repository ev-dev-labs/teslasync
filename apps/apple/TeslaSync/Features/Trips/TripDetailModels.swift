//
//  TripDetailModels.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — Value types + seam
//
//  Native SwiftUI / Apple HIG parity of `web/src/features/trips/pages/TripDetailPage.tsx`.
//  The page summarises one saved trip — a distance / energy / efficiency / cost stat row
//  plus a key-value detail panel — bound through one source of truth (the `useTrip` fetch).
//
//  Every measurement is stored SI (metres, watt-hours, seconds — phase-42/48 canonical) and
//  converted only at the SwiftUI render boundary via the shared `Units` facade (ADR-005);
//  nothing non-SI is stored or computed here. Types are `TripDetail…`-prefixed so the unit
//  composes in the single `TeslaSync` module without symbol collision (repo dedupe convention).
//

import Foundation

// MARK: - Trip (web `useTrip` → `GET /trips/{id}` → `Trip`)

/// One saved trip, matching the web `Trip` shape (SI canonical). `name` / `endDate` are optional
/// (web `string | null`); the detail panel surfaces a missing value as the em-dash sentinel
/// (web `'—'`). `totalDistanceM` is metres, `totalEnergyWh` is watt-hours, `totalDurationS`
/// seconds, `totalCost` the trip's money cost in the user's currency.
public struct TripDetailRecord: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let name: String?
    public let startDate: Date
    public let endDate: Date?
    /// Distance in metres (SI canonical — web `total_distance_m`).
    public let totalDistanceM: Double
    /// Energy in watt-hours (SI canonical — web `total_energy_wh`).
    public let totalEnergyWh: Double
    /// Duration in seconds (SI canonical — web `total_duration_s`).
    public let totalDurationS: Double
    /// Trip cost in the user's currency (web `total_cost`).
    public let totalCost: Double
    public let driveCount: Int
    public let chargeCount: Int

    public init(
        id: Int64,
        vehicleID: Int64,
        name: String?,
        startDate: Date,
        endDate: Date?,
        totalDistanceM: Double,
        totalEnergyWh: Double,
        totalDurationS: Double,
        totalCost: Double,
        driveCount: Int,
        chargeCount: Int
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
        self.totalDistanceM = totalDistanceM
        self.totalEnergyWh = totalEnergyWh
        self.totalDurationS = totalDurationS
        self.totalCost = totalCost
        self.driveCount = driveCount
        self.chargeCount = chargeCount
    }

    /// Web header subtitle: `trip.name ?? "Trip #{id}"`. The fallback is a verbatim, non-localized
    /// composition exactly as the web hardcodes it.
    public var displayTitle: String {
        if let name, !name.isEmpty { return name }
        return "Trip #\(id)"
    }
}

// MARK: - Page status (web `loading ? … : error ? … : trip ? body : EmptyState`)

/// The four data states the web `TripDetailPage` renders for its single `useTrip` source.
/// `.success` is the populated body (stat row + detail panel); `.empty` is the web
/// `EmptyState` shown when the fetch resolves with no trip (web `trips.detail.notFound`);
/// `.error` is the retryable fetch failure (web `PageContainer error`); `.loading` is the
/// initial fetch.
public enum TripDetailState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case success(TripDetailRecord)
}

// MARK: - Data source seam (web `useTrip`)

/// Supplies the trip the page renders. The production implementation binds the shared KMP
/// repositories / use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error states. The method keeps its web hook name at the
/// Swift call site: `useTrip` ← `useTrip(id)` / `GET /trips/{id}`. A `nil` result is the web
/// "no trip" empty state; a thrown error is the retryable failure.
public protocol TripDetailDataSource: Sendable {
    func useTrip(tripID: Int64) async throws -> TripDetailRecord?
}
