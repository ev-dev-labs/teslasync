//
//  TripDetailSampleData.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — Seam doubles
//
//  The data-source doubles that drive the page's four data states (ADR-011 — every state is a
//  real, reachable surface). The sample resolves an API-response-shaped trip so the success body
//  renders out of the box; the empty double resolves `nil` (web no-trip → `trips.detail.notFound`);
//  the failing double throws (retryable error). Today these resolve from in-memory fixtures; when
//  the generated KMP client lands (P1/S2-S3) only these bodies change — the model and view stay put.
//
//  Every value is SI (metres, watt-hours, seconds); the view converts at the render boundary.
//

import Foundation

// MARK: - Sample seam (one representative trip → success state)

/// A representative local seed used as the `TripDetailPageModel` / preview default until the
/// KMP-backed source is injected at composition time (ADR-004): a ~182 km weekend trip over two
/// days, 6 drives + 2 charge stops.
public struct SampleTripDetailDataSource: TripDetailDataSource {
    public init() {}

    public func useTrip(tripID: Int64) async throws -> TripDetailRecord? {
        let start = Date(timeIntervalSince1970: 1_717_900_000)
        return TripDetailRecord(
            id: tripID,
            vehicleID: 1,
            name: "Big Sur Weekend",
            startDate: start,
            endDate: start.addingTimeInterval(36 * 3_600),
            totalDistanceM: 182_400,
            totalEnergyWh: 34_120,
            totalDurationS: 2.6 * 3_600,
            totalCost: 11.4,
            driveCount: 6,
            chargeCount: 2
        )
    }
}

#if DEBUG
    /// Resolver returns no trip — exercises the page's empty data state (web `trips.detail.notFound`).
    public struct EmptyTripDetailDataSource: TripDetailDataSource {
        public init() {}

        public func useTrip(tripID _: Int64) async throws -> TripDetailRecord? {
            nil
        }
    }

    /// The trip fetch fails — exercises the page's retryable error state + Retry.
    public struct FailingTripDetailDataSource: TripDetailDataSource {
        public init() {}

        public func useTrip(tripID _: Int64) async throws -> TripDetailRecord? {
            throw TripDetailError.tripUnavailable
        }
    }
#endif

// MARK: - Errors

/// Seam errors surfaced to the model and projected into the localized error data state.
public enum TripDetailError: Error, LocalizedError {
    case tripUnavailable

    public var errorDescription: String? {
        String(
            localized: "translation.trips.detail.notFound",
            defaultValue: "Trip not found"
        )
    }
}
