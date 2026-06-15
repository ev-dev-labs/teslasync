//
//  GasPriceAutoPollRouteRegistration.swift
//  TeslaSync — P4 page · P7 · page:admin/GasPriceAutoPoll (Apple)
//
//  Registers the native Gas Price Auto-Poll surface for the `.gasPrice` route so the app
//  shell's route host renders it (web `/gas-price`). Mirrors the peer admin route
//  registrations (AuditLog / FleetAPI): the `@Observable` model is built on the main actor
//  here and captured, so the escaping registry closure never constructs an isolated type.
//  The hosted surface's source seam defaults to a representative sample (the peer
//  `Sample*DataSource` convention); the live `useGasPriceStatus` query adapter is injected
//  in a later wiring phase without touching this page.
//

import Foundation
import SwiftUI

/// Builds the representative sample source the hosted surface mounts in production until
/// the live status-query adapter is wired (mirrors `SampleAuditLogDataSource` /
/// `SampleFleetAPIDataSource`). It emits a single resolved EIA snapshot so the page renders
/// genuine content, never a blank region (ADR-011).
public enum GasPriceAutoPollSampleSource {
    @MainActor
    public static func make() -> any GasPriceSettingsSource {
        InMemoryGasPriceSettingsSource(initial: GasPriceSettingsInput(status: GasPriceRecord(
            enabled: true,
            pollInterval: .weekly,
            currentPrice: 3.45,
            lastPollTime: Date(timeIntervalSince1970: 1_775_000_000)
        )))
    }
}

/// Registers `GasPriceAutoPollPage` for the `.gasPrice` route. The `AppRouteParser`
/// resolves `/gas-price` to this route automatically (canonical path segment), keeping the
/// page reachable + deep-linkable alongside the sibling admin pages.
public enum GasPriceAutoPollRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        source: any GasPriceSettingsSource = GasPriceAutoPollSampleSource.make()
    ) -> AppRouteHostRegistry {
        var registry = base
        let settings = GasPriceSettingsModel(source: source)
        let model = GasPriceAutoPollPageModel(settings: settings)
        registry.register(.gasPrice) {
            GasPriceAutoPollPage(model: model)
        }
        return registry
    }
}
