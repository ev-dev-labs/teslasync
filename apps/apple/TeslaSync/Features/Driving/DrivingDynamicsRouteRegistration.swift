//
//  DrivingDynamicsRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Navigation
//
//  Navigation registration for the parity unit `DrivingDynamicsPage` (web route
//  `/driving-dynamics`). The value-less `AppRoute` enum's `.driving` host is owned
//  by `DriveScorePage`, and `/driving-dynamics` is a sibling driving surface, so —
//  mirroring the sibling unrouted `RouteEfficiencyRouteRegistration` — the native
//  shell models it as a typed `NavigationDestination`: a host stack adopts
//  `.drivingDynamicsDestination()` and pushes a `DrivingDynamicsLink` to open it,
//  while the deep-link path resolves through `AppRouteParser`
//  (`"/driving-dynamics": .driving`, like `/route-efficiency`). This keeps the page
//  reachable + deep-linkable on both the macOS/iPad detail column and the iPhone
//  stack without widening the enum. The `@Observable` model is built inside the
//  main-actor view builder, so the escaping destination/data-source closures stay
//  free of business logic.
//

import SwiftUI

/// Navigation value that opens the native Driving Dynamics page.
struct DrivingDynamicsLink: Hashable, Sendable {}

extension View {
    /// Registers `DrivingDynamicsPage` as the `NavigationDestination` for a
    /// `DrivingDynamicsLink`, so any host stack can deep-link into the page.
    func drivingDynamicsDestination(
        dataSource: @escaping @Sendable () -> any DrivingDynamicsDataSource = { SampleDrivingDynamicsDataSource() }
    ) -> some View {
        navigationDestination(for: DrivingDynamicsLink.self) { _ in
            DrivingDynamicsPage(model: DrivingDynamicsPageModel(dataSource: dataSource()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for
/// hosts that want a ready-built screen (e.g., the macOS detail column or a
/// driving-hub link target) without constructing the model.
enum DrivingDynamicsRouteRegistration {
    /// Builds the screen with the given data source (default = sample fixture).
    @MainActor
    static func make(
        dataSource: any DrivingDynamicsDataSource = SampleDrivingDynamicsDataSource()
    ) -> DrivingDynamicsPage {
        DrivingDynamicsPage(model: DrivingDynamicsPageModel(dataSource: dataSource))
    }
}
