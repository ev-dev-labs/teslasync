//
//  QuietHoursRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/QuietHours (Apple) — Navigation
//
//  Navigation registration for the parity unit `QuietHoursPage` (web route
//  `/notifications/quiet-hours`). The value-less `AppRoute` enum's `.notifications` host is owned by
//  the alerts inbox, and `/notifications/quiet-hours` is a sibling alerts surface, so — mirroring the
//  sibling `ChannelsRouteRegistration` / `AlertRulesRouteRegistration` in this directory — the native
//  shell models it as a typed `NavigationDestination`: a host stack adopts `.quietHoursDestination()`
//  and pushes a `QuietHoursLink` to open it. The deep-link path resolves through `AppRouteParser`
//  (the generic first-segment fallback already maps `/notifications/quiet-hours` → `.notifications`,
//  like `/alerts`), so no enum-widening edit is needed to keep the page reachable + deep-linkable on
//  both the macOS/iPad detail column and the iPhone stack. The `@Observable` model is built inside the
//  main-actor view builder / factory, so the page composes without business logic leaking into
//  navigation.
//

import SwiftUI

/// Navigation value that opens the native Quiet Hours page.
struct QuietHoursLink: Hashable {}

extension View {
    /// Registers `QuietHoursPage` as the `NavigationDestination` for a `QuietHoursLink`, so any host
    /// stack can deep-link into the page (web route `/notifications/quiet-hours`).
    func quietHoursDestination() -> some View {
        navigationDestination(for: QuietHoursLink.self) { _ in
            QuietHoursRouteRegistration.make()
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column or a notifications-hub link target) without
/// constructing the model.
enum QuietHoursRouteRegistration {
    /// Builds the screen with the given sources (default = sample fixture + AI gate on).
    @MainActor
    static func make(
        panelSource: (any QuietHoursSource)? = nil,
        suggestionSource: (any QuietHoursSuggestionSource)? = nil
    ) -> QuietHoursPage {
        QuietHoursPage(model: QuietHoursPageModel(
            panelSource: panelSource,
            suggestionSource: suggestionSource
        ))
    }
}
