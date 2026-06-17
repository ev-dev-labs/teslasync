//
//  SoftwareUpdatesDataSource.swift
//  TeslaSync — P4 feature view · P7 · SoftwareUpdates (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). The web page loads `/software-updates`
//  through an inline `useQuery` + `request`; that call is kept under the
//  hook-style name `useSoftwareUpdates` at the Swift call site so the model reads
//  like the React page. Today the method resolves from an in-memory fixture
//  store; when the generated client lands (P1/S2-S3) only this body changes — the
//  model, derived state and views stay untouched.
//

import Foundation

// MARK: - Hook-named data methods (web parity at the call site)

extension SoftwareUpdatesPageModel {
    /// Vehicle roster for the toolbar selector (web `useSelectedVehicle`).
    func loadVehicles() async -> [SoftwareUpdatesVehicle] {
        SoftwareUpdatesMockData.vehicles
    }

    /// `useSoftwareUpdates` → `GET /software-updates?vehicle_id&limit&offset&start&end`.
    /// Mirrors the web query: filter by vehicle + `[start, end]` window on
    /// `created_at`, sort newest-first, then page with `offset` / `limit`.
    /// Declared `throws` because the live client surfaces HTTP / decode failures
    /// here (the page renders the error state); the fixture path never throws.
    func useSoftwareUpdates(
        vehicleID: Int64,
        limit: Int,
        offset: Int,
        start: Date?,
        end: Date?
    ) async throws -> [SoftwareUpdatesItem] {
        let windowed = SoftwareUpdatesMockData.updates(vehicleID: vehicleID)
            .filter { update in
                if let start, update.createdAt < start { return false }
                if let end, update.createdAt > end { return false }
                return true
            }
            .sorted { $0.createdAt > $1.createdAt }

        guard offset < windowed.count else { return [] }
        return Array(windowed[offset ..< min(offset + limit, windowed.count)])
    }
}

// MARK: - Mock fixtures (one-screen sample; replaced by the live client)

/// Deterministic sample firmware history — realistic fixtures anchored to `now`
/// so the timeline and the relative range presets stay live (ADR-011). The live
/// client replaces this enum wholesale; the page contract above is unchanged.
enum SoftwareUpdatesMockData {
    static let vehicles: [SoftwareUpdatesVehicle] = [
        SoftwareUpdatesVehicle(id: 1, displayName: "Model 3", vin: "5YJ3E1EA7KF000001"),
        SoftwareUpdatesVehicle(id: 2, displayName: "Model Y", vin: "5YJYGDEE0LF000002")
    ]

    private static let day: TimeInterval = 86_400

    static func updates(vehicleID: Int64) -> [SoftwareUpdatesItem] {
        let now = Date()
        return [
            SoftwareUpdatesItem(
                id: 7, vehicleID: vehicleID, version: "2024.32.2",
                status: "scheduled", installedAt: nil,
                scheduledAt: now.addingTimeInterval(2 * day),
                createdAt: now.addingTimeInterval(-1 * day)
            ),
            SoftwareUpdatesItem(
                id: 6, vehicleID: vehicleID, version: "2024.32.1",
                status: "available", installedAt: nil, scheduledAt: nil,
                createdAt: now.addingTimeInterval(-2 * day)
            ),
            SoftwareUpdatesItem(
                id: 5, vehicleID: vehicleID, version: "2024.26.7",
                status: "installed", installedAt: now.addingTimeInterval(-6 * day),
                scheduledAt: nil, createdAt: now.addingTimeInterval(-6 * day)
            ),
            SoftwareUpdatesItem(
                id: 4, vehicleID: vehicleID, version: "2024.20.7",
                status: "installed", installedAt: now.addingTimeInterval(-40 * day),
                scheduledAt: nil, createdAt: now.addingTimeInterval(-40 * day)
            ),
            SoftwareUpdatesItem(
                id: 3, vehicleID: vehicleID, version: "2024.14.9",
                status: "installed", installedAt: now.addingTimeInterval(-82 * day),
                scheduledAt: nil, createdAt: now.addingTimeInterval(-82 * day)
            ),
            SoftwareUpdatesItem(
                id: 2, vehicleID: vehicleID, version: "2024.8.9",
                status: "installed", installedAt: now.addingTimeInterval(-140 * day),
                scheduledAt: nil, createdAt: now.addingTimeInterval(-140 * day)
            ),
            SoftwareUpdatesItem(
                id: 1, vehicleID: vehicleID, version: "2023.44.30.5",
                status: "installed", installedAt: now.addingTimeInterval(-220 * day),
                scheduledAt: nil, createdAt: now.addingTimeInterval(-220 * day)
            )
        ]
    }
}
