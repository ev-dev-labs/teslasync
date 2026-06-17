//
//  TeslaChargingSessionsDataSource.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack query
//  shape so the call sites in `TeslaChargingSessionsPageModel` read like the React
//  page: `useVehicles` → GET /vehicles, `useTeslaChargingSessions` →
//  GET /tesla/charging/sessions{?vin}, `useRefreshTeslaChargingSessions` →
//  POST /tesla/charging/sessions/refresh{?vin}. Today the bodies resolve from a
//  deterministic in-memory fixture set; when the generated client lands (P1/S2-S3)
//  only these bodies change — the view + derived state never touch the network.
//
//  Every energy value the fixtures emit is SI (Wh), exactly as the
//  /tesla/charging/sessions endpoint serves after Phase-42 normalisation; peak
//  power is the wire kW value the web reads directly.
//

import Foundation

// MARK: - Refresh outcome (web mutation result / 403 surface)

/// The result of a `POST /tesla/charging/sessions/refresh`. `forbidden` carries
/// the web 403 surface ("Business account required"); `failed` is any other error.
enum ChargingSessionsRefreshOutcome: Equatable {
    case success(TeslaFleetChargingResponse)
    case forbidden
    case failed(String)
}

// MARK: - Hook-named data methods (web parity at the call site)

extension TeslaChargingSessionsPageModel {
    /// `useVehicles` → GET /vehicles (the selector roster).
    func useVehicles() async -> [ChargingSessionsVehicle] {
        TeslaChargingSessionsMockData.vehicles
    }

    /// `useTeslaChargingSessions` → GET /tesla/charging/sessions{?vin}.
    func useTeslaChargingSessions(vin: String?) async -> TeslaFleetChargingResponse {
        TeslaChargingSessionsMockData.response(vin: vin)
    }

    /// `useRefreshTeslaChargingSessions` → POST /tesla/charging/sessions/refresh{?vin}.
    /// The fixtures resolve to the same slice so the refreshed-summary path renders;
    /// the live client surfaces a 403 here for personal accounts (web `is403`).
    func useRefreshTeslaChargingSessions(vin: String?) async -> ChargingSessionsRefreshOutcome {
        .success(TeslaChargingSessionsMockData.response(vin: vin))
    }
}

// MARK: - Mock fixtures (one-screen sample; replaced by the live client)

/// Deterministic fixtures so every panel, stat card, chart bar, map marker and
/// table row renders without a backend. Energy is Wh (SI). Sessions span several
/// months (so the monthly-cost bar chart shows multiple bars) and carry
/// coordinates (so the map plots markers), costs, rates, durations and charger
/// types across two vehicles.
enum TeslaChargingSessionsMockData {
    static let vehicles: [ChargingSessionsVehicle] = [
        ChargingSessionsVehicle(id: 1, vin: "5YJ3E1EA7KF000111", displayName: "Model 3"),
        ChargingSessionsVehicle(id: 2, vin: "7SAYGDEE9PF000222", displayName: "Model Y")
    ]

    /// One charging site used to seed plottable, named sessions.
    private struct Site {
        let name: String
        let latitude: Double
        let longitude: Double
        let charger: String
    }

    private static let sites: [Site] = [
        Site(name: "Supercharger — Mountain View", latitude: 37.386, longitude: -122.084, charger: "supercharger"),
        Site(name: "Supercharger — Gilroy", latitude: 37.005, longitude: -121.568, charger: "supercharger"),
        Site(name: "Home Wall Connector", latitude: 37.774, longitude: -122.419, charger: "wall_connector"),
        Site(name: "Supercharger — Sacramento", latitude: 38.581, longitude: -121.494, charger: "supercharger"),
        Site(name: "Destination — Tahoe Lodge", latitude: 39.096, longitude: -120.032, charger: "destination")
    ]

    /// The full session slice for a VIN (nil = all vehicles). Twelve deterministic
    /// sessions across ~5 months, oldest computed from `now` so the range presets
    /// stay live.
    static func response(vin: String?) -> TeslaFleetChargingResponse {
        let all = sessions(now: Date())
        let filtered = vin.map { wanted in all.filter { $0.vin == wanted } } ?? all
        return TeslaFleetChargingResponse(
            sessions: filtered,
            summary: summary(for: filtered),
            upserted: filtered.count
        )
    }

    /// Builds the deterministic session set relative to `now`.
    static func sessions(now: Date) -> [TeslaFleetChargingSession] {
        let calendar = Calendar.current
        let count = 12
        return (0 ..< count).compactMap { index in
            let daysAgo = index * 13 // ~13-day cadence → spans ~5 months
            guard let start = calendar.date(byAdding: .day, value: -daysAgo, to: now) else { return nil }
            let site = sites[index % sites.count]
            let vehicle = vehicles[index % vehicles.count]

            // Deterministic ripple so values vary across rows.
            let energyKWh = 28.0 + Double((index * 7) % 36) // 28–63 kWh
            let durationMinutes = 22 + (index * 9) % 75
            let peakKw = 48.0 + Double((index * 11) % 200) // 48–247 kW
            let rate = 0.19 + Double(index % 5) * 0.045 // 0.19–0.37 / kWh
            let cost = energyKWh * rate
            let idle = index % 4 == 0 ? 1.50 : 0

            return TeslaFleetChargingSession(
                id: Int64(1000 + index),
                sessionID: Int64(9000 + index),
                vin: vehicle.vin,
                siteLocationName: site.name,
                chargeStartDatetime: ChargingSessionsFormat.iso(from: start),
                chargeStopDatetime: ChargingSessionsFormat.iso(
                    from: calendar.date(byAdding: .minute, value: durationMinutes, to: start) ?? start
                ),
                totalEnergyAddedWh: energyKWh * 1000, // Wh (SI)
                peakPowerKw: peakKw,
                chargeDurationS: Double(durationMinutes * 60),
                chargerType: site.charger,
                currencyCode: "USD",
                totalCost: cost + idle,
                perKwhRate: rate,
                latitude: site.latitude,
                longitude: site.longitude,
                fetchedAt: ChargingSessionsFormat.iso(from: now)
            )
        }
    }

    /// The summary aggregates over a slice (web `response.summary`).
    static func summary(for sessions: [TeslaFleetChargingSession]) -> TeslaFleetChargingSummary {
        guard !sessions.isEmpty else { return .empty }
        let totalWh = sessions.reduce(0) { $0 + $1.totalEnergyAddedWh }
        let costs = sessions.compactMap(\.totalCost)
        let totalCost = costs.isEmpty ? nil : costs.reduce(0, +)
        let rates = sessions.compactMap(\.perKwhRate)
        let avgRate = rates.isEmpty ? nil : rates.reduce(0, +) / Double(rates.count)
        let peak = sessions.compactMap(\.peakPowerKw).max()
        return TeslaFleetChargingSummary(
            totalSessions: sessions.count,
            totalWh: totalWh,
            totalCost: totalCost,
            avgCostPerKwh: avgRate,
            peakPowerKw: peak
        )
    }
}

// MARK: - ISO serialisation helper (fixture timestamps)

extension ChargingSessionsFormat {
    /// Serialise a `Date` back to the backend ISO-8601 wire form (fixtures).
    static func iso(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
