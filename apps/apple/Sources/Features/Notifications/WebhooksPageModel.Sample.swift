import Foundation

/// A representative local seed used as the page/preview default until the KMP-backed
/// notification-channel source is injected at composition time. It is NOT production data — it
/// exists so the hosted `WebhookChannelsSection` renders its populated state out of the box
/// (mirroring the sibling audit page's `SampleNotificationsAuditLogDataSource`). Production
/// replaces it with the shared KMP `useWebhookChannels` binding through the
/// `WebhookChannelsSource` seam (ADR-004 — no networking in the view).
public enum SampleWebhookChannelsSource {
    /// Builds an in-memory source pre-seeded with the sample channels in a live, loaded snapshot.
    @MainActor
    public static func makeSource() -> any WebhookChannelsSource {
        InMemoryWebhookChannelsSource(
            initial: WebhookChannelsUpdate(
                status: .loaded,
                channels: seed,
                connection: .live,
                updatedAt: Date(timeIntervalSince1970: 1_750_000_000)
            )
        )
    }

    /// Three representative receivers spanning the offered HTTP methods + an off channel.
    static let seed: [WebhookChannel] = [
        WebhookChannel(
            channelID: 1,
            name: "Discord #alerts",
            enabled: true,
            url: "https://discord.com/api/webhooks/123456789/abcdefgABCDEFG",
            method: .post
        ),
        WebhookChannel(
            channelID: 2,
            name: "Home Assistant",
            enabled: false,
            url: "https://ha.local/api/webhook/teslasync-events",
            method: .put
        ),
        WebhookChannel(
            channelID: 3,
            name: "n8n automation",
            enabled: true,
            url: "https://n8n.example.com/webhook/teslasync",
            method: .patch
        )
    ]
}
