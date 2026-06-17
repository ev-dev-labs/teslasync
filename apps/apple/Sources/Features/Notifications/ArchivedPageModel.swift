import Observation
import SwiftUI

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
///
/// The web `ArchivedPage` (`web/src/features/notifications/pages/ArchivedPage.tsx`) is a thin
/// `PageContainer` (title + subtitle + `copyLink` + a "Back to inbox" action) that hosts
/// `<InboxBody archived vehicles rules/>`. This model mirrors that exactly — it exposes the
/// three web i18n keys the page renders, the copy-link share URL, the route the back action
/// targets, and owns the embedded inbox's `@Observable` `InboxBodyModel` fixed to the archived
/// tab (web `archived={true}`).
///
/// The web page fetches `vehicles` (`useVehicles`) + `rules` (`useAlertRules`) and passes them
/// into `<InboxBody/>`; natively those reach the inbox through its `InboxSource` snapshot, so
/// they are surfaced here (`vehicles` / `rules`) for the same call-site names. Previews/tests
/// inject an in-memory source; production injects the shared KMP notification bindings through
/// the `InboxSource` + `InboxActionsPerforming` seams.
@MainActor
@Observable
public final class ArchivedPageModel {
    /// Web `t('notifications.archived.title', 'Archived notifications')`.
    public let titleKey: LocalizedStringKey = "notifications.archived.title"

    /// Web `t('notifications.archived.subtitle', 'Notifications you previously archived. …')`.
    public let subtitleKey: LocalizedStringKey = "notifications.archived.subtitle"

    /// Web `t('notifications.archived.backToInbox', 'Back to inbox')`.
    public let backToInboxKey: LocalizedStringKey = "notifications.archived.backToInbox"

    /// The embedded inbox surface, fixed to the archived tab (web `<InboxBody archived/>`).
    /// Renders every web data state (loading / error / empty / content) itself, swapping the
    /// bulk-action set Archive → Restore for archived rows.
    public let inbox: InboxBodyModel

    public init(
        source: (any InboxSource)? = nil,
        actions: (any InboxActionsPerforming)? = nil
    ) {
        let resolvedSource = source ?? SampleArchivedInbox.makeSource()
        let resolvedActions = actions ?? SampleArchivedInbox.makeActions()
        inbox = InboxBodyModel(source: resolvedSource, archived: true, actions: resolvedActions)
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
    /// `copyLink` (`window.location.href`); here the page's canonical route path.
    public var shareURL: String {
        AppRoute.notificationsArchived.path
    }

    /// The route the "Back to inbox" affordance navigates to. Web links to `/notifications/inbox`;
    /// natively `/notifications` is the inbox hub (`LegacyNotificationsRedirect` forwards
    /// `/notifications` → `/notifications/inbox`), so the back action targets `.notifications`.
    public let backToInboxRoute: AppRoute = .notifications

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
