//
//  PrivacyRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:settings/Privacy (Apple) — Navigation
//
//  Navigation registration for the `PrivacyPage` parity unit (web route `/account/privacy`). The
//  value-less `AppRoute` enum has no dedicated `.accountPrivacy` case, and the shared route host
//  (`Sources/App`) is outside this prompt's allowed-files scope, so — following the sibling
//  precedent (`BrowserNotificationsRouteRegistration` / `QuietHoursRouteRegistration`) — the page is
//  delivered as a `NavigationStack`-ready `View` plus a typed deep-link `NavigationDestination`: a
//  host stack adopts `.privacyDestination()` and pushes a `PrivacyLink()` to open it. The deep-link
//  path resolves through `AppRouteParser`'s generic first-segment fallback (`/account` → `.settings`,
//  the page's "Account" side-nav category), so no enum-widening edit is needed to keep the page
//  reachable + deep-linkable on both the macOS/iPad detail column and the iPhone stack
//  (ADR-002/006). The `@Observable` model is built inside the main-actor view builder / factory, so
//  the page composes without persistence logic leaking into navigation.
//

import SwiftUI

/// The typed deep-link value for the native Privacy page (web `/account/privacy`).
struct PrivacyLink: Hashable {}

extension View {
    /// Registers `PrivacyPage` as the `NavigationDestination` for a `PrivacyLink`, so any host stack
    /// can deep-link into the privacy surface (web route `/account/privacy`).
    func privacyDestination() -> some View {
        navigationDestination(for: PrivacyLink.self) { _ in
            PrivacyRouteRegistration.make()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a ready-built
/// screen without constructing the model.
enum PrivacyRouteRegistration {
    /// Builds the privacy screen, optionally with an injected model (default = the production model
    /// wired to the local `UserDefaults`-backed stores).
    @MainActor
    static func make(model: PrivacyPageModel = PrivacyPageModel()) -> PrivacyPage {
        PrivacyPage(model: model)
    }
}
