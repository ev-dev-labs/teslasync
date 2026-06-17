//
//  TeslaChargingSessionsRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Navigation
//
//  Navigation registration for the `TeslaChargingSessionsPage` parity unit. The web
//  route `/tesla-charging-sessions` is modeled natively as a typed
//  `NavigationDestination` value: a host stack adopts
//  `.teslaChargingSessionsDestination()` and pushes a `TeslaChargingSessionsLink()`
//  to open the fleet sessions screen, so the page is reachable + deep-linkable on
//  the macOS / iPad detail column and the iPhone stack (ADR-002/006). The global
//  `AppRoute` enum (Sources/App) is outside this prompt's allowed-files scope, so —
//  following the accepted sibling precedent (TirePressure / GuardMode / TripsReplay)
//  — the page is delivered as a NavigationStack-ready `View` plus this typed
//  destination, rather than editing the shared route host.
//

import SwiftUI

/// The typed deep-link value for the fleet charging-sessions screen (web
/// `/tesla-charging-sessions`).
struct TeslaChargingSessionsLink: Hashable {}

extension View {
    /// Registers `TeslaChargingSessionsPage` as the `NavigationDestination` for a
    /// `TeslaChargingSessionsLink`, so any host stack can deep-link into the fleet
    /// charging-sessions screen (web `/tesla-charging-sessions`).
    func teslaChargingSessionsDestination() -> some View {
        navigationDestination(for: TeslaChargingSessionsLink.self) { _ in
            TeslaChargingSessionsPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen without constructing the model.
enum TeslaChargingSessionsRouteRegistration {
    /// Builds the fleet charging-sessions screen.
    @MainActor
    static func make() -> TeslaChargingSessionsPage {
        TeslaChargingSessionsPage()
    }
}
