//
//  InboxRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Inbox (Apple) — Navigation
//
//  Registers the native Notifications Inbox surface for the `.notifications` route so the app
//  shell's route host renders it (web `/notifications/inbox`). Mirrors the sibling
//  `ArchivedRouteRegistration`: the `@Observable` model is built on the main actor here and
//  captured, so the escaping registry closure never constructs an isolated type. `onNavigate`
//  drives the page's "View archived" affordance through the shell selection (web `<Link>`).
//
//  `.notifications` is the native inbox host (web `/notifications` redirects to
//  `/notifications/inbox`); `AppRouteParser` additionally aliases `/notifications/inbox` →
//  `.notifications`, keeping the page reachable + deep-linkable and surfacing it in the
//  Operations sidebar group. It also completes the sibling Archived page's "Back to inbox"
//  affordance, which targets `.notifications`.
//

import SwiftUI

public enum InboxRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = InboxPageModel()
        registry.register(.notifications) {
            InboxPage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
