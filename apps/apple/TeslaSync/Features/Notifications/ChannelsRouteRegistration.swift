//
//  ChannelsRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Channels (Apple) — Navigation
//
//  Navigation registration for the parity unit `ChannelsPage` (web route
//  `/notifications/channels`). The value-less `AppRoute` enum's `.notifications` host is owned by
//  the alerts inbox, and `/notifications/channels` is a sibling alerts surface, so — mirroring the
//  sibling `AlertRulesRouteRegistration` — the native shell models it as a typed
//  `NavigationDestination`: a host stack adopts `.channelsDestination()` and pushes a `ChannelsLink`
//  to open it. The deep-link path resolves through `AppRouteParser` (the generic first-segment
//  fallback already maps `/notifications/channels` → `.notifications`, like `/alerts`), so no
//  enum-widening edit is needed to keep the page reachable + deep-linkable on both the macOS/iPad
//  detail column and the iPhone stack. The `@Observable` model is built inside the main-actor view
//  builder / factory, so the page composes without business logic leaking into navigation.
//

import SwiftUI

/// Navigation value that opens the native Notification Channels page.
struct ChannelsLink: Hashable {}

extension View {
    /// Registers `ChannelsPage` as the `NavigationDestination` for a `ChannelsLink`, so any host
    /// stack can deep-link into the page (web route `/notifications/channels`).
    func channelsDestination() -> some View {
        navigationDestination(for: ChannelsLink.self) { _ in
            ChannelsRouteRegistration.make()
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column or a notifications-hub link target) without
/// constructing the model.
enum ChannelsRouteRegistration {
    /// Builds the screen with the given source (default = sample fixture).
    @MainActor
    static func make(source: (any NotificationChannelsSource)? = nil) -> ChannelsPage {
        ChannelsPage(model: ChannelsPageModel(source: source))
    }
}
