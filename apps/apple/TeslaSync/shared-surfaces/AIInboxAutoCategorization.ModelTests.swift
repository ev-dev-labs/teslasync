//
//  AIInboxAutoCategorization.ModelTests.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `InboxCategoryModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the categorize double-submit guard, the proposal capture (non-empty + resolved-empty),
//  the `applyCategories` rule-id forwarding, the inbox-scope-change reset, and the stale
//  auto-refresh. Driven entirely by `InMemoryInboxCategorySource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class InboxCategoryModelTests: XCTestCase {
    private func makeModel(
        _ input: InboxCategoryInput,
        telemetry: InboxCategoryTelemetry = OSLogInboxCategoryTelemetry(),
        onApply: @escaping @MainActor ([Int64]) -> Void = { _ in }
    ) -> (InboxCategoryModel, InMemoryInboxCategorySource) {
        let source = InMemoryInboxCategorySource(initial: input)
        let model = InboxCategoryModel(source: source, telemetry: telemetry, onApply: onApply)
        return (model, source)
    }

    private var readyInput: InboxCategoryInput {
        InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyInboxCategoryTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.vehicleID, 7)
        XCTAssertEqual(model.windowDays, 7)
        XCTAssertEqual(spy.surfaces, [InboxCategorySurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(InboxCategoryInput(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(InboxCategoryInput(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(InboxCategoryInput(gate: .loading, errorMessage: "boom"))
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(InboxCategoryInput(gate: .off, errorMessage: "ignored"))
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testCategorizeStartsStreamAndClearsPriorProposal() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([InboxCategoryBucket(category: "Battery", count: 5, ruleIDs: [11])])
        XCTAssertNotNil(model.proposal)
        model.categorize()
        XCTAssertNil(model.proposal)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(model.phase, .streaming)
    }

    func testCategorizeIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        model.categorize()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testToolResultCapturesProposal() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([
            InboxCategoryBucket(category: "Battery & charging", count: 14, ruleIDs: [11, 12])
        ])
        XCTAssertEqual(model.proposal?.count, 1)
        XCTAssertEqual(model.proposal?.first?.ruleIDs, [11, 12])
        XCTAssertTrue(model.showsProposal)
        XCTAssertFalse(model.showsEmptyProposal)
        XCTAssertEqual(model.phase, .done)
    }

    func testToolResultCapturesResolvedEmpty() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([])
        XCTAssertEqual(model.proposal, [])
        XCTAssertTrue(model.showsEmptyProposal)
        XCTAssertFalse(model.showsProposal)
    }

    func testApplyForwardsDedupedSortedRuleIDs() {
        let recorder = ApplyRecorder()
        let (model, source) = makeModel(readyInput, onApply: { recorder.calls.append($0) })
        model.start()
        source.pushProposal([
            InboxCategoryBucket(category: "A", count: 1, ruleIDs: [12, 11]),
            InboxCategoryBucket(category: "B", count: 2, ruleIDs: [11, 30])
        ])
        XCTAssertFalse(model.applyDisabled)
        model.applyCategories()
        XCTAssertEqual(recorder.calls, [[11, 12, 30]])
    }

    func testApplyIsNoOpWhenNoRuleIDsCaptured() {
        let recorder = ApplyRecorder()
        let (model, source) = makeModel(readyInput, onApply: { recorder.calls.append($0) })
        model.start()
        source.pushProposal([InboxCategoryBucket(category: "A", count: 1)])
        XCTAssertTrue(model.applyDisabled)
        model.applyCategories()
        XCTAssertTrue(recorder.calls.isEmpty)
    }

    func testApplyDisabledWhileBusyEvenWithRuleIDs() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([InboxCategoryBucket(category: "A", count: 1, ruleIDs: [11])])
        XCTAssertFalse(model.applyDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.applyDisabled)
    }

    func testInboxScopeChangeCancelsAndResetsProposal() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([InboxCategoryBucket(category: "A", count: 1, ruleIDs: [11])])
        XCTAssertNotNil(model.proposal)

        source.pushInput(InboxCategoryInput(gate: .on, vehicleID: 99, windowDays: 7))
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertNil(model.proposal)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.vehicleID, 99)
    }

    func testScopeChangeViaSeveritiesResets() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([InboxCategoryBucket(category: "A", count: 1)])
        source.pushInput(InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7, severities: ["critical"]))
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertNil(model.proposal)
        XCTAssertEqual(model.severities, ["critical"])
    }

    func testFirstSnapshotDoesNotCancel() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertEqual(model.vehicleID, 7)
    }

    func testSameScopeSnapshotDoesNotReset() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal([InboxCategoryBucket(category: "A", count: 1)])
        // A re-emit with the identical inbox scope must not drop the captured proposal.
        source.pushInput(InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7))
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertNotNil(model.proposal)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesSuggest() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushInput(InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.suggestDisabled)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Bucketing "))
        source.pushEvent(.delta(text: "alerts"))
        XCTAssertEqual(model.streamText, "Bucketing alerts")
    }

    func testPhaseDrivesBusyAndSuggestDisabled() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.suggestDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.suggestDisabled)
    }

    func testPausedConfirmBlocksSuggest() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.pausedConfirm)
        XCTAssertFalse(model.canStart)
        XCTAssertTrue(model.suggestDisabled)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(InboxCategoryInput(gate: .loading, errorMessage: "down"))
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(InboxCategorySurface.slug, "AIInboxAutoCategorization")
        XCTAssertEqual(InboxCategorySurface.featureID, "inbox-auto-categorization")
        XCTAssertEqual(AIInboxAutoCategorization.surfaceSlug, InboxCategorySurface.slug)
        XCTAssertEqual(AIInboxAutoCategorization.featureID, InboxCategorySurface.featureID)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyInboxCategoryTelemetry: InboxCategoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the rule-id batches forwarded to the parent `onApply` callback.
@MainActor private final class ApplyRecorder {
    var calls: [[Int64]] = []
}
