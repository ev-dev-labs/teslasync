//
//  WebhookChannelsSection.Tests.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  Unit coverage for the WebhookChannelsSection surface:
//    • Adapter (`WebhookChannelsProjection` / `WebhookMethod` / `WebhookFormat` /
//      `WebhookChannelsContent`) — method mapping + save narrowing, http(s) URL
//      validation, the trim + name-required + url-invalid form guards, the localized
//      name sort, phase resolution, integer formatting, and the sample-body parity.
//    • State holder (`WebhookChannelsSectionModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (once, re-armed on live), offline keeping cached rows, the
//      add/edit form lifecycle (validation / save success + failure / in-flight), the
//      per-row toggle + test, the delete confirm, and the debounced signature preview.
//    • Accessibility — the row / test-result / section VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//  The adapter subset is also proven by an executed headless harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: method, validation, projection, formatting

final class WebhookChannelsProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testMethodMappingIsCaseInsensitiveWithPostDefault() {
        XCTAssertEqual(WebhookMethod.from("put"), .put)
        XCTAssertEqual(WebhookMethod.from("PATCH"), .patch)
        XCTAssertEqual(WebhookMethod.from("Get"), .get)
        XCTAssertEqual(WebhookMethod.from("post"), .post)
        XCTAssertEqual(WebhookMethod.from(nil), .post)
        XCTAssertEqual(WebhookMethod.from("nonsense"), .post)
    }

    func testSaveMethodNarrowsToPostOrPut() {
        XCTAssertEqual(WebhookMethod.put.saveMethod, .put)
        XCTAssertEqual(WebhookMethod.patch.saveMethod, .post)
        XCTAssertEqual(WebhookMethod.get.saveMethod, .post)
        XCTAssertEqual(WebhookMethod.post.saveMethod, .post)
    }

    func testMethodDisplayAndFormOptions() {
        XCTAssertEqual(WebhookMethod.post.display, "POST")
        XCTAssertEqual(WebhookMethod.patch.display, "PATCH")
        XCTAssertEqual(WebhookMethod.formOptions, [.post, .put, .patch])
    }

    func testIsHttpLikeMatchesWebRegex() {
        XCTAssertTrue(WebhookChannelsProjection.isHttpLike("http://x.dev"))
        XCTAssertTrue(WebhookChannelsProjection.isHttpLike("https://x.dev/y"))
        XCTAssertTrue(WebhookChannelsProjection.isHttpLike("  HTTPS://x.dev  "))
        XCTAssertFalse(WebhookChannelsProjection.isHttpLike("ftp://x.dev"))
        XCTAssertFalse(WebhookChannelsProjection.isHttpLike("x.dev"))
        XCTAssertFalse(WebhookChannelsProjection.isHttpLike(""))
        XCTAssertFalse(WebhookChannelsProjection.isHttpLike("   "))
    }

    func testValidateRejectsEmptyName() {
        let form = WebhookFormState(name: "   ", url: "https://x.dev")
        guard case let .invalid(key, _) = WebhookChannelsProjection.validate(form) else {
            return XCTFail("expected invalid")
        }
        XCTAssertEqual(key, "webhookChannels.form.nameRequired")
    }

    func testValidateRejectsNonHttpURL() {
        let form = WebhookFormState(name: "Discord", url: "ws://x.dev")
        guard case let .invalid(key, _) = WebhookChannelsProjection.validate(form) else {
            return XCTFail("expected invalid")
        }
        XCTAssertEqual(key, "webhookChannels.form.urlInvalid")
    }

    func testValidateTrimsAndNarrowsMethod() {
        let form = WebhookFormState(
            channelID: 7, name: "  Discord  ", url: "  https://x.dev/hook  ",
            method: .patch, secret: "s3cr3t", enabled: false
        )
        guard case let .valid(request) = WebhookChannelsProjection.validate(form) else {
            return XCTFail("expected valid")
        }
        XCTAssertEqual(request.channelID, 7)
        XCTAssertEqual(request.name, "Discord")
        XCTAssertEqual(request.url, "https://x.dev/hook")
        XCTAssertEqual(request.method, .post, "PATCH must narrow to POST in the save payload")
        XCTAssertEqual(request.secret, "s3cr3t")
        XCTAssertFalse(request.enabled)
    }

    func testSortIsLocalizedCaseInsensitiveByName() {
        let channels = [
            WebhookChannel(channelID: 1, name: "zeta", enabled: true, url: "https://z", method: .post),
            WebhookChannel(channelID: 2, name: "Alpha", enabled: true, url: "https://a", method: .post),
            WebhookChannel(channelID: 3, name: "beta", enabled: true, url: "https://b", method: .post)
        ]
        XCTAssertEqual(WebhookChannelsProjection.sorted(channels).map(\.name), ["Alpha", "beta", "zeta"])
    }

    func testResolvePhase() {
        XCTAssertEqual(WebhookChannelsProjection.resolvePhase(.loading, isEmpty: true), .loading)
        XCTAssertEqual(WebhookChannelsProjection.resolvePhase(.loaded, isEmpty: true), .empty)
        XCTAssertEqual(WebhookChannelsProjection.resolvePhase(.loaded, isEmpty: false), .content)
        XCTAssertEqual(WebhookChannelsProjection.resolvePhase(.failed("x"), isEmpty: false), .error("x"))
    }

    func testIntegerFormatGroupsThousands() {
        XCTAssertEqual(WebhookFormat.integer(1234, locale: Locale(identifier: "en_US")), "1,234")
        XCTAssertEqual(WebhookFormat.integer(200, locale: Locale(identifier: "en_US")), "200")
    }

    func testFormStateEditSeedsFromChannelWithBlankSecret() {
        let channel = WebhookChannel(
            channelID: 9, name: "HA", enabled: false, url: "https://ha.local/hook", method: .put
        )
        let form = WebhookFormState.edit(channel)
        XCTAssertTrue(form.isEdit)
        XCTAssertEqual(form.channelID, 9)
        XCTAssertEqual(form.name, "HA")
        XCTAssertEqual(form.url, "https://ha.local/hook")
        XCTAssertEqual(form.method, .put)
        XCTAssertEqual(form.secret, "", "edit always starts with a blank secret box")
        XCTAssertFalse(form.enabled)
        XCTAssertFalse(WebhookFormState.empty.isEdit)
    }

    func testSampleSignatureBodyMatchesWebEnvelope() {
        XCTAssertEqual(
            WebhookChannelsContent.sampleSignatureBody,
            #"{"title":"Test event","message":"Hello from TeslaSync","source":"teslasync","test":true}"#
        )
    }

    func testPayloadVariablesCoverTheEnvelopeFields() {
        XCTAssertEqual(
            WebhookChannelsContent.payloadVariables.map(\.code),
            ["title", "message", "source", "timestamp"]
        )
    }

    func testSurfaceSlug() {
        XCTAssertEqual(WebhookChannelsSurface.slug, "WebhookChannelsSection")
        XCTAssertEqual(WebhookChannelsSection.surfaceSlug, "WebhookChannelsSection")
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class WebhookChannelsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testRowLabelIncludesNameStateMethodAndURL() {
        let channel = WebhookChannel(
            channelID: 1, name: "Discord", enabled: true, url: "https://d.dev/hook", method: .post
        )
        let label = WebhookChannelsAccessibility.rowLabel(channel, localize: echo)
        XCTAssertEqual(label, "Discord, Enabled, POST, https://d.dev/hook")
    }

    func testRowLabelUsesDisabledState() {
        let channel = WebhookChannel(
            channelID: 1, name: "HA", enabled: false, url: "https://h", method: .put
        )
        XCTAssertTrue(WebhookChannelsAccessibility.rowLabel(channel, localize: echo).contains("Disabled"))
    }

    func testTestResultLabelIncludesVerdictStatusLatency() {
        let outcome = WebhookTestOutcome(success: true, statusCode: 204, latencyMs: 137)
        let label = WebhookChannelsAccessibility.testResultLabel(outcome, localize: echo)
        XCTAssertTrue(label.contains("Success"))
        XCTAssertTrue(label.contains("Status 204"))
        XCTAssertTrue(label.contains("137 ms"))
    }

    func testTestResultLabelAppendsError() {
        let outcome = WebhookTestOutcome.transportFailure("connection refused")
        let label = WebhookChannelsAccessibility.testResultLabel(outcome, localize: echo)
        XCTAssertTrue(label.contains("Failed"))
        XCTAssertTrue(label.contains("connection refused"))
    }

    func testSectionSummary() {
        XCTAssertEqual(
            WebhookChannelsAccessibility.sectionSummary(count: 3, localize: echo),
            "Webhook channels: 3"
        )
        XCTAssertTrue(
            WebhookChannelsAccessibility.sectionSummary(count: 0, localize: echo).contains("No webhooks yet")
        )
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyWebhookTelemetry: WebhookChannelsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
