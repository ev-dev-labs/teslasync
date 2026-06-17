//
//  ChannelsPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Channels (Apple) — View Model
//
//  The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
//
//  The web `ChannelsPage` (`web/src/features/notifications/pages/ChannelsPage.tsx`) owns no data
//  of its own: it is a `PageContainer` (title + subtitle + copyLink) wrapper that hosts
//  `<NotificationChannelsView/>`. This model mirrors that exactly — it exposes the two web i18n
//  keys the page renders and owns the embedded channels CRUD section's `@Observable`
//  `NotificationChannelsModel`, built over an injected `NotificationChannelsSource` seam
//  (previews/tests pass an in-memory source; production injects the shared KMP
//  notification-channel + stats bindings — web `useNotificationChannels` / `useNotificationStats`).
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class ChannelsPageModel {
    /// Web route `/notifications/channels` (`web/src/App.tsx`). Kept as a constant so the
    /// copy-link share URL and the navigation registration agree on one canonical path.
    public static let routePath = "/notifications/channels"

    /// Web `t('notifications.channels.title', 'Notification channels')`.
    public let titleKey: LocalizedStringKey = "notifications.channels.title"

    /// Web `t('notifications.channels.subtitle', 'Where to send notifications: …')`.
    public let subtitleKey: LocalizedStringKey = "notifications.channels.subtitle"

    /// The embedded notification-channels CRUD section's state holder
    /// (web `<NotificationChannelsView/>`).
    public let section: NotificationChannelsModel

    public init(
        source: (any NotificationChannelsSource)? = nil,
        telemetry: any NotificationChannelsTelemetry = OSLogNotificationChannelsTelemetry()
    ) {
        let resolved = source ?? SampleNotificationChannelsSource.makeSource()
        section = NotificationChannelsModel(source: resolved, telemetry: telemetry)
    }

    /// The shareable deep link the copy-link affordance copies — the native parity of the web
    /// `copyLink` (`window.location.href`); here the page's canonical route path.
    public var shareURL: String {
        Self.routePath
    }

    /// The page has no fetch of its own (the hosted section owns its query lifecycle via
    /// `start()`/`stop()` on appear/disappear); exposed for the page-scaffold async contract, it
    /// re-runs the section's underlying query (web refetch).
    public func load() async {
        section.refresh()
    }

    /// Re-runs the hosted section's query (web refetch).
    public func refresh() {
        section.refresh()
    }
}
