//
//  VehicleDetailRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleDetail (Apple) — Navigation
//
//  Navigation registration for the `VehicleDetail` parity unit. The web route
//  `/vehicles/:id` is modeled natively as a typed `NavigationDestination` value: a host
//  stack adopts `.vehicleDetailDestination()` and pushes a `VehicleDetailLink(vehicleID:)`
//  to open one vehicle's detail, so the page is reachable + deep-linkable on the
//  macOS / iPad detail column and the iPhone stack (ADR-002/006). The `@Observable`
//  model is built inside the main-actor view builder, keeping the escaping destination /
//  data-source closures free of business logic (ADR-004). Mirrors the sibling
//  `TripsReplayRouteRegistration`.
//

import SwiftUI

/// Typed deep-link value for one vehicle's detail screen (web `/vehicles/:id`).
struct VehicleDetailLink: Hashable, Sendable {
    let vehicleID: Int64
}

extension View {
    /// Registers `VehicleDetailPage` as the `NavigationDestination` for a
    /// `VehicleDetailLink`, so any host stack can deep-link into one vehicle's detail
    /// (web `/vehicles/:id`). `onOpenSection` wires each section-navigator row to the
    /// host's routing (web QuickLinks / inline section navigation).
    func vehicleDetailDestination(
        dataSource: @escaping @Sendable () -> any VehicleDetailDataSource = { SampleVehicleDetailDataSource() },
        onOpenSection: @escaping (VehicleDetailSectionKind) -> Void = { _ in }
    ) -> some View {
        navigationDestination(for: VehicleDetailLink.self) { link in
            VehicleDetailPage(
                vehicleID: link.vehicleID,
                dataSource: dataSource(),
                onOpenSection: onOpenSection
            )
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g. a vehicle list row's navigation target) without constructing
/// the model.
enum VehicleDetailRouteRegistration {
    /// Builds the detail screen for a vehicle id with the given data source (default = sample).
    @MainActor
    static func make(
        vehicleID: Int64,
        dataSource: any VehicleDetailDataSource = SampleVehicleDetailDataSource(),
        onOpenSection: @escaping (VehicleDetailSectionKind) -> Void = { _ in }
    ) -> VehicleDetailPage {
        VehicleDetailPage(vehicleID: vehicleID, dataSource: dataSource, onOpenSection: onOpenSection)
    }
}
