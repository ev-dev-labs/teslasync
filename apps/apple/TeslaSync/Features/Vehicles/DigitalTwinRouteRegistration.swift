//
//  DigitalTwinRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/DigitalTwin (Apple) — Navigation
//
//  Navigation registration for the `DigitalTwin` parity unit. The web route `/digital-twin` is
//  modeled natively as a typed `NavigationDestination` value: a host stack adopts
//  `.digitalTwinDestination()` and pushes a `DigitalTwinLink()` to open the page, so it is reachable
//  + deep-linkable on the macOS / iPad detail column and the iPhone stack (ADR-002/006). The
//  `@Observable` model is built inside the main-actor view builder, keeping the escaping destination /
//  data-source closures free of business logic (ADR-004). Mirrors the sibling
//  `VehicleDetailRouteRegistration`.
//

import SwiftUI

/// Typed deep-link value for the Digital Twin screen (web `/digital-twin`). The route takes no
/// parameters — the active vehicle is resolved by the page's selector — so the link is a marker value.
struct DigitalTwinLink: Hashable, Sendable {}

extension View {
    /// Registers `DigitalTwinPage` as the `NavigationDestination` for a `DigitalTwinLink`, so any host
    /// stack can deep-link into the Digital Twin (web `/digital-twin`).
    func digitalTwinDestination(
        dataSource: @escaping @Sendable () -> any DigitalTwinDataSource = { SampleDigitalTwinDataSource() }
    ) -> some View {
        navigationDestination(for: DigitalTwinLink.self) { _ in
            DigitalTwinPage(dataSource: dataSource())
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a ready-built
/// screen (e.g. a sidebar row's navigation target) without constructing the model.
enum DigitalTwinRouteRegistration {
    /// Builds the Digital Twin screen with the given data source (default = sample).
    @MainActor
    static func make(
        dataSource: any DigitalTwinDataSource = SampleDigitalTwinDataSource()
    ) -> DigitalTwinPage {
        DigitalTwinPage(dataSource: dataSource)
    }
}
