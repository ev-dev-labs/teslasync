//
//  VehicleDetailDataSource.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleDetail (Apple) — KMP-core seam
//
//  The single data seam for the VehicleDetail page (ADR-004). Each method keeps its
//  web TanStack hook name so the call sites in `VehicleDetailPageModel` read like the
//  React page. Today the sample implementations resolve from in-memory fixtures; when
//  the generated KMP client lands (P1/S2-S3) only these bodies change — the model,
//  the section-boundary contract, and the view stay untouched.
//

import Foundation

// MARK: - Seam protocol (web hooks kept by name)

/// Async data seam for `VehicleDetailPage`, mirroring the page's web hooks.
protocol VehicleDetailDataSource: Sendable {
    /// `useVehicleSettings(vehicleId)` → `GET /vehicles/{vehicleId}/settings`. Returns
    /// the resolver's full effective per-key payload (the whitelist is always complete).
    func useVehicleSettings(vehicleID: Int64) async throws -> VehicleDetailSettingsResponse

    /// The page's wake action (web `wakeMutation` → `POST /vehicles/{vehicleId}/wake`).
    /// Throwing surfaces the `vehicles.detail.wakeFailed` path; success the wake toast.
    func wakeVehicle(vehicleID: Int64) async throws
}

// MARK: - Sample seam (one representative vehicle; replaced by the live client)

/// Resolved, representative settings payload + a wake action that succeeds. Used for
/// the default screen, previews, and the success-state gate evidence.
struct SampleVehicleDetailDataSource: VehicleDetailDataSource {
    /// Whether the sample wake action should fail (drives the error-toast preview).
    var wakeShouldFail = false

    func useVehicleSettings(vehicleID: Int64) async throws -> VehicleDetailSettingsResponse {
        VehicleDetailSettingsResponse(settings: [
            VehicleDetailSetting(
                key: "nickname",
                value: .text("Garage Rocket"),
                source: .override
            ),
            VehicleDetailSetting(
                key: "mute_until",
                value: .timestamp(Date(timeIntervalSinceNow: 3_600)),
                source: .override
            ),
            VehicleDetailSetting(
                key: "charge_cost_tariff_id",
                value: .text("home-night"),
                source: .user
            ),
            VehicleDetailSetting(
                key: "units_distance",
                value: .text("km"),
                source: .user
            ),
            VehicleDetailSetting(
                key: "units_temperature",
                value: .text("C"),
                source: .default
            ),
            VehicleDetailSetting(
                key: "units_energy",
                value: .text("kWh"),
                source: .default
            )
        ])
    }

    func wakeVehicle(vehicleID: Int64) async throws {
        if wakeShouldFail {
            throw VehicleDetailError.wakeRejected
        }
    }
}

// MARK: - Empty seam (resolver returns no rows → empty data state)

/// Resolver returns an empty whitelist — exercises the page's empty data state.
struct EmptyVehicleDetailDataSource: VehicleDetailDataSource {
    func useVehicleSettings(vehicleID: Int64) async throws -> VehicleDetailSettingsResponse {
        VehicleDetailSettingsResponse(settings: [])
    }

    func wakeVehicle(vehicleID: Int64) async throws {}
}

// MARK: - Failing seam (settings fetch throws → error data state)

/// The settings fetch fails — exercises the page's error data state + Retry.
struct FailingVehicleDetailDataSource: VehicleDetailDataSource {
    func useVehicleSettings(vehicleID: Int64) async throws -> VehicleDetailSettingsResponse {
        throw VehicleDetailError.settingsUnavailable
    }

    func wakeVehicle(vehicleID: Int64) async throws {
        throw VehicleDetailError.wakeRejected
    }
}

// MARK: - Errors

/// Seam errors surfaced to the model and projected into the localized data states.
enum VehicleDetailError: Error, LocalizedError {
    case settingsUnavailable
    case wakeRejected

    var errorDescription: String? {
        switch self {
        case .settingsUnavailable:
            return String(
                localized: "translation.vehicleSettings.error",
                defaultValue: "Could not load vehicle settings."
            )
        case .wakeRejected:
            return String(
                localized: "translation.vehicles.detail.wakeFailed",
                defaultValue: "Failed to wake vehicle"
            )
        }
    }
}
