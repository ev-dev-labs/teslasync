import Observation
import SwiftUI

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
///
/// The web `WebhooksPage` (`web/src/features/notifications/pages/WebhooksPage.tsx`) owns no
/// data of its own: it is a `PageContainer` (title + subtitle + copyLink) wrapper that hosts
/// `<WebhookChannelsSection/>`. This model mirrors that exactly — it exposes the two web i18n
/// keys the page renders and owns the embedded section's `@Observable`
/// `WebhookChannelsSectionModel`, built over an injected `WebhookChannelsSource` seam
/// (previews/tests pass an in-memory source; production injects the shared KMP
/// notification-channel binding — web `useWebhookChannels`).
@MainActor
@Observable
public final class WebhooksPageModel {
    /// Web `t('notifications.webhooks.title', 'Webhooks')`.
    public let titleKey: LocalizedStringKey = "notifications.webhooks.title"

    /// Web `t('notifications.webhooks.subtitle', 'Custom HTTPS endpoints …')`.
    public let subtitleKey: LocalizedStringKey = "notifications.webhooks.subtitle"

    /// The embedded "Webhook channels" section's state holder (web `<WebhookChannelsSection/>`).
    public let section: WebhookChannelsSectionModel

    public init(
        source: (any WebhookChannelsSource)? = nil,
        telemetry: any WebhookChannelsTelemetry = OSLogWebhookChannelsTelemetry()
    ) {
        let resolved = source ?? SampleWebhookChannelsSource.makeSource()
        section = WebhookChannelsSectionModel(source: resolved, telemetry: telemetry)
    }

    /// The shareable deep link the copy-link affordance copies — the native parity of the web
    /// `copyLink` (`window.location.href`); here the page's canonical route path.
    public var shareURL: String {
        AppRoute.notificationsWebhooks.path
    }

    /// The page has no fetch of its own (the hosted section owns its query lifecycle via
    /// `start()`/`stop()` on appear/disappear); exposed for the page-scaffold async contract,
    /// it re-runs the section's underlying query (web refetch).
    public func load() async {
        section.refresh()
    }

    /// Re-runs the hosted section's query (web refetch).
    public func refresh() {
        section.refresh()
    }
}
