//
//  TeslaFeatureFlagsRouteRegistration.swift
//  TeslaSync — P4 page · P7 · page:admin/TeslaFeatureFlags (Apple)
//
//  Registers the native Tesla Feature Flags surface for the `.teslaFeatures` route so the
//  app shell's route host renders it (web `/tesla-features`). Mirrors the peer admin route
//  registrations (GasPriceAutoPoll / TeslaOrders): the `@Observable` model is built on the
//  main actor here and captured, so the escaping registry closure never constructs an
//  isolated type.
//
//  `/tesla-features` is a top-level web route in the Account side-nav group, so it maps
//  directly to the `.teslaFeatures` `AppRoute` — the parser keys on the first path segment,
//  so no alias is needed — and is reachable via the Account-group sidebar entry and any
//  `/tesla-features` deep link.
//
//  The hosted surface's source seam defaults to a representative sample (the peer
//  `Sample*DataSource` convention); the live `useTeslaFeatureConfig` query adapter is
//  injected in a later wiring phase without touching this page.
//

import Foundation
import SwiftUI

/// Builds the representative sample source the hosted surface mounts in production until
/// the live feature-config query adapter is wired (mirrors `GasPriceAutoPollSampleSource`
/// / `TeslaOrdersRouteRegistration.sampleSource`). It emits a single resolved feature-config
/// snapshot — exercising object-with-details, enabled/disabled, and bare primitive values —
/// so the page renders genuine content, never a blank region (ADR-011).
public enum TeslaFeatureFlagsSampleSource {
    @MainActor
    public static func make() -> any FeatureTogglesSource {
        InMemoryFeatureTogglesSource(initial: FeatureTogglesUpdate(
            status: .loaded,
            connection: .live,
            config: [
                "BIDIRECTIONAL_CHARGING": .object(["enabled": .bool(false)]),
                "ENDPOINTS": .object([
                    "enabled": .bool(true),
                    "VEHICLE_DATA": .string("api/1/vehicles/{id}/vehicle_data"),
                    "max_calls": .number(200)
                ]),
                "MOBILE_ACCESS": .bool(true),
                "SCHEDULED_CHARGING": .number(0),
                "REGION": .string("NA")
            ],
            fetchedAt: Date(timeIntervalSince1970: 1_775_000_000)
        ))
    }
}

/// Registers `TeslaFeatureFlagsPage` for the `.teslaFeatures` route. The `AppRouteParser`
/// resolves `/tesla-features` to this route automatically (canonical path segment), keeping
/// the page reachable + deep-linkable alongside the sibling Account-group pages.
public enum TeslaFeatureFlagsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        source: any FeatureTogglesSource = TeslaFeatureFlagsSampleSource.make()
    ) -> AppRouteHostRegistry {
        var registry = base
        let toggles = FeatureTogglesModel(source: source)
        let model = TeslaFeatureFlagsPageModel(toggles: toggles)
        registry.register(.teslaFeatures) {
            TeslaFeatureFlagsPage(model: model)
        }
        return registry
    }
}
