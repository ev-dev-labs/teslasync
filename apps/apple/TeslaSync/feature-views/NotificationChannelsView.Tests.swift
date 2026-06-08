//
//  NotificationChannelsView.Tests.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  Pure-core unit coverage for the NotificationChannelsView surface:
//    • Adapter — the channel-type catalog (web `CHANNEL_TYPES`), the secret masking
//      (web `k.includes('token'|'key'|'password')`), the save-payload normalisation
//      (web `buildChannelPayload`: SMTP port / recipients / method / headers / ntfy),
//      the name validation, and the config preview.
//    • Projection — `NotifChannelsProjection` across loading / empty / error / data and
//      the stats-skeleton branch.
//    • Accessibility — the VoiceOver card + stat summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store. The model + form-model coverage lives in NotificationChannelsView.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

// MARK: - Channel kind catalog (web `CHANNEL_TYPES`)

@MainActor
final class NotifChannelKindTests: XCTestCase {
    func testFromFallsBackToWebhookForUnknown() {
        XCTAssertEqual(NotifChannelKind.from("discord"), .discord)
        XCTAssertEqual(NotifChannelKind.from("pushover"), .pushover)
        XCTAssertEqual(NotifChannelKind.from("carrier-pigeon"), .webhook)
    }

    func testEveryKindHasLabelIconAndPalette() {
        for kind in NotifChannelKind.allCases {
            XCTAssertFalse(kind.labelFallback.isEmpty)
            XCTAssertFalse(kind.systemImage.isEmpty)
            XCTAssertTrue(kind.labelKey.hasPrefix("notifications.channels.kind."))
            XCTAssertGreaterThanOrEqual(kind.paletteIndex, 0)
        }
    }

    func testPaletteIndicesAreDistinct() {
        let indices = NotifChannelKind.allCases.map(\.paletteIndex)
        XCTAssertEqual(Set(indices).count, indices.count)
    }

    func testFieldSetsMatchWebCatalog() {
        XCTAssertEqual(NotifChannelKind.discord.fields.map(\.key), ["webhook_url"])
        XCTAssertEqual(NotifChannelKind.slack.fields.map(\.key), ["webhook_url"])
        XCTAssertEqual(NotifChannelKind.telegram.fields.map(\.key), ["bot_token", "chat_id"])
        XCTAssertEqual(
            NotifChannelKind.email.fields.map(\.key),
            ["smtp_host", "smtp_port", "smtp_username", "smtp_password", "from_address", "to_addresses"]
        )
        XCTAssertEqual(NotifChannelKind.webhook.fields.map(\.key), ["url", "method", "headers", "body_template"])
        XCTAssertEqual(NotifChannelKind.ntfy.fields.map(\.key), ["server_url", "topic"])
        XCTAssertEqual(NotifChannelKind.pushover.fields.map(\.key), ["user_key", "app_token"])
    }

    func testSecretFieldsAreMarkedSecure() {
        let secure = NotifChannelKind.pushover.fields.filter(\.secure).map(\.key)
        XCTAssertEqual(secure, ["user_key", "app_token"])
        XCTAssertTrue(NotifChannelKind.telegram.fields.first { $0.key == "bot_token" }?.secure ?? false)
    }
}

// MARK: - Secret masking (web `k.includes('token'|'key'|'password')`)

@MainActor
final class ChannelSecretTests: XCTestCase {
    func testIsSecretMatchesWebSubstrings() {
        XCTAssertTrue(ChannelSecret.isSecret("bot_token"))
        XCTAssertTrue(ChannelSecret.isSecret("user_key"))
        XCTAssertTrue(ChannelSecret.isSecret("smtp_password"))
        XCTAssertTrue(ChannelSecret.isSecret("API_KEY"))
        XCTAssertFalse(ChannelSecret.isSecret("webhook_url"))
        XCTAssertFalse(ChannelSecret.isSecret("chat_id"))
    }

    func testDisplayMasksSecretsOnly() {
        XCTAssertEqual(ChannelSecret.display(key: "bot_token", value: "123:ABC"), ChannelSecret.mask)
        XCTAssertEqual(ChannelSecret.display(key: "chat_id", value: "-100"), "-100")
    }

    func testConfigEntryDisplayValue() {
        XCTAssertEqual(ChannelConfigEntry(key: "app_token", value: "secret").displayValue, ChannelSecret.mask)
        XCTAssertEqual(ChannelConfigEntry(key: "topic", value: "alerts").displayValue, "alerts")
    }
}

// MARK: - Channel data (web `channelToFormConfig` preview)

@MainActor
final class NotificationChannelDataTests: XCTestCase {
    private func sample() -> NotificationChannelData {
        NotificationChannelData(
            id: 7,
            kind: .email,
            name: "Ops",
            enabled: true,
            config: [
                ChannelConfigEntry(key: "smtp_host", value: "smtp.gmail.com"),
                ChannelConfigEntry(key: "smtp_port", value: "587"),
                ChannelConfigEntry(key: "smtp_username", value: "ops@x.com"),
                ChannelConfigEntry(key: "smtp_password", value: "secret")
            ]
        )
    }

    func testConfigPreviewTakesFirstThree() {
        let preview = sample().configPreview
        XCTAssertEqual(preview.map(\.key), ["smtp_host", "smtp_port", "smtp_username"])
    }

    func testConfigMapRoundTrips() {
        XCTAssertEqual(sample().configMap["smtp_host"], "smtp.gmail.com")
        XCTAssertEqual(sample().configMap["smtp_password"], "secret")
    }

    func testActiveChannelsText() {
        let stats = NotifChannelStats(sent: 1, failed: 2, pending: 3, enabledChannels: 4, totalChannels: 9)
        XCTAssertEqual(stats.activeChannelsText, "4/9")
    }
}

// MARK: - Payload builder (web `buildChannelPayload`)

@MainActor
final class ChannelPayloadBuilderTests: XCTestCase {
    func testSMTPPortCoercesInvalidTo587() {
        XCTAssertEqual(ChannelPayloadBuilder.smtpPort("587"), 587)
        XCTAssertEqual(ChannelPayloadBuilder.smtpPort("465"), 465)
        XCTAssertEqual(ChannelPayloadBuilder.smtpPort(""), 587)
        XCTAssertEqual(ChannelPayloadBuilder.smtpPort("not-a-number"), 587)
    }

    func testRecipientsSplitTrimAndFilter() {
        XCTAssertEqual(
            ChannelPayloadBuilder.recipients("a@x.com, b@y.com ,,  c@z.com"),
            ["a@x.com", "b@y.com", "c@z.com"]
        )
        XCTAssertEqual(ChannelPayloadBuilder.recipients(""), [])
    }

    func testSafeMethodAllowsKnownVerbsOnly() {
        XCTAssertEqual(ChannelPayloadBuilder.safeMethod("get"), "GET")
        XCTAssertEqual(ChannelPayloadBuilder.safeMethod("Put"), "PUT")
        XCTAssertEqual(ChannelPayloadBuilder.safeMethod("delete"), "POST")
        XCTAssertEqual(ChannelPayloadBuilder.safeMethod(""), "POST")
    }

    func testSafeHeadersGuardsInvalidJSON() {
        XCTAssertEqual(ChannelPayloadBuilder.safeHeaders("{\"A\":\"b\"}"), "{\"A\":\"b\"}")
        XCTAssertEqual(ChannelPayloadBuilder.safeHeaders("not json"), "{}")
        XCTAssertEqual(ChannelPayloadBuilder.safeHeaders(""), "{}")
        XCTAssertEqual(ChannelPayloadBuilder.safeHeaders("[1,2,3]"), "{}")
    }

    func testBuildEmailNormalisesPortAndRecipients() {
        let payload = ChannelPayloadBuilder.build(
            kind: .email,
            name: "Ops",
            enabled: true,
            rawConfig: ["smtp_port": "x", "to_addresses": "a@x.com, b@y.com"],
            id: nil
        )
        let map = Dictionary(payload.config.map { ($0.key, $0.value) }, uniquingKeysWith: { _, last in last })
        XCTAssertEqual(map["smtp_port"], "587")
        XCTAssertEqual(map["to_addresses"], "a@x.com,b@y.com")
        XCTAssertNil(payload.id)
    }

    func testBuildWebhookAndNtfyDefaults() {
        let webhook = ChannelPayloadBuilder.build(
            kind: .webhook,
            name: "Hook",
            enabled: false,
            rawConfig: ["method": "patch", "headers": "oops"],
            id: 42
        )
        let webhookMap = Dictionary(webhook.config.map { ($0.key, $0.value) }, uniquingKeysWith: { _, last in last })
        XCTAssertEqual(webhookMap["method"], "POST")
        XCTAssertEqual(webhookMap["headers"], "{}")
        XCTAssertEqual(webhook.id, 42)

        let ntfy = ChannelPayloadBuilder.build(
            kind: .ntfy,
            name: "N",
            enabled: true,
            rawConfig: [:],
            id: nil
        )
        let ntfyMap = Dictionary(ntfy.config.map { ($0.key, $0.value) }, uniquingKeysWith: { _, last in last })
        XCTAssertEqual(ntfyMap["server_url"], "https://ntfy.sh")
    }
}

// MARK: - Validation (web `if (!name.trim())`)

@MainActor
final class ChannelFormValidationTests: XCTestCase {
    func testBlankNameFailsValidation() {
        XCTAssertNotNil(ChannelFormValidation.nameError(""))
        XCTAssertNotNil(ChannelFormValidation.nameError("   "))
        XCTAssertEqual(ChannelFormValidation.nameError("")?.key, "notifications.channels.nameRequired")
    }

    func testNonBlankNamePasses() {
        XCTAssertNil(ChannelFormValidation.nameError("Ops"))
        XCTAssertNil(ChannelFormValidation.nameError("  Ops  "))
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor
final class NotifChannelsProjectionTests: XCTestCase {
    private let stats = NotifChannelStats(sent: 10, failed: 1, pending: 0, enabledChannels: 1, totalChannels: 2)
    private func channel() -> NotificationChannelData {
        NotificationChannelData(id: 1, kind: .discord, name: "D", enabled: true)
    }

    func testErrorTakesPrecedence() {
        let resolved = NotifChannelsProjection.resolve(
            NotifChannelsInput(channels: [channel()], stats: stats, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertEqual(resolved.stats, stats)
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(NotifChannelsProjection.resolve(NotifChannelsInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(NotifChannelsProjection.resolve(NotifChannelsInput(channels: nil)).phase, .loading)
    }

    func testEmptyWhenResolvedWithNoChannels() {
        let resolved = NotifChannelsProjection.resolve(NotifChannelsInput(channels: [], stats: stats))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.stats, stats)
    }

    func testDataWhenChannelsPresent() {
        let resolved = NotifChannelsProjection.resolve(NotifChannelsInput(channels: [channel()], stats: stats))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.channels.count, 1)
    }

    func testStatsSkeletonWhenStatsNil() {
        let resolved = NotifChannelsProjection.resolve(NotifChannelsInput(channels: [channel()], stats: nil))
        XCTAssertNil(resolved.stats)
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility summaries

@MainActor
final class NotificationChannelsAccessibilityTests: XCTestCase {
    func testChannelLabelJoinsParts() {
        XCTAssertEqual(
            NotificationChannelsAccessibility.channelLabel(name: "Ops Discord", kind: "Discord", status: "Active"),
            "Ops Discord, Discord, Active"
        )
    }

    func testStatLabelJoinsParts() {
        XCTAssertEqual(
            NotificationChannelsAccessibility.statLabel(label: "Total Sent", value: "1284"),
            "Total Sent, 1284"
        )
    }
}
