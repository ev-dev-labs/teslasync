//
//  AIAlertTuningSuggestions.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request (the /ai/alerts/rules/{ruleId}/tune/
//  draft path, the `{}` vs `{ vehicle_id }` body branch), the SSE frame parsing (port of
//  `parseSSEFrame` + `toTypedEvent`), the typed `AlertRuleDraftPatch` extraction (the per-field
//  `typeof` guards), the delta-accumulating stream reducer with `tool_result` proposal capture (port
//  of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and the output /
//  action / busy derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard` button +
//  the Apply button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Request (web `useAiStream({ url, body })`)

final class AlertTuningRequestTests: XCTestCase {
    func testPathInterpolatesRuleID() {
        XCTAssertEqual(AlertTuningDraftRequest(ruleID: 42).path, "/ai/alerts/rules/42/tune/draft")
    }

    func testBodyOmitsVehicleWhenNil() {
        // Web `vehicleId == null ? {} : { vehicle_id: vehicleId }`.
        XCTAssertTrue(AlertTuningDraftRequest(ruleID: 42, vehicleID: nil).body.isEmpty)
    }

    func testBodyUsesSnakeCaseVehicleWhenPresent() {
        let request = AlertTuningDraftRequest(ruleID: 42, vehicleID: 7)
        XCTAssertEqual(request.body["vehicle_id"], 7)
    }

    func testEncodedEmptyBodyIsEmptyJSONObject() throws {
        let data = try AlertTuningDraftRequest(ruleID: 42, vehicleID: nil).encodedBody()
        XCTAssertEqual(String(bytes: data, encoding: .utf8), "{}")
    }

    func testEncodedVehicleBodyIsDeterministicJSON() throws {
        let data = try AlertTuningDraftRequest(ruleID: 42, vehicleID: 7).encodedBody()
        XCTAssertEqual(String(bytes: data, encoding: .utf8), "{\"vehicle_id\":7}")
    }
}

// MARK: - Patch extraction (web per-field `typeof` guards)

final class AlertRuleDraftPatchTests: XCTestCase {
    func testExtractsAllRecognisedFields() {
        let patch = AlertRuleDraftPatch.extract(fromProposed: [
            "value_num": 15,
            "value_min": 1.5,
            "value_max": 90,
            "cooldown_min": 45,
            "severity": "warn",
            "trigger_mode": "repeat",
            "op": "<"
        ])
        XCTAssertEqual(patch.valueNum, 15)
        XCTAssertEqual(patch.valueMin, 1.5)
        XCTAssertEqual(patch.valueMax, 90)
        XCTAssertEqual(patch.cooldownMin, 45)
        XCTAssertEqual(patch.severity, "warn")
        XCTAssertEqual(patch.triggerMode, "repeat")
        XCTAssertEqual(patch.op, "<")
        XCTAssertFalse(patch.isEmpty)
    }

    func testDropsNonNumericNumberFields() {
        // Web `typeof proposed.value_num === 'number'` — a string is dropped.
        let patch = AlertRuleDraftPatch.extract(fromProposed: ["value_num": "15", "cooldown_min": "45"])
        XCTAssertNil(patch.valueNum)
        XCTAssertNil(patch.cooldownMin)
    }

    func testDropsBooleanMasqueradingAsNumber() {
        // JSON true/false bridge to NSNumber; JS `typeof true === 'boolean'`, so it must be dropped.
        let patch = AlertRuleDraftPatch.extract(fromProposed: ["value_num": true])
        XCTAssertNil(patch.valueNum)
    }

    func testDropsEmptyStringFields() {
        // Web `typeof === 'string' && value !== ''`.
        let patch = AlertRuleDraftPatch.extract(fromProposed: ["severity": "", "op": ""])
        XCTAssertNil(patch.severity)
        XCTAssertNil(patch.op)
    }

    func testEmptyProposedYieldsEmptyButNonNilPatch() {
        let patch = AlertRuleDraftPatch.extract(fromProposed: [:])
        XCTAssertTrue(patch.isEmpty)
    }

    func testRowsAreOrderedAndOnlyPresentFields() {
        let patch = AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45, op: "<")
        let rows = patch.rows()
        XCTAssertEqual(rows.map(\.field), ["value_num", "cooldown_min", "op"])
        XCTAssertEqual(rows.map(\.value), ["15", "45", "<"])
    }

    func testWholeNumberValueRendersWithoutDecimal() {
        XCTAssertEqual(AlertRuleDraftPatch(valueNum: 15).rows().first?.value, "15")
    }

    func testFractionalValueKeepsDecimal() {
        XCTAssertEqual(AlertRuleDraftPatch(valueMin: 1.5).rows().first?.value, "1.5")
    }
}

// MARK: - SSE frame parse (web `parseSSEFrame` + `toTypedEvent`)

final class AlertTuningSSEFrameTests: XCTestCase {
    func testParsesDelta() {
        XCTAssertEqual(AlertTuningSSEFrame.parse("event: delta\ndata: {\"text\":\"hi\"}"), .delta(text: "hi"))
    }

    func testParsesDone() {
        let frame = "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":10,\"out\":20}}"
        XCTAssertEqual(AlertTuningSSEFrame.parse(frame), .done(finishReason: "stop", usageIn: 10, usageOut: 20))
    }

    func testDoneDefaultsFinishReasonWhenMissing() {
        XCTAssertEqual(
            AlertTuningSSEFrame.parse("event: done\ndata: {}"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        )
    }

    func testParsesError() {
        XCTAssertEqual(
            AlertTuningSSEFrame.parse("event: error\ndata: {\"message\":\"boom\"}"),
            .failure(message: "boom")
        )
    }

    func testErrorDefaultsMessageToUnknown() {
        XCTAssertEqual(AlertTuningSSEFrame.parse("event: error\ndata: {}"), .failure(message: "unknown"))
    }

    func testParsesToolCall() {
        XCTAssertEqual(
            AlertTuningSSEFrame.parse("event: tool_call\ndata: {\"id\":\"c1\",\"name\":\"draft_alert_rule_patch\"}"),
            .toolCall(id: "c1", name: "draft_alert_rule_patch")
        )
    }

    func testParsesToolResultWithProposedPatch() {
        let frame = "event: tool_result\n"
            + "data: {\"id\":\"c1\",\"name\":\"draft_alert_rule_patch\",\"ok\":true,"
            + "\"data\":{\"status\":\"ok\",\"proposed\":{\"value_num\":15,\"cooldown_min\":45}}}"
        XCTAssertEqual(
            AlertTuningSSEFrame.parse(frame),
            .toolResult(
                id: "c1",
                name: "draft_alert_rule_patch",
                ok: true,
                status: "ok",
                patch: AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45)
            )
        )
    }

    func testParsesToolResultWithoutPayloadYieldsNilStatusAndPatch() {
        let frame = "event: tool_result\ndata: {\"id\":\"c1\",\"name\":\"draft_alert_rule_patch\",\"ok\":true}"
        XCTAssertEqual(
            AlertTuningSSEFrame.parse(frame),
            .toolResult(id: "c1", name: "draft_alert_rule_patch", ok: true, status: nil, patch: nil)
        )
    }

    func testParsesConfirmRequest() {
        let frame = "event: confirm_request\n"
            + "data: {\"continuation_id\":\"k1\",\"tool\":\"apply\",\"summary\":\"Confirm?\"}"
        XCTAssertEqual(
            AlertTuningSSEFrame.parse(frame),
            .confirmRequest(continuationID: "k1", tool: "apply", summary: "Confirm?")
        )
    }

    func testSkipsCommentLines() {
        XCTAssertEqual(
            AlertTuningSSEFrame.parse(": keep-alive\nevent: delta\ndata: {\"text\":\"x\"}"),
            .delta(text: "x")
        )
    }

    func testParsesNoSpaceColonForm() {
        XCTAssertEqual(AlertTuningSSEFrame.parse("event:delta\ndata:{\"text\":\"y\"}"), .delta(text: "y"))
    }

    func testDropsUnknownEventType() {
        XCTAssertNil(AlertTuningSSEFrame.parse("event: heartbeat\ndata: {\"x\":1}"))
    }

    func testDropsMalformedJSON() {
        XCTAssertNil(AlertTuningSSEFrame.parse("event: delta\ndata: {not json"))
    }

    func testDropsEventlessFrame() {
        XCTAssertNil(AlertTuningSSEFrame.parse("data: {\"text\":\"orphan\"}"))
    }

    func testDropsDeltaMissingTextField() {
        XCTAssertNil(AlertTuningSSEFrame.parse("event: delta\ndata: {\"nope\":1}"))
    }
}

// MARK: - Stream reducer (web `handleEvent` + `finalizeError` + the proposal capture)

final class AlertTuningStreamReducerTests: XCTestCase {
    func testStartIsStreamingEmptyNoProposal() {
        let snapshot = AlertTuningStreamReducer.start()
        XCTAssertEqual(snapshot.state, .streaming)
        XCTAssertEqual(snapshot.text, "")
        XCTAssertNil(snapshot.error)
        XCTAssertNil(snapshot.proposal)
    }

    func testDeltaAccumulatesText() {
        var snapshot = AlertTuningStreamReducer.start()
        snapshot = AlertTuningStreamReducer.reduce(snapshot, .delta(text: "Battery "))
        snapshot = AlertTuningStreamReducer.reduce(snapshot, .delta(text: "low."))
        XCTAssertEqual(snapshot.text, "Battery low.")
        XCTAssertEqual(snapshot.state, .streaming)
    }

    func testToolResultCapturesProposalWhenOkAndStatusOk() {
        let patch = AlertRuleDraftPatch(valueNum: 15, cooldownMin: 45)
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .toolResult(id: "1", name: "draft_alert_rule_patch", ok: true, status: "ok", patch: patch)
        )
        XCTAssertEqual(snapshot.proposal, patch)
    }

    func testToolResultIgnoredWhenStatusNotOk() {
        let patch = AlertRuleDraftPatch(valueNum: 15)
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .toolResult(id: "1", name: "draft_alert_rule_patch", ok: true, status: "error", patch: patch)
        )
        XCTAssertNil(snapshot.proposal)
    }

    func testToolResultIgnoredWhenNotOk() {
        let patch = AlertRuleDraftPatch(valueNum: 15)
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .toolResult(id: "1", name: "draft_alert_rule_patch", ok: false, status: "ok", patch: patch)
        )
        XCTAssertNil(snapshot.proposal)
    }

    func testToolResultIgnoredForWrongToolName() {
        let patch = AlertRuleDraftPatch(valueNum: 15)
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .toolResult(id: "1", name: "validate_alert_rule", ok: true, status: "ok", patch: patch)
        )
        XCTAssertNil(snapshot.proposal)
    }

    func testDoneFinalizes() {
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .done(finishReason: "stop", usageIn: 1, usageOut: 2)
        )
        XCTAssertEqual(snapshot.state, .done)
    }

    func testErrorFinalizesWithMessage() {
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .failure(message: "rate_limited")
        )
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "rate_limited")
    }

    func testConfirmRequestPauses() {
        let snapshot = AlertTuningStreamReducer.reduce(
            AlertTuningStreamReducer.start(),
            .confirmRequest(continuationID: "k", tool: "t", summary: "s")
        )
        XCTAssertEqual(snapshot.state, .pausedConfirm)
    }

    func testToolCallDoesNotMutateState() {
        let start = AlertTuningStreamReducer.start()
        XCTAssertEqual(AlertTuningStreamReducer.reduce(start, .toolCall(id: "1", name: "n")), start)
    }

    func testFoldReplaysSequenceWithCapture() {
        let patch = AlertRuleDraftPatch(cooldownMin: 45)
        let snapshot = AlertTuningStreamReducer.fold([
            .delta(text: "a"),
            .toolResult(id: "1", name: "draft_alert_rule_patch", ok: true, status: "ok", patch: patch),
            .delta(text: "b"),
            .done(finishReason: "stop", usageIn: 0, usageOut: 0)
        ])
        XCTAssertEqual(snapshot.text, "ab")
        XCTAssertEqual(snapshot.state, .done)
        XCTAssertEqual(snapshot.proposal, patch)
    }

    func testHttpFailureFormatsStatus() {
        let snapshot = AlertTuningStreamReducer.httpFailure(status: 404)
        XCTAssertEqual(snapshot.state, .error)
        XCTAssertEqual(snapshot.error, "stream_http_404")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class AlertTuningOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(AlertTuningOutput.derive(.idle), .empty)
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(AlertTuningOutput.derive(AlertTuningStreamSnapshot(state: .streaming, text: "")), .thinking)
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            AlertTuningOutput.derive(AlertTuningStreamSnapshot(state: .streaming, text: "partial")),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            AlertTuningOutput.derive(AlertTuningStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            AlertTuningOutput.derive(AlertTuningStreamSnapshot(state: .error, text: "", error: "stream_http_500")),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            AlertTuningOutput.derive(AlertTuningStreamSnapshot(state: .error, text: "", error: nil)),
            .failed(message: "")
        )
    }
}

// MARK: - Action / busy derivation (web `AIFeatureCard` button + Apply button + canStart/isBusy)

final class AlertTuningActionDeriveTests: XCTestCase {
    func testIdleWithRuleIsEnabled() {
        let canStart = AlertTuningBusy.canStart(ruleID: 42, state: .idle)
        let action = AlertTuningAction.derive(canStart: canStart, state: .idle)
        XCTAssertTrue(canStart)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let canStart = AlertTuningBusy.canStart(ruleID: 42, state: .streaming)
        let action = AlertTuningAction.derive(canStart: canStart, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoRuleIsDisabled() {
        XCTAssertFalse(AlertTuningBusy.canStart(ruleID: nil, state: .idle))
        XCTAssertTrue(AlertTuningAction.derive(canStart: false, state: .idle).isDisabled)
    }

    func testPausedConfirmBlocksCanStart() {
        // Web `canStart = !!ruleId && stream.state !== 'paused-confirm'`.
        XCTAssertFalse(AlertTuningBusy.canStart(ruleID: 42, state: .pausedConfirm))
    }

    func testIsBusyForStreamingAndPausedConfirm() {
        XCTAssertTrue(AlertTuningBusy.isBusy(.streaming))
        XCTAssertTrue(AlertTuningBusy.isBusy(.pausedConfirm))
        XCTAssertFalse(AlertTuningBusy.isBusy(.idle))
        XCTAssertFalse(AlertTuningBusy.isBusy(.done))
        XCTAssertFalse(AlertTuningBusy.isBusy(.error))
    }

    func testApplyDisabledRule() {
        // Web `disabled={proposal == null || isBusy}`.
        XCTAssertTrue(AlertTuningBusy.applyDisabled(hasProposal: false, state: .done))
        XCTAssertTrue(AlertTuningBusy.applyDisabled(hasProposal: true, state: .streaming))
        XCTAssertTrue(AlertTuningBusy.applyDisabled(hasProposal: true, state: .pausedConfirm))
        XCTAssertFalse(AlertTuningBusy.applyDisabled(hasProposal: true, state: .done))
        XCTAssertFalse(AlertTuningBusy.applyDisabled(hasProposal: true, state: .idle))
    }
}
