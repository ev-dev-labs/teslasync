//
//  VehicleAccessRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — Navigation
//
//  Navigation registration for the `VehicleAccess` parity unit. The web route
//  `/vehicles/:id/access` is modeled natively as a typed `NavigationDestination` value: a host stack
//  adopts `.vehicleAccessDestination()` and pushes a `VehicleAccessLink(vehicleID:)` to open one
//  vehicle's access manager, so the page is reachable + deep-linkable on the macOS / iPad detail
//  column and the iPhone stack (ADR-002/006). The `@Observable` model is built inside the main-actor
//  view builder, keeping the escaping destination / data-source closures free of business logic
//  (ADR-004). Mirrors the sibling `VehicleDetailRouteRegistration` shape.
//

import SwiftUI

/// Typed deep-link value for one vehicle's access manager (web `/vehicles/:id/access`).
public struct VehicleAccessLink: Hashable, Sendable {
    public let vehicleID: Int64

    public init(vehicleID: Int64) {
        self.vehicleID = vehicleID
    }
}

public extension View {
    /// Registers `VehicleAccessPage` as the `NavigationDestination` for a `VehicleAccessLink`, so any
    /// host stack can deep-link into one vehicle's access manager (web `/vehicles/:id/access`).
    func vehicleAccessDestination(
        dataSource: @escaping @Sendable () -> any VehicleAccessPageDataSource = { SampleVehicleAccessPageDataSource() }
    ) -> some View {
        navigationDestination(for: VehicleAccessLink.self) { link in
            VehicleAccessPage(vehicleID: link.vehicleID, dataSource: dataSource())
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a ready-built
/// screen without constructing the model, plus a forwarder that resolves the web
/// `/vehicles/:id/access` path to a `VehicleAccessLink`.
public enum VehicleAccessRouteRegistration {
    /// Builds the access manager for a vehicle id with the given data source (default = sample).
    @MainActor
    public static func make(
        vehicleID: Int64,
        dataSource: any VehicleAccessPageDataSource = SampleVehicleAccessPageDataSource()
    ) -> VehicleAccessPage {
        VehicleAccessPage(vehicleID: vehicleID, dataSource: dataSource)
    }

    /// Resolves the web route `/vehicles/{id}/access` (with optional trailing slash / query) to a
    /// `VehicleAccessLink`; any other path returns `nil`.
    public static func link(forPath rawPath: String) -> VehicleAccessLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        let segments = normalized.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard segments.count == 3, segments[0] == "vehicles", segments[2] == "access",
              let vehicleID = Int64(segments[1])
        else {
            return nil
        }
        return VehicleAccessLink(vehicleID: vehicleID)
    }
}
