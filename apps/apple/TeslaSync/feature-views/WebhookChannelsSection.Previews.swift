//
//  WebhookChannelsSection.Previews.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  channel list), content + an inline test result, empty (resolved, no webhooks →
//  web `EmptyState`), loading (skeleton chrome), error (fetch failed → retry), and
//  the stale / offline freshness variants — plus the add/edit form sheet and the
//  signature-preview branches. Preview-only; excluded from release via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentWebhookTelemetry: WebhookChannelsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample webhook channels for the populated previews.
    private enum WebhookPreviewData {
        static let channels: [WebhookChannel] = [
            WebhookChannel(
                channelID: 1, name: "Discord #alerts", enabled: true,
                url: "https://discord.com/api/webhooks/123456789/abcdefgABCDEFG", method: .post
            ),
            WebhookChannel(
                channelID: 2, name: "Home Assistant", enabled: false,
                url: "https://ha.local/api/webhook/teslasync-events", method: .put
            ),
            WebhookChannel(
                channelID: 3, name: "n8n automation", enabled: true,
                url: "https://n8n.example.com/webhook/teslasync", method: .patch
            )
        ]

        static let successResult = WebhookTestOutcome(
            success: true, statusCode: 204, latencyMs: 137,
            bodyPreview: "{\"ok\":true}", truncated: false, signature: "sha256=a1b2c3d4e5f6"
        )
    }

    @MainActor
    private func webhookPreview(
        _ update: WebhookChannelsUpdate,
        configure: (WebhookChannelsSectionModel) -> Void = { _ in }
    ) -> WebhookChannelsSection {
        let model = WebhookChannelsSectionModel(
            source: InMemoryWebhookChannelsSource(initial: update),
            telemetry: SilentWebhookTelemetry()
        )
        model.start()
        configure(model)
        return WebhookChannelsSection(model: model)
    }

    #Preview("Content") {
        ScrollView {
            webhookPreview(
                WebhookChannelsUpdate(status: .loaded, channels: WebhookPreviewData.channels, connection: .live)
            )
            .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Content + test result") {
        ScrollView {
            webhookPreview(
                WebhookChannelsUpdate(status: .loaded, channels: WebhookPreviewData.channels, connection: .live)
            ) { model in
                model.test(1)
            }
            .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Empty") {
        ScrollView {
            webhookPreview(WebhookChannelsUpdate(status: .loaded, channels: [], connection: .live))
                .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Loading") {
        ScrollView {
            webhookPreview(WebhookChannelsUpdate(status: .loading, channels: [], connection: .live))
                .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Error") {
        ScrollView {
            webhookPreview(
                WebhookChannelsUpdate(status: .failed("Request timed out"), channels: [], connection: .live)
            )
            .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Stale") {
        ScrollView {
            webhookPreview(
                WebhookChannelsUpdate(status: .loaded, channels: WebhookPreviewData.channels, connection: .stale)
            )
            .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Offline") {
        ScrollView {
            webhookPreview(
                WebhookChannelsUpdate(status: .loaded, channels: WebhookPreviewData.channels, connection: .offline)
            )
            .padding()
        }
        .frame(maxWidth: 620)
    }

    #Preview("Form — add") {
        let model = WebhookChannelsSectionModel(
            source: InMemoryWebhookChannelsSource(),
            telemetry: SilentWebhookTelemetry()
        )
        return WebhookFormSheet(model: model, seed: .empty)
    }

    #Preview("Form — edit") {
        let model = WebhookChannelsSectionModel(
            source: InMemoryWebhookChannelsSource(),
            telemetry: SilentWebhookTelemetry()
        )
        return WebhookFormSheet(model: model, seed: .edit(WebhookPreviewData.channels[0]))
    }

    #Preview("Signature preview states") {
        VStack(alignment: .leading, spacing: 16) {
            WebhookSignaturePreviewView(state: .empty)
            WebhookSignaturePreviewView(state: .loading)
            WebhookSignaturePreviewView(state: .loaded("sha256=8f2a9c1b7d6e5f4a3b2c1d0e"))
            WebhookSignaturePreviewView(state: .failed("secret is required"))
        }
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }
#endif
