//
//  LiveTelemetryPanels.Projector.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The aggregate projection + projector that fans one `LiveTelemetryPanelsUpdate` out to
//  the seven panel projectors (defined in LiveTelemetryPanels.Panels.swift +
//  LiveTelemetryPanels.MorePanels.swift). Foundation-only.
//

import Foundation

// MARK: - Aggregate projection + projector

/// The fully-projected, view-ready section derived from one `LiveTelemetryPanelsUpdate`:
/// the seven panel projections + the freshness age label + whether any telemetry resolved
/// (drives the surface-level empty state).
public struct LiveTelemetryPanelsProjection: Equatable, Sendable {
    public let powertrain: LTPPowertrainProjection
    public let climate: LTPClimateProjection
    public let security: LTPSecurityProjection
    public let vehicleState: LTPVehicleStateProjection
    public let tire: LTPTireProjection
    public let energyCharging: LTPEnergyChargingProjection
    public let mediaNav: LTPMediaNavProjection
    public let ageLabel: String
    public let hasAnyTelemetry: Bool
}

/// Pure projector: `LiveTelemetryPanelsUpdate` → `LiveTelemetryPanelsProjection`. Fans the
/// snapshot out to the seven panel projectors, each reproducing its web panel VERBATIM.
public enum LiveTelemetryPanelsProjector {
    public static func project(update: LiveTelemetryPanelsUpdate, now: Date = Date()) -> LiveTelemetryPanelsProjection {
        let units = update.units
        return LiveTelemetryPanelsProjection(
            powertrain: LTPPowertrainProjection.project(update.motor, units),
            climate: LTPClimateProjection.project(update.climate, units),
            security: LTPSecurityProjection.project(
                update.security,
                remoteStartEnabled: update.remoteStartEnabled,
                units
            ),
            vehicleState: LTPVehicleStateProjection.project(update.live, sseConnected: update.sseConnected, units),
            tire: LTPTireProjection.project(update.tire, units),
            energyCharging: LTPEnergyChargingProjection.project(update.charging, units),
            mediaNav: LTPMediaNavProjection.project(update.media, update.location, units),
            ageLabel: LTPRelativeTime.formatAge(update.updatedAt, now: now),
            hasAnyTelemetry: update.hasAnyTelemetry
        )
    }
}
