//
//  BrowserNotificationsRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · notifications/BrowserNotifications (Apple) — Navigation
//
//  Navigation registration for the `BrowserNotificationsPage` parity unit. The web route
//  `/notifications/browser` has no dedicated `AppRoute` case, and the shared route host
//  (Sources/App) is outside this prompt's allowed-files scope, so — following the accepted
//  sibling precedent (SpeedProfile / TripsReplay / TeslaChargingSessions) — the page is
//  delivered as a `NavigationStack`-ready `View` plus a typed deep-link
//  `NavigationDestination`: a host stack adopts `.browserNotificationsDestination()` and
//  pushes a `BrowserNotificationsLink()` to open the surface, reachable + deep-linkable on
//  the macOS / iPad detail column and the iPhone stack (ADR-002/006), without widening the
//  shared enum.
//

import SwiftUI

/// The typed deep-link value for the browser-notifications screen (web `/notifications/browser`).
struct BrowserNotificationsLink: Hashable {}

extension View {
    /// Registers `BrowserNotificationsPage` as the `NavigationDestination` for a
    /// `BrowserNotificationsLink`, so any host stack can deep-link into the
    /// browser-notifications surface (web `/notifications/browser`).
    func browserNotificationsDestination() -> some View {
        navigationDestination(for: BrowserNotificationsLink.self) { _ in
            BrowserNotificationsPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model.
enum BrowserNotificationsRouteRegistration {
    /// Builds the browser-notifications screen, optionally with an injected model (default
    /// = the production model wired to the live OS services).
    @MainActor
    static func make(
        model: BrowserNotificationsPageModel = BrowserNotificationsPageModel()
    ) -> BrowserNotificationsPage {
        BrowserNotificationsPage(model: model)
    }
}
