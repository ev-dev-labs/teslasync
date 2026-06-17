//
//  TirePressureDataSource.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack query
//  shape so the call sites in `TirePressurePageModel` read like the React page:
//  `useTirePressureLatest` → GET /tire-pressure/latest, `useTirePressureHistory`
//  → GET /tire-pressure. Today the bodies resolve from a deterministic in-memory
//  fixture set; when the generated client lands (P1/S2-S3) only these bodies
//  change — the view and the derived state never touch the network.
//
//  Every pressure the fixtures emit is SI (Pa), exactly as the `/tire-pressure`
//  endpoints serve after Phase-42 normalisation.
//

import Foundation

// MARK: - Hook-named data methods (web parity at the call site)

extension TirePressurePageModel {
    /// Vehicle roster for the selector (web `useSelectedVehicle`).
    func loadVehicles() async -> [TirePressureVehicle] {
        TirePressureMockData.vehicles
    }

    /// `useTirePressureLatest` → GET /tire-pressure/latest?vehicle_id={id}
    func useTirePressureLatest(vehicleID: Int64) async -> TirePressureReading? {
        guard vehicleID > 0 else { return nil }
        return TirePressureMockData.latest(vehicleID: vehicleID)
    }

    /// `useTirePressureHistory` → GET /tire-pressure?vehicle_id={id}&start&end
    func useTirePressureHistory(
        vehicleID: Int64,
        start: Date?,
        end: Date
    ) async -> [TirePressureReading] {
        guard vehicleID > 0 else { return [] }
        return TirePressureMockData.history(vehicleID: vehicleID, start: start, end: end)
    }
}

// MARK: - Mock fixtures (one-screen sample; replaced by the live client)

/// Deterministic fixtures so every panel, gauge, chart, table row and warning
/// banner renders without a backend. Pressures are Pa (SI). The latest reading
/// carries a soft TPMS warning so the warning banner + summary exercise their
/// non-empty branches; the history seeds one hard and several soft warnings so
/// the table's Hard / Soft / Ok badges all appear.
enum TirePressureMockData {
    static let vehicles: [TirePressureVehicle] = [
        TirePressureVehicle(id: 1, displayName: "Model 3"),
        TirePressureVehicle(id: 2, displayName: "Model Y")
    ]

    /// Recommended-ish baseline per corner, with the front-left slightly soft so
    /// the gauges show a mix of `normal` and `low` states (web realism).
    private static func baseline(for vehicleID: Int64) -> [TirePosition: Double] {
        let offset = vehicleID == 2 ? 8_000.0 : 0.0
        return [
            .fl: 238_000 + offset, // soft-low → status `low`
            .fr: 292_000 + offset,
            .rl: 286_000 + offset,
            .rr: 279_000 + offset
        ]
    }

    /// The latest snapshot (web `/tire-pressure/latest`) — values only, with a
    /// soft warning active.
    static func latest(vehicleID: Int64) -> TirePressureReading {
        let corners = baseline(for: vehicleID)
        return TirePressureReading(
            id: -1,
            vehicleID: vehicleID,
            frontLeft: corners[.fl] ?? 0,
            frontRight: corners[.fr] ?? 0,
            rearLeft: corners[.rl] ?? 0,
            rearRight: corners[.rr] ?? 0,
            tpmsHardWarnings: nil,
            tpmsSoftWarnings: "{\"front_left\": true}",
            createdAt: Date()
        )
    }

    /// A 30-point history over ~30 days (oldest first within the generator);
    /// filtered to the requested `[start, end]` window so the range picker is live.
    static func history(vehicleID: Int64, start: Date?, end: Date) -> [TirePressureReading] {
        let corners = baseline(for: vehicleID)
        let calendar = Calendar.current
        let pointCount = 30

        let rows: [TirePressureReading] = (0 ..< pointCount).compactMap { index in
            let daysAgo = pointCount - index
            guard let timestamp = calendar.date(byAdding: .day, value: -daysAgo, to: end) else {
                return nil
            }
            // A gentle deterministic ripple (Pa) so the lines and table values move.
            let ripple = sin(Double(index) / 3.2) * 9_000
            let drift = Double(index) * 320

            let hard = index == 6 ? "{\"rear_right\": true}" : nil
            let soft = (index % 7 == 0 && index > 0) ? "{\"front_left\": true}" : nil

            return TirePressureReading(
                id: Int64(index + 1),
                vehicleID: vehicleID,
                frontLeft: (corners[.fl] ?? 0) + ripple + drift,
                frontRight: (corners[.fr] ?? 0) - ripple + drift,
                rearLeft: (corners[.rl] ?? 0) + ripple * 0.6 + drift,
                rearRight: (corners[.rr] ?? 0) - ripple * 0.4 + drift,
                tpmsHardWarnings: hard,
                tpmsSoftWarnings: soft,
                createdAt: timestamp
            )
        }

        guard let start else { return rows }
        return rows.filter { $0.createdAt >= start && $0.createdAt <= end }
    }
}
