//
//  WebhookChannelsSection.Content.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  Static copy (the signature-preview sample envelope + the documented payload
//  variables), the diagnostics surface slug, and the VoiceOver summaries — split
//  from WebhookChannelsSection.Adapter.swift to respect the house file-length limit.
//  Pure (Foundation only) so it unit-tests without a bundle or a rendered view.
//

import Foundation

// MARK: - Static content (web `sampleBody` + payload-variable docs)

/// The static copy the surface composes: the signature-preview sample envelope and
/// the documented payload variables.
public enum WebhookChannelsContent {
    /// The representative JSON body the web `WebhookFormModal` memoizes as `sampleBody`
    /// to build a non-trivial signature preview. Reproduced byte-for-byte (compact,
    /// key order preserved) so the previewed HMAC matches the web's.
    public static let sampleSignatureBody =
        #"{"title":"Test event","message":"Hello from TeslaSync","source":"teslasync","test":true}"#

    /// One documented webhook payload variable (web `<li><code>title</code> — …</li>`):
    /// the literal JSON field name + its localized description.
    public struct PayloadVariable: Sendable, Equatable, Identifiable {
        public var code: String
        public var descriptionKey: String
        public var descriptionFallback: String
        public var id: String {
            code
        }

        public init(code: String, descriptionKey: String, descriptionFallback: String) {
            self.code = code
            self.descriptionKey = descriptionKey
            self.descriptionFallback = descriptionFallback
        }
    }

    /// The documented payload variables (web bullet list under "Available payload
    /// variables"). The field names are code tokens (not translated); the
    /// descriptions resolve through the i18n facade.
    public static let payloadVariables: [PayloadVariable] = [
        PayloadVariable(
            code: "title",
            descriptionKey: "webhookChannels.docs.var.title",
            descriptionFallback: "short headline of the event"
        ),
        PayloadVariable(
            code: "message",
            descriptionKey: "webhookChannels.docs.var.message",
            descriptionFallback: "long-form body of the event"
        ),
        PayloadVariable(
            code: "source",
            descriptionKey: "webhookChannels.docs.var.source",
            descriptionFallback: "always \"teslasync\""
        ),
        PayloadVariable(
            code: "timestamp",
            descriptionKey: "webhookChannels.docs.var.timestamp",
            descriptionFallback: "RFC3339 server-side time"
        )
    ]
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum WebhookChannelsSurface {
    public static let slug = "WebhookChannelsSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum WebhookChannelsAccessibility {
    /// One row's spoken summary: "{name}, {Enabled|Disabled}, {METHOD}, {url}".
    public static func rowLabel(
        _ channel: WebhookChannel,
        localize: (String, String) -> String
    ) -> String {
        let state = channel.enabled
            ? localize("webhookChannels.row.enabled", "Enabled")
            : localize("webhookChannels.row.disabled", "Disabled")
        return "\(channel.name), \(state), \(channel.method.display), \(channel.url)"
    }

    /// One test-result panel's spoken summary: success/failure + status + latency,
    /// plus the error message when present.
    public static func testResultLabel(
        _ outcome: WebhookTestOutcome,
        localize: (String, String) -> String
    ) -> String {
        let verdict = outcome.success
            ? localize("webhookChannels.test.success", "Success")
            : localize("webhookChannels.test.failure", "Failed")
        var parts = [
            verdict,
            localize("webhookChannels.test.status", "Status {{status}}")
                .replacingOccurrences(of: "{{status}}", with: WebhookFormat.integer(outcome.statusCode)),
            localize("webhookChannels.test.latency", "{{ms}} ms")
                .replacingOccurrences(of: "{{ms}}", with: WebhookFormat.integer(outcome.latencyMs))
        ]
        if let error = outcome.error, !error.isEmpty {
            parts.append(error)
        }
        return parts.joined(separator: ", ")
    }

    /// The section-level summary: title + channel count, or the friendly empty
    /// message when there are none.
    public static func sectionSummary(
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("webhookChannels.title", "Webhook channels")
        guard count > 0 else {
            let none = localize("webhookChannels.empty.title", "No webhooks yet")
            return "\(title): \(none)"
        }
        return "\(title): \(WebhookFormat.integer(count))"
    }
}
