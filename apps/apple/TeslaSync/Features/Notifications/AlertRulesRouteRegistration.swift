//
//  AlertRulesRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Navigation
//
//  Navigation registration for the parity unit `AlertRulesPage` (web route
//  `/notifications/rules`). The value-less `AppRoute` enum's `.notifications` host
//  is owned by the alerts inbox, and `/notifications/rules` is a sibling alerts
//  surface, so — mirroring the sibling unrouted `DrivingDynamicsRouteRegistration`
//  — the native shell models it as a typed `NavigationDestination`: a host stack
//  adopts `.alertRulesDestination()` and pushes an `AlertRulesLink` to open it,
//  while the deep-link path resolves through `AppRouteParser`
//  (`"/notifications/rules": .notifications`, like `/alerts`). This keeps the page
//  reachable + deep-linkable on both the macOS/iPad detail column and the iPhone
//  stack without widening the enum. The `@Observable` model is built inside the
//  main-actor view builder, so the escaping destination/data-source closure stays
//  free of business logic.
//

import SwiftUI

/// Navigation value that opens the native Alert Rules page.
struct AlertRulesLink: Hashable, Sendable {}

extension View {
    /// Registers `AlertRulesPage` as the `NavigationDestination` for an
    /// `AlertRulesLink`, so any host stack can deep-link into the page.
    func alertRulesDestination(
        dataSource: @escaping @Sendable () -> any AlertRulesDataSource = { SampleAlertRulesDataSource() }
    ) -> some View {
        navigationDestination(for: AlertRulesLink.self) { _ in
            AlertRulesPage(model: AlertRulesPageModel(dataSource: dataSource()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for
/// hosts that want a ready-built screen (e.g., the macOS detail column or a
/// notifications-hub link target) without constructing the model.
enum AlertRulesRouteRegistration {
    /// Builds the screen with the given data source (default = sample fixture).
    @MainActor
    static func make(
        dataSource: any AlertRulesDataSource = SampleAlertRulesDataSource()
    ) -> AlertRulesPage {
        AlertRulesPage(model: AlertRulesPageModel(dataSource: dataSource))
    }
}
