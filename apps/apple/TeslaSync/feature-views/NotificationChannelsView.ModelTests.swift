//
//  NotificationChannelsView.ModelTests.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  State-holder coverage for the NotificationChannelsView surface:
//    • NotificationChannelsModel — the start/stop/refresh wiring, the P1/S11
//      `view.opened` telemetry, the stale auto-refresh transition, the toggle / test /
//      delete mutations (success + failure → toast + refresh), and the form presentation.
//    • ChannelFormModel — the add/edit seeding, the kind reset, the name validation, the
//      save payload + onSaved callback, and the inline test outcome.
//
//  Driven by `InMemoryNotificationChannelsSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNotifChannelsTelemetry: NotificationChannelsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@MainActor
private func sampleChannel(
    id: Int64 = 1,
    kind: NotifChannelKind = .discord,
    name: String = "Ops",
    enabled: Bool = true
) -> NotificationChannelData {
    NotificationChannelData(id: id, kind: kind, name: name, enabled: enabled)
}

// MARK: - Model: wiring, telemetry, freshness

@MainActor
final class NotificationChannelsModelTests: XCTestCase {
    private func makeModel(
        _ input: NotifChannelsInput,
        telemetry: NotificationChannelsTelemetry = OSLogNotificationChannelsTelemetry(),
        failing: Set<ChannelSourceAction> = [],
        testResult: ChannelTestResult = ChannelTestResult(success: true)
    ) -> (NotificationChannelsModel, InMemoryNotificationChannelsSource) {
        let source = InMemoryNotificationChannelsSource(
            initial: input,
            testResult: testResult,
            failingActions: failing
        )
        return (NotificationChannelsModel(source: source, telemetry: telemetry), source)
    }

    private var dataInput: NotifChannelsInput {
        NotifChannelsInput(
            channels: [sampleChannel()],
            stats: NotifChannelStats(sent: 1, failed: 0, pending: 0, enabledChannels: 1, totalChannels: 1)
        )
    }

    func testStartEmitsTelemetryOnceAndApplies() {
        let spy = SpyNotifChannelsTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [NotificationChannelsView.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(NotificationChannelsView.surfaceSlug, "NotificationChannelsView")
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(NotifChannelsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(NotifChannelsInput(channels: [sampleChannel()], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(NotifChannelsInput(channels: [sampleChannel()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(NotifChannelsInput(channels: [sampleChannel()], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshAndStopReArm() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    // MARK: Mutations

    func testToggleSuccessTogglesToastsAndRefreshes() async {
        let (model, source) = makeModel(dataInput)
        await model.toggle(sampleChannel(enabled: true))
        XCTAssertEqual(source.toggledIDs, [1])
        XCTAssertEqual(model.toast?.tone, .success)
        XCTAssertEqual(model.toast?.message, "Channel disabled")
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNil(model.togglingChannelID)
    }

    func testToggleDisabledChannelUsesEnabledCopy() async {
        let (model, _) = makeModel(dataInput)
        await model.toggle(sampleChannel(enabled: false))
        XCTAssertEqual(model.toast?.message, "Channel enabled")
    }

    func testToggleFailureToastsDanger() async {
        let (model, source) = makeModel(dataInput, failing: [.toggle])
        await model.toggle(sampleChannel())
        XCTAssertEqual(model.toast?.tone, .danger)
        XCTAssertEqual(model.toast?.message, "Failed to toggle channel")
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testTestSuccessToastsWithChannelName() async {
        let (model, source) = makeModel(dataInput, testResult: ChannelTestResult(success: true))
        await model.test(sampleChannel(name: "Ops"))
        XCTAssertEqual(source.testedIDs, [1])
        XCTAssertEqual(model.toast?.tone, .success)
        XCTAssertEqual(model.toast?.message, "Ops: Test sent!")
    }

    func testTestUnsuccessfulToastsDanger() async {
        let (model, _) = makeModel(dataInput, testResult: ChannelTestResult(success: false, error: "bad"))
        await model.test(sampleChannel(name: "Ops"))
        XCTAssertEqual(model.toast?.tone, .danger)
        XCTAssertEqual(model.toast?.message, "Ops: Test failed")
    }

    func testTestThrownToastsDanger() async {
        let (model, _) = makeModel(dataInput, failing: [.test])
        await model.test(sampleChannel(name: "Ops"))
        XCTAssertEqual(model.toast?.tone, .danger)
    }

    func testDeleteSuccessAndFailure() async {
        let (okModel, okSource) = makeModel(dataInput)
        await okModel.delete(sampleChannel())
        XCTAssertEqual(okSource.deletedIDs, [1])
        XCTAssertEqual(okModel.toast?.message, "Channel deleted")
        XCTAssertEqual(okSource.refreshCount, 1)

        let (failModel, _) = makeModel(dataInput, failing: [.delete])
        await failModel.delete(sampleChannel())
        XCTAssertEqual(failModel.toast?.tone, .danger)
        XCTAssertEqual(failModel.toast?.message, "Failed to delete channel")
    }

    // MARK: Form presentation

    func testPresentAddEditDismiss() {
        let (model, _) = makeModel(dataInput)
        XCTAssertFalse(model.isFormPresented)
        model.presentAdd()
        XCTAssertTrue(model.isFormPresented)
        XCTAssertEqual(model.formModel?.isEdit, false)
        model.presentEdit(sampleChannel(name: "Edited"))
        XCTAssertEqual(model.formModel?.isEdit, true)
        XCTAssertEqual(model.formModel?.name, "Edited")
        model.dismissForm()
        XCTAssertFalse(model.isFormPresented)
    }

    func testDismissToastClears() {
        let (model, _) = makeModel(dataInput)
        model.presentAdd()
        XCTAssertNil(model.toast)
    }
}

// MARK: - Form model

@MainActor
final class ChannelFormModelTests: XCTestCase {
    private func source(
        failing: Set<ChannelSourceAction> = [],
        testResult: ChannelTestResult = ChannelTestResult(success: true)
    ) -> InMemoryNotificationChannelsSource {
        InMemoryNotificationChannelsSource(testResult: testResult, failingActions: failing)
    }

    func testInitAddDefaults() {
        let form = ChannelFormModel(source: source(), editing: nil, onSaved: {})
        XCTAssertFalse(form.isEdit)
        XCTAssertEqual(form.kind, .discord)
        XCTAssertEqual(form.name, "")
        XCTAssertTrue(form.enabled)
    }

    func testInitEditSeeds() {
        let channel = NotificationChannelData(
            id: 5,
            kind: .telegram,
            name: "Bot",
            enabled: false,
            config: [ChannelConfigEntry(key: "chat_id", value: "-100")]
        )
        let form = ChannelFormModel(source: source(), editing: channel, onSaved: {})
        XCTAssertTrue(form.isEdit)
        XCTAssertEqual(form.kind, .telegram)
        XCTAssertEqual(form.name, "Bot")
        XCTAssertFalse(form.enabled)
        XCTAssertEqual(form.config["chat_id"], "-100")
    }

    func testSelectKindResetsInAddMode() {
        let form = ChannelFormModel(source: source(), editing: nil, onSaved: {})
        form.fieldBinding("webhook_url").wrappedValue = "https://x"
        form.selectKind(.email)
        XCTAssertEqual(form.kind, .email)
        XCTAssertTrue(form.config.isEmpty)
    }

    func testSelectKindNoOpInEditMode() {
        let channel = sampleChannel(kind: .telegram)
        let form = ChannelFormModel(source: source(), editing: channel, onSaved: {})
        form.selectKind(.email)
        XCTAssertEqual(form.kind, .telegram)
    }

    func testSubmitBlankNameSetsErrorAndDoesNotSave() async {
        let store = source()
        let form = ChannelFormModel(source: store, editing: nil, onSaved: {})
        await form.submit()
        XCTAssertNotNil(form.formErrorMessage)
        XCTAssertEqual(form.formErrorMessage, "Name is required")
        XCTAssertTrue(store.savedPayloads.isEmpty)
    }

    func testSubmitValidSavesAndCallsOnSaved() async {
        let store = source()
        var saved = false
        let form = ChannelFormModel(source: store, editing: nil, onSaved: { saved = true })
        form.name = "Ops"
        await form.submit()
        XCTAssertTrue(saved)
        XCTAssertEqual(store.savedPayloads.count, 1)
        XCTAssertNil(store.savedPayloads.first?.id)
        XCTAssertEqual(store.savedPayloads.first?.name, "Ops")
    }

    func testSubmitEditCarriesID() async {
        let store = source()
        let form = ChannelFormModel(source: store, editing: sampleChannel(id: 9, name: "Ops"), onSaved: {})
        await form.submit()
        XCTAssertEqual(store.savedPayloads.first?.id, 9)
    }

    func testSubmitSaveFailureSetsError() async {
        let store = source(failing: [.save])
        var saved = false
        let form = ChannelFormModel(source: store, editing: nil, onSaved: { saved = true })
        form.name = "Ops"
        await form.submit()
        XCTAssertFalse(saved)
        XCTAssertEqual(form.formErrorMessage, "Failed to save channel")
    }

    func testTestSuccessSetsOutcome() async {
        let form = ChannelFormModel(source: source(), editing: sampleChannel(), onSaved: {})
        await form.test()
        XCTAssertEqual(form.testOutcome?.success, true)
        XCTAssertEqual(form.testOutcome?.message, "Test notification sent successfully!")
    }

    func testTestUnsuccessfulUsesServerError() async {
        let store = source(testResult: ChannelTestResult(success: false, error: "bad creds"))
        let form = ChannelFormModel(source: store, editing: sampleChannel(), onSaved: {})
        await form.test()
        XCTAssertEqual(form.testOutcome?.success, false)
        XCTAssertEqual(form.testOutcome?.message, "bad creds")
    }

    func testTestIsNoOpInAddMode() async {
        let store = source()
        let form = ChannelFormModel(source: store, editing: nil, onSaved: {})
        await form.test()
        XCTAssertNil(form.testOutcome)
        XCTAssertTrue(store.testedIDs.isEmpty)
    }

    func testFieldBindingUpdatesConfig() {
        let form = ChannelFormModel(source: source(), editing: nil, onSaved: {})
        let binding = form.fieldBinding("topic")
        binding.wrappedValue = "alerts"
        XCTAssertEqual(form.config["topic"], "alerts")
        XCTAssertEqual(binding.wrappedValue, "alerts")
    }
}
