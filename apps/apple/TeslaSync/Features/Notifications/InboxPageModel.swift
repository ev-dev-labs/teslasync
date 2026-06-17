//
//  InboxPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Inbox (Apple) — View Model
//
//  The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
//
//  The web `InboxPage` (`web/src/features/notifications/pages/InboxPage.tsx`) is a thin
//  `PageContainer` (title + subtitle + `copyLink` + a "View archived" action) that hosts
//  `<InboxBody archived={false} vehicles rules/>`. This model mirrors that exactly — it exposes
//  the three web i18n keys the page renders, the copy-link share URL, the route the "View
//  archived" action targets, and owns the embedded inbox's `@Observable` `InboxBodyModel` fixed
//  to the active (non-archived) tab (web `archived={false}`).
//
//  The web page fetches `vehicles` (`useVehicles`) + `rules` (`useAlertRules`) and passes them
//  into `<InboxBody/>`; natively those reach the inbox through its `InboxSource` snapshot, so
//  they are surfaced here (`vehicles` / `rules`) under the same web hook call-site names.
//  Previews/tests inject an in-memory source; production injects the shared KMP notification
//  bindings through the `InboxSource` + `InboxActionsPerforming` seams.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class InboxPageModel {
    /// Web `t('notifications.inbox.title', 'Inbox')` — page heading + `usePageTitle`.
    public let titleKey: LocalizedStringKey = "notifications.inbox.title"

    /// Web `t('notifications.inbox.subtitle', 'Recent notifications from your alert rules.')`.
    public let subtitleKey: LocalizedStringKey = "notifications.inbox.subtitle"

    /// Web `t('notifications.inbox.viewArchived', 'View archived')` — the actions-slot link.
    public let viewArchivedKey: LocalizedStringKey = "notifications.inbox.viewArchived"

    /// The embedded inbox surface, fixed to the active tab (web `<InboxBody archived={false}/>`).
    /// Renders every web data state (loading / error / empty / content) itself, with the active
    /// bulk-action set (Mark read · Archive · Delete) for non-archived rows.
    public let inbox: InboxBodyModel

    public init(
        source: (any InboxSource)? = nil,
        actions: (any InboxActionsPerforming)? = nil
    ) {
        let resolvedSource = source ?? SampleInbox.makeSource()
        let resolvedActions = actions ?? SampleInbox.makeActions()
        inbox = InboxBodyModel(source: resolvedSource, archived: false, actions: resolvedActions)
    }

    /// Web `useVehicles()` — the vehicle directory the inbox resolves each row's name/timezone
    /// against (delivered through the inbox source snapshot, web `<InboxBody vehicles/>`).
    public var vehicles: [InboxVehicle] {
        inbox.vehicles
    }

    /// Web `useAlertRules()` — the alert-rule set the inbox resolves each row's severity/name/
    /// drill-through against (delivered through the inbox source snapshot, web `<InboxBody rules/>`).
    public var rules: [InboxRule] {
        inbox.rules
    }

    /// The shareable deep link the copy-link affordance copies — the native parity of the web
    /// `copyLink` (`window.location.href`); here the page's canonical web route, which
    /// `AppRouteParser` deep-link-aliases back to `.notifications`.
    public let shareURL: String = "/notifications/inbox"

    /// The route the "View archived" affordance navigates to. Web links to
    /// `/notifications/archived`; natively that is `.notificationsArchived`.
    public let viewArchivedRoute: AppRoute = .notificationsArchived

    /// The page has no fetch of its own — the hosted inbox owns its query lifecycle via
    /// `start()`/`stop()` on appear/disappear. Exposed for the page-scaffold async contract; it
    /// re-runs the inbox's underlying query (web refetch).
    public func load() async {
        inbox.refresh()
    }

    /// Re-runs the hosted inbox's query (web refetch).
    public func refresh() {
        inbox.refresh()
    }
}
