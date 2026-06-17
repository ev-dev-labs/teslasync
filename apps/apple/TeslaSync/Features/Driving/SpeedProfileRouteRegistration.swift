//
//  SpeedProfileRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple) — Navigation
//
//  Navigation registration for the `SpeedProfilePage` parity unit. The web route
//  `/speed-profile` has no dedicated `AppRoute` case, and the shared route host
//  (Sources/App) is outside this prompt's allowed-files scope, so — following the
//  accepted sibling precedent (RouteEfficiency / TripsReplay / TeslaChargingSessions)
//  — the page is delivered as a `NavigationStack`-ready `View` plus a typed deep-link
//  `NavigationDestination`: a host stack adopts `.speedProfileDestination()` and
//  pushes a `SpeedProfileLink()` to open the speed-profile surface, reachable +
//  deep-linkable on the macOS / iPad detail column and the iPhone stack
//  (ADR-002/006), without widening the shared enum.
//

import SwiftUI

/// The typed deep-link value for the speed-profile screen (web `/speed-profile`).
struct SpeedProfileLink: Hashable {}

extension View {
    /// Registers `SpeedProfilePage` as the `NavigationDestination` for a
    /// `SpeedProfileLink`, so any host stack can deep-link into the speed-profile
    /// surface (web `/speed-profile`).
    func speedProfileDestination(
        dataSource: @escaping @Sendable () -> any SpeedProfileDataSource = { SampleSpeedProfileDataSource() }
    ) -> some View {
        navigationDestination(for: SpeedProfileLink.self) { _ in
            SpeedProfilePage(model: SpeedProfilePageModel(dataSource: dataSource()))
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen without constructing the model.
enum SpeedProfileRouteRegistration {
    /// Builds the speed-profile screen with the given data source (default = sample).
    @MainActor
    static func make(
        dataSource: any SpeedProfileDataSource = SampleSpeedProfileDataSource()
    ) -> SpeedProfilePage {
        SpeedProfilePage(model: SpeedProfilePageModel(dataSource: dataSource))
    }
}
