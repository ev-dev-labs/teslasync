//
//  WebhookChannelsSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  State-holder coverage for `WebhookChannelsSectionModel`, split from
//  WebhookChannelsSection.Tests.swift to respect the house file-length limit. Driven
//  through the in-memory source — no network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: WebhookChannelsSectionModel

@MainActor
final class WebhookChannelsSectionModelTests: XCTestCase {
    private let sample = [
        WebhookChannel(channelID: 1, name: "Discord", enabled: true, url: "https://d", method: .post),
        WebhookChannel(channelID: 2, name: "HA", enabled: false, url: "https://h", method: .put)
    ]

    private func makeModel(
        initial: WebhookChannelsUpdate? = nil,
        source: InMemoryWebhookChannelsSource? = nil,
        telemetry: WebhookChannelsTelemetry = SpyWebhookTelemetry()
    ) -> (WebhookChannelsSectionModel, InMemoryWebhookChannelsSource) {
        let src = source ?? InMemoryWebhookChannelsSource(initial: initial)
        let model = WebhookChannelsSectionModel(source: src, telemetry: telemetry)
        return (model, src)
    }

    func testLoadedContentSortsAndProjects() {
        let (model, source) = makeModel(initial: WebhookChannelsUpdate(status: .loaded, channels: sample))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.channels.map(\.name), ["Discord", "HA"])
        XCTAssertEqual(model.count, 2)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: WebhookChannelsUpdate(status: .loaded, channels: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.channels.isEmpty)
    }

    func testLoadingThenFailed() {
        let (model, source) = makeModel(initial: WebhookChannelsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(WebhookChannelsUpdate(status: .failed("timeout")))
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyWebhookTelemetry()
        let (model, _) = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WebhookChannelsSurface.slug])
    }

    func testStaleAutoRefreshesExactlyOnceAndReArmsOnLive() {
        let (model, source) = makeModel()
        model.start()
        source.push(WebhookChannelsUpdate(status: .loaded, channels: sample, connection: .stale))
        source.push(WebhookChannelsUpdate(status: .loaded, channels: sample, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale should auto-refresh exactly once")
        source.push(WebhookChannelsUpdate(status: .loaded, channels: sample, connection: .live))
        source.push(WebhookChannelsUpdate(status: .loaded, channels: sample, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the stale auto-refresh")
    }

    func testOfflineKeepsCachedRowsWithoutRefetch() {
        let (model, source) = makeModel()
        model.start()
        source.push(WebhookChannelsUpdate(status: .loaded, channels: sample, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.channels.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testPresentAndDismissForm() {
        let (model, _) = makeModel()
        model.presentAdd()
        XCTAssertTrue(model.isFormPresented)
        XCTAssertEqual(model.editingForm?.isEdit, false)
        model.presentEdit(sample[0])
        XCTAssertEqual(model.editingForm?.channelID, 1)
        XCTAssertEqual(model.editingForm?.isEdit, true)
        model.dismissForm()
        XCTAssertFalse(model.isFormPresented)
        XCTAssertEqual(model.signatureState, .empty)
    }

    func testSubmitValidDelegatesAndClosesForm() {
        let (model, source) = makeModel()
        model.presentAdd()
        let form = WebhookFormState(name: "Discord", url: "https://d.dev/hook", method: .patch, secret: "s")
        model.submit(form)
        XCTAssertEqual(source.savedRequests.count, 1)
        XCTAssertEqual(source.savedRequests.first?.method, .post)
        XCTAssertFalse(model.isFormPresented, "successful save closes the form")
        XCTAssertFalse(model.saving)
    }

    func testSubmitInvalidSetsFormErrorAndDoesNotSave() {
        let (model, source) = makeModel()
        model.presentAdd()
        model.submit(WebhookFormState(name: "", url: "https://d.dev"))
        XCTAssertTrue(source.savedRequests.isEmpty)
        XCTAssertFalse(model.formError.isEmpty)
        XCTAssertTrue(model.isFormPresented, "an invalid form stays open")
    }

    func testSubmitFailureKeepsFormOpenWithError() {
        let source = InMemoryWebhookChannelsSource(saveResult: .failure(WebhookActionError("server said no")))
        let (model, _) = makeModel(source: source)
        model.presentAdd()
        model.submit(WebhookFormState(name: "Discord", url: "https://d.dev/hook"))
        XCTAssertEqual(model.formError, "server said no")
        XCTAssertTrue(model.isFormPresented)
        XCTAssertFalse(model.saving)
    }

    func testSubmitInFlightSetsSavingWhenNotAutoResponding() {
        let source = InMemoryWebhookChannelsSource(autoRespond: false)
        let (model, _) = makeModel(source: source)
        model.presentAdd()
        model.submit(WebhookFormState(name: "Discord", url: "https://d.dev/hook"))
        XCTAssertTrue(model.saving, "save stays in-flight until the source completes")
        XCTAssertTrue(model.isFormPresented)
    }

    func testToggleDelegatesAndClearsOnNextSnapshot() {
        let (model, source) = makeModel(initial: WebhookChannelsUpdate(status: .loaded, channels: sample))
        model.start()
        model.toggle(1)
        XCTAssertEqual(source.toggledIDs, [1])
        XCTAssertTrue(model.isToggling(1))
        source.push(WebhookChannelsUpdate(status: .loaded, channels: sample))
        XCTAssertFalse(model.isToggling(1), "a fresh snapshot clears the toggling marker")
    }

    func testTestFilesOutcomeAndClearsBusy() {
        let outcome = WebhookTestOutcome(success: true, statusCode: 204, latencyMs: 12)
        let source = InMemoryWebhookChannelsSource(cannedTest: outcome)
        let (model, _) = makeModel(source: source)
        model.test(2)
        XCTAssertEqual(source.testedIDs, [2])
        XCTAssertEqual(model.testResults[2], outcome)
        XCTAssertFalse(model.isTesting(2))
    }

    func testTestInFlightSetsBusyWhenNotAutoResponding() {
        let source = InMemoryWebhookChannelsSource(autoRespond: false)
        let (model, _) = makeModel(source: source)
        model.test(2)
        XCTAssertTrue(model.isTesting(2))
        XCTAssertNil(model.testResults[2])
    }

    func testDeleteConfirmDelegatesClearsDialogAndDropsResult() {
        let outcome = WebhookTestOutcome(success: false, statusCode: 500, latencyMs: 9)
        let source = InMemoryWebhookChannelsSource(cannedTest: outcome)
        let (model, _) = makeModel(source: source)
        model.test(1)
        XCTAssertNotNil(model.testResults[1])
        model.requestDelete(1)
        XCTAssertEqual(model.confirmDeleteID, 1)
        model.confirmDelete()
        XCTAssertEqual(source.deletedIDs, [1])
        XCTAssertNil(model.confirmDeleteID, "confirming dismisses the dialog")
        XCTAssertNil(model.testResults[1], "a deleted channel's test result is dropped")
        XCTAssertFalse(model.deleting)
    }

    func testCancelDeleteClearsDialog() {
        let (model, source) = makeModel()
        model.requestDelete(3)
        model.cancelDelete()
        XCTAssertNil(model.confirmDeleteID)
        XCTAssertTrue(source.deletedIDs.isEmpty)
    }

    func testEmptySecretSignaturePreviewResetsToEmpty() {
        let (model, source) = makeModel()
        model.requestSignaturePreview(secret: "   ")
        XCTAssertEqual(model.signatureState, .empty)
        XCTAssertTrue(source.previewedSecrets.isEmpty, "an empty secret never hits the source")
    }

    func testNonEmptySecretEntersLoadingThenLoaded() async {
        let source = InMemoryWebhookChannelsSource(cannedSignature: .success("sha256=abc"))
        let (model, _) = makeModel(source: source)
        model.signatureDebounce = .zero
        model.requestSignaturePreview(secret: "topsecret")
        XCTAssertEqual(model.signatureState, .loading, "loading shows immediately while debouncing")
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(model.signatureState, .loaded("sha256=abc"))
        XCTAssertEqual(source.previewedSecrets, ["topsecret"])
    }

    func testSignaturePreviewFailureSurfacesMessage() async {
        let source = InMemoryWebhookChannelsSource(cannedSignature: .failure(WebhookActionError("bad secret")))
        let (model, _) = makeModel(source: source)
        model.signatureDebounce = .zero
        model.requestSignaturePreview(secret: "x")
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(model.signatureState, .failed("bad secret"))
    }

    func testRefreshAndStopDelegate() {
        let (model, source) = makeModel()
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }
}
