//
//  SafetySettingsPageRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — Navigation
//
//  Navigation registration for the `SafetySettingsPage` parity unit. The web route
//  `/safety-settings` is already listed in the native nav catalog
//  (shared-surfaces/Layout.Nav.swift → nav("/safety-settings","Safety Settings",
//  "checkmark.shield.fill"); LayoutBreadcrumbs.Routes.swift → route("/safety-settings",
//  "routes.safetySettings","Safety Settings")). The global `AppRoute` enum
//  (Sources/App) is outside this prompt's allowed-files scope, so — following the
//  accepted sibling precedent (TirePressure / GuardMode / Geofences) — the page is
//  delivered as a NavigationStack-ready `View` plus this typed `NavigationDestination`,
//  rather than editing the shared route host.
//
//  Type names are deliberately prefixed `VehicleSafetySettings*` to avoid colliding
//  with `SafetySettingsLink` / `SafetyRouteRegistration` (Features/Settings), which
//  register the SEPARATE web `/settings/safety` page.
//

import SwiftUI

/// The typed deep-link value for the ADAS safety-settings screen (web `/safety-settings`).
struct VehicleSafetySettingsLink: Hashable {}

extension View {
    /// Registers `SafetySettingsPage` as the `NavigationDestination` for a
    /// `VehicleSafetySettingsLink`, so any host stack can deep-link into the ADAS
    /// safety-settings screen (web `/safety-settings`).
    func vehicleSafetySettingsDestination() -> some View {
        navigationDestination(for: VehicleSafetySettingsLink.self) { _ in
            SafetySettingsPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen without constructing the model.
enum VehicleSafetySettingsRouteRegistration {
    /// Builds the ADAS safety-settings screen (web `/safety-settings`).
    @MainActor
    static func make() -> SafetySettingsPage {
        SafetySettingsPage()
    }
}
