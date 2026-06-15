import SwiftUI

/// Registers the native Region & API surface for the `.teslaRegion` route so the app
/// shell's route host renders it (web `/tesla-region`). Mirrors
/// `TeslaOrdersRouteRegistration` / `SchemaDriftRouteRegistration`: the `@Observable`
/// `RegionSettingsModel` is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// `/tesla-region` is a top-level web route in the Account side-nav group, so it maps
/// directly to the `.teslaRegion` `AppRoute` — the parser keys on the first path
/// segment, so no alias is needed — and is reachable via the Account-group sidebar
/// entry and any `/tesla-region` deep link.
///
/// The bound `RegionSettingsSource` defaults to a representative local seed (mirroring
/// the sibling Tesla Orders' `sampleSource` default) so the page renders its populated
/// state out of the box. It is NOT production telemetry: production composition injects
/// the shared P1/S8 source over the KMP core (web `useTeslaUserRegion` +
/// `useRefreshTeslaRegion`).
public enum TeslaRegionRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        source: (any RegionSettingsSource)? = nil
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = RegionSettingsModel(source: source ?? sampleSource())
        registry.register(.teslaRegion) {
            TeslaRegionPage(model: model)
        }
        return registry
    }

    /// A representative local seed used as the page default until the KMP-backed
    /// source is injected at composition time. Seeds the resolved region + Fleet API
    /// base URL + a sync timestamp so the populated grid renders out of the box; NOT
    /// production data.
    @MainActor
    static func sampleSource() -> any RegionSettingsSource {
        InMemoryRegionSettingsSource(
            initial: RegionSettingsInput(
                config: RegionRecord(
                    region: "na",
                    fleetAPIBaseURL: "https://fleet-api.prd.na.vn.cloud.tesla.com",
                    fetchedAt: Date(timeIntervalSince1970: 1_775_000_000)
                ),
                connection: .live
            )
        )
    }
}
