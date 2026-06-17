//
//  TripDetailRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — Navigation
//
//  Navigation registration for the `TripDetail` parity unit. The web route `/trips/:id` is modeled
//  natively as a typed `NavigationDestination` value: a host stack adopts `.tripDetailDestination()`
//  and pushes a `TripDetailLink(tripID:)` to open one trip's detail, so the page is reachable +
//  deep-linkable on the macOS / iPad detail column and the iPhone stack (ADR-002/006). The
//  `@Observable` model is built inside the main-actor view builder, keeping the escaping destination
//  / data-source closures free of business logic (ADR-004). Mirrors the sibling
//  `TripsReplayRouteRegistration`.
//

import SwiftUI

/// Typed deep-link value for one trip's detail screen (web `/trips/:id`).
public struct TripDetailLink: Hashable, Sendable {
    public let tripID: Int64

    public init(tripID: Int64) {
        self.tripID = tripID
    }
}

public extension View {
    /// Registers `TripDetailPage` as the `NavigationDestination` for a `TripDetailLink`, so any host
    /// stack can deep-link into one trip's detail (web `/trips/:id`).
    func tripDetailDestination(
        dataSource: @escaping @Sendable () -> any TripDetailDataSource = { SampleTripDetailDataSource() }
    ) -> some View {
        navigationDestination(for: TripDetailLink.self) { link in
            TripDetailPage(tripID: link.tripID, dataSource: dataSource())
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a ready-built
/// screen (e.g. a trips-list row's navigation target) without constructing the model.
public enum TripDetailRouteRegistration {
    /// Builds the detail screen for a trip id with the given data source (default = sample).
    @MainActor
    public static func make(
        tripID: Int64,
        dataSource: any TripDetailDataSource = SampleTripDetailDataSource()
    ) -> TripDetailPage {
        TripDetailPage(tripID: tripID, dataSource: dataSource)
    }
}
