//
//  GeofencesPageRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Navigation
//
//  Navigation registration for the `GeofencesPage` parity unit. The web route
//  `/geofences` is modeled natively as a typed `NavigationDestination` value: a
//  host stack adopts `.geofencesDestination()` and pushes a `GeofencesLink()` to
//  open the geofences screen, so the page is reachable + deep-linkable on the
//  macOS / iPad detail column and the iPhone stack (ADR-002/006). The global
//  `AppRoute` enum (Sources/App) is outside this prompt's allowed-files scope, so —
//  following the accepted sibling precedent (TirePressure / GuardMode /
//  TeslaChargingSessions) — the page is delivered as a NavigationStack-ready `View`
//  plus this typed destination, rather than editing the shared route host.
//

import SwiftUI

/// The typed deep-link value for the geofences screen (web `/geofences`).
struct GeofencesLink: Hashable {}

extension View {
    /// Registers `GeofencesPage` as the `NavigationDestination` for a
    /// `GeofencesLink`, so any host stack can deep-link into the geofences screen
    /// (web `/geofences`).
    func geofencesDestination() -> some View {
        navigationDestination(for: GeofencesLink.self) { _ in
            GeofencesPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen without constructing the model.
enum GeofencesRouteRegistration {
    /// Builds the geofences screen (web `/geofences`).
    @MainActor
    static func make() -> GeofencesPage {
        GeofencesPage()
    }
}
