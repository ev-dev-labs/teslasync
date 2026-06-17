//
//  ChannelsPageModel.Sample.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Channels (Apple) — Sample seam
//
//  A representative local seed used as the page/preview default until the KMP-backed
//  notification-channel source is injected at composition time. It is NOT production data — it
//  exists so the hosted `NotificationChannelsView` renders its populated state out of the box
//  (mirroring the sibling `SampleWebhookChannelsSource`). Production replaces it with the shared
//  KMP `useNotificationChannels` + `useNotificationStats` bindings through the
//  `NotificationChannelsSource` seam (ADR-004 — no networking in the view).
//

import Foundation

public enum SampleNotificationChannelsSource {
    /// Builds an in-memory source pre-seeded with the sample channels + delivery stats in a live,
    /// loaded snapshot, so the hosted section opens on its populated `data` state.
    @MainActor
    public static func makeSource() -> any NotificationChannelsSource {
        InMemoryNotificationChannelsSource(
            initial: NotifChannelsInput(
                channels: seed,
                stats: seedStats,
                connection: .live
            )
        )
    }

    /// Three representative receivers spanning the offered channel kinds + an off channel, mirroring
    /// the web channels grid's configured state (`Discord` webhook, `Telegram` bot, disabled email).
    static let seed: [NotificationChannelData] = [
        NotificationChannelData(
            id: 1,
            kind: .discord,
            name: "Ops Discord",
            enabled: true,
            config: [ChannelConfigEntry(key: "webhook_url", value: "https://discord.com/api/webhooks/123/abc")]
        ),
        NotificationChannelData(
            id: 2,
            kind: .telegram,
            name: "Alerts Bot",
            enabled: true,
            config: [
                ChannelConfigEntry(key: "bot_token", value: "123456:ABC-DEF"),
                ChannelConfigEntry(key: "chat_id", value: "-1001234567890")
            ]
        ),
        NotificationChannelData(
            id: 3,
            kind: .email,
            name: "On-call Email",
            enabled: false,
            config: [
                ChannelConfigEntry(key: "smtp_host", value: "smtp.gmail.com"),
                ChannelConfigEntry(key: "smtp_port", value: "587"),
                ChannelConfigEntry(key: "smtp_password", value: "super-secret")
            ]
        )
    ]

    /// Delivery stats matching the seed (web `useNotificationStats`): 2 of 3 channels enabled.
    static let seedStats = NotifChannelStats(
        sent: 1284,
        failed: 12,
        pending: 3,
        enabledChannels: 2,
        totalChannels: 3
    )
}
