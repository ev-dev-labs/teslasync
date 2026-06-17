//
//  SafetyRouteRegistration.swift
//  TeslaSync — P4 page · P7 · settings/Safety (Apple) — Navigation
//
//  Navigation registration for the `SafetyPage` parity unit. The web route
//  `/settings/safety` is a standalone, deep-linkable route — it is NOT a sidebar
//  entry (web `App.tsx` routes it outside the nav config; it is reached from the
//  in-page link / a direct URL). Reproducing it as a sidebar item would be an
//  anti-parity addition, so — following the accepted sibling precedent for pages
//  under `TeslaSync/Features/` (Geofences / TirePressure / GuardMode) — the page is
//  delivered as a `NavigationStack`-ready `View` plus a typed `NavigationDestination`
//  value, rather than editing the shared `AppRoute` sidebar enum.
//

import SwiftUI

/// The typed deep-link value for the safety-settings screen (web `/settings/safety`).
struct SafetySettingsLink: Hashable {}

extension View {
    /// Registers `SafetyPage` as the `NavigationDestination` for a `SafetySettingsLink`,
    /// so any host stack can deep-link into the safety-settings screen
    /// (web `/settings/safety`).
    func safetySettingsDestination() -> some View {
        navigationDestination(for: SafetySettingsLink.self) { _ in
            SafetyPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want
/// a ready-built screen without constructing the model.
enum SafetyRouteRegistration {
    /// Builds the safety-settings screen (web `/settings/safety`).
    @MainActor
    static func make() -> SafetyPage {
        SafetyPage()
    }
}
