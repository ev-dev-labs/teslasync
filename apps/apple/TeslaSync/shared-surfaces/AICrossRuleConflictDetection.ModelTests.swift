//
//  AICrossRuleConflictDetection.ModelTests.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `RuleConflictModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the detect double-submit guard, the conflict capture (non-empty + resolved-empty),
//  the `review` forwarding, the rule-scope-change reset, and the stale auto-refresh. Driven
//  entirely by `InMemoryRuleConflictSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class RuleConflictModelTests: XCTestCase {
    private func makeModel(
        _ input: RuleConflictInput,
        telemetry: RuleConflictTelemetry = OSLogRuleConflictTelemetry(),
        onReview: @escaping @MainActor (Int64) -> Void = { _ in }
    ) -> (RuleConflictModel, InMemoryRuleConflictSource) {
        let source = InMemoryRuleConflictSource(initial: input)
        let model = RuleConflictModel(source: source, telemetry: telemetry, onReview: onReview)
        return (model, source)
    }

    private var readyInput: RuleConflictInput {
        RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], vehicleID: 7)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyRuleConflictTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.ruleIDs, [11, 12, 13])
        XCTAssertEqual(model.vehicleID, 7)
        XCTAssertEqual(spy.surfaces, [RuleConflictSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(RuleConflictInput(gate: .loading, ruleIDs: [1, 2]))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(RuleConflictInput(gate: .off, ruleIDs: [1, 2]))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(RuleConflictInput(gate: .loading, ruleIDs: [1, 2], errorMessage: "boom"))
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(RuleConflictInput(gate: .off, ruleIDs: [1, 2], errorMessage: "ignored"))
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testDetectStartsStreamAndClearsPriorConflicts() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushConflicts([RuleConflict(kind: "k", ruleAID: 11, ruleBID: 12)])
        XCTAssertNotNil(model.conflicts)
        model.detect()
        XCTAssertNil(model.conflicts)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(model.phase, .streaming)
    }

    func testDetectIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        model.detect()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testToolResultCapturesConflicts() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushConflicts([
            RuleConflict(kind: "redundant_duplicate", ruleAID: 11, ruleBID: 12, subsumes: true)
        ])
        XCTAssertEqual(model.conflicts?.count, 1)
        XCTAssertEqual(model.conflicts?.first?.subsumes, true)
        XCTAssertTrue(model.showsConflicts)
        XCTAssertFalse(model.showsEmptyMessage)
        XCTAssertEqual(model.phase, .done)
    }

    func testToolResultCapturesResolvedEmpty() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushConflicts([])
        XCTAssertEqual(model.conflicts, [])
        XCTAssertTrue(model.showsEmptyMessage)
        XCTAssertFalse(model.showsConflicts)
    }

    func testReviewForwardsRuleID() {
        let recorder = ReviewRecorder()
        let (model, source) = makeModel(readyInput, onReview: { recorder.ruleIDs.append($0) })
        model.start()
        source.pushConflicts([RuleConflict(kind: "k", ruleAID: 11, ruleBID: 12)])
        model.review(ruleID: 11)
        model.review(ruleID: 12)
        XCTAssertEqual(recorder.ruleIDs, [11, 12])
    }

    func testRuleScopeChangeCancelsAndResetsConflicts() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushConflicts([RuleConflict(kind: "k", ruleAID: 11, ruleBID: 12)])
        XCTAssertNotNil(model.conflicts)

        source.pushInput(RuleConflictInput(gate: .on, ruleIDs: [20, 21]))
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertNil(model.conflicts)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.ruleIDs, [20, 21])
    }

    func testFirstSnapshotDoesNotCancel() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertEqual(model.ruleIDs, [11, 12, 13])
    }

    func testSameScopeSnapshotDoesNotReset() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushConflicts([RuleConflict(kind: "k", ruleAID: 11, ruleBID: 12)])
        // A re-emit with the identical rule scope must not drop the captured conflicts.
        source.pushInput(RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], vehicleID: 7))
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertNotNil(model.conflicts)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushInput(RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Analyzing "))
        source.pushEvent(.delta(text: "rules"))
        XCTAssertEqual(model.streamText, "Analyzing rules")
    }

    func testCanStartRequiresTwoRules() {
        let (model, source) = makeModel(RuleConflictInput(gate: .on, ruleIDs: [11]))
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertTrue(model.buttonDisabled)

        source.pushInput(RuleConflictInput(gate: .on, ruleIDs: [11, 12]))
        XCTAssertTrue(model.canStart)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testPhaseDrivesBusyAndButtonDisabled() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(RuleConflictInput(gate: .loading, ruleIDs: [1, 2], errorMessage: "down"))
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
        XCTAssertEqual(RuleConflictSurface.slug, "AICrossRuleConflictDetection")
        XCTAssertEqual(RuleConflictSurface.featureID, "cross-rule-conflict-detection")
        XCTAssertEqual(AICrossRuleConflictDetection.surfaceSlug, RuleConflictSurface.slug)
        XCTAssertEqual(AICrossRuleConflictDetection.featureID, RuleConflictSurface.featureID)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRuleConflictTelemetry: RuleConflictTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the rule ids forwarded to the parent `onReview` callback.
@MainActor private final class ReviewRecorder {
    var ruleIDs: [Int64] = []
}
