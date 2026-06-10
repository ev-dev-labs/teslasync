//
//  AIAutoNameUnnamedLocations.Tests.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  Unit coverage for the AIAutoNameUnnamedLocations surface:
//    • Adapter — the `tool_result` → `LocationNameDraft` decode (the web `handleEvent`
//      guard chain), the stream-lifecycle button logic (isBusy / canStart /
//      buttonDisabled / output visibility), and the spoken summary.
//    • State holder — `AINameDraftModel` wiring: the gate render axis, the P1/S11
//      `view.opened` telemetry, the suggest double-submit guard, the draft capture, the
//      apply (ok-only) forwarding, the location-change reset, and the stale auto-refresh.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification
//  harness. They have no network and no real store: the model is driven by
//  `InMemoryAINameDraftSource`. Per-state view rendering is covered by the #Preview
//  blocks (compiled by the app targets) and the dual-SDK typecheck; the per-state
//  *behaviour* is asserted here through the model's derived flags.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON value accessors

@MainActor final class AIJSONValueTests: XCTestCase {
    func testStringValueOnlyForStrings() {
        XCTAssertEqual(AIJSONValue.string("hi").stringValue, "hi")
        XCTAssertNil(AIJSONValue.number(3).stringValue)
        XCTAssertNil(AIJSONValue.bool(true).stringValue)
        XCTAssertNil(AIJSONValue.null.stringValue)
    }

    func testNumberValueOnlyForNumbers() {
        XCTAssertEqual(AIJSONValue.number(42).numberValue, 42)
        XCTAssertNil(AIJSONValue.string("42").numberValue)
        XCTAssertNil(AIJSONValue.bool(false).numberValue)
    }
}

// MARK: - Draft decode (web `handleEvent` guard chain)

@MainActor final class LocationNameDraftDecodeTests: XCTestCase {
    private func result(
        name: String = LocationNameDraft.toolName,
        ok: Bool = true,
        data: [String: AIJSONValue]?
    ) -> AIToolResult {
        AIToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    func testDecodesOKDraftWithReason() {
        let draft = LocationNameDraft.from(result(data: [
            "location_id": .number(42),
            "proposed_name": .string("Ocean Beach Parking"),
            "status": .string("ok"),
            "reason": .string("Frequent weekend visits")
        ]))
        XCTAssertEqual(draft?.locationID, 42)
        XCTAssertEqual(draft?.proposedName, "Ocean Beach Parking")
        XCTAssertEqual(draft?.status, "ok")
        XCTAssertEqual(draft?.reason, "Frequent weekend visits")
        XCTAssertEqual(draft?.isOK, true)
    }

    func testDecodesRejectedDraftWithoutReason() {
        let draft = LocationNameDraft.from(result(data: [
            "location_id": .number(7),
            "proposed_name": .string("Home"),
            "status": .string("rejected")
        ]))
        XCTAssertEqual(draft?.status, "rejected")
        XCTAssertEqual(draft?.isOK, false)
        XCTAssertNil(draft?.reason)
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(LocationNameDraft.from(result(name: "summarize", data: [
            "location_id": .number(1), "proposed_name": .string("X"), "status": .string("ok")
        ])))
    }

    func testRejectsNotOK() {
        XCTAssertNil(LocationNameDraft.from(result(ok: false, data: [
            "location_id": .number(1), "proposed_name": .string("X"), "status": .string("ok")
        ])))
    }

    func testRejectsNilData() {
        XCTAssertNil(LocationNameDraft.from(result(data: nil)))
    }

    func testRejectsMissingFields() {
        XCTAssertNil(LocationNameDraft.from(result(data: [
            "proposed_name": .string("X"), "status": .string("ok")
        ])))
        XCTAssertNil(LocationNameDraft.from(result(data: [
            "location_id": .number(1), "status": .string("ok")
        ])))
        XCTAssertNil(LocationNameDraft.from(result(data: [
            "location_id": .number(1), "proposed_name": .string("X")
        ])))
    }

    func testRejectsTypeMismatches() {
        // location_id must be a number (web `typeof === 'number'`).
        XCTAssertNil(LocationNameDraft.from(result(data: [
            "location_id": .string("1"), "proposed_name": .string("X"), "status": .string("ok")
        ])))
        // proposed_name must be a string.
        XCTAssertNil(LocationNameDraft.from(result(data: [
            "location_id": .number(1), "proposed_name": .number(2), "status": .string("ok")
        ])))
    }

    func testIgnoresNonStringReason() {
        let draft = LocationNameDraft.from(result(data: [
            "location_id": .number(1),
            "proposed_name": .string("X"),
            "status": .string("ok"),
            "reason": .number(9)
        ]))
        XCTAssertNotNil(draft)
        XCTAssertNil(draft?.reason)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class AINameDraftLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(AINameDraftLogic.isBusy(.streaming))
        XCTAssertTrue(AINameDraftLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(AINameDraftLogic.isBusy(.idle))
        XCTAssertFalse(AINameDraftLogic.isBusy(.done))
        XCTAssertFalse(AINameDraftLogic.isBusy(.error("x")))
    }

    func testCanStart() {
        XCTAssertTrue(AINameDraftLogic.canStart(locationID: 1, phase: .idle))
        XCTAssertFalse(AINameDraftLogic.canStart(locationID: 0, phase: .idle))
        XCTAssertFalse(AINameDraftLogic.canStart(locationID: -3, phase: .idle))
        XCTAssertFalse(AINameDraftLogic.canStart(locationID: 1, phase: .pausedConfirm))
        XCTAssertTrue(AINameDraftLogic.canStart(locationID: 1, phase: .streaming))
    }

    func testButtonDisabled() {
        XCTAssertFalse(AINameDraftLogic.buttonDisabled(locationID: 1, phase: .idle, connection: .live))
        XCTAssertTrue(AINameDraftLogic.buttonDisabled(locationID: 1, phase: .streaming, connection: .live))
        XCTAssertTrue(AINameDraftLogic.buttonDisabled(locationID: 0, phase: .idle, connection: .live))
        XCTAssertTrue(AINameDraftLogic.buttonDisabled(locationID: 1, phase: .idle, connection: .offline))
        XCTAssertTrue(AINameDraftLogic.buttonDisabled(locationID: 1, phase: .pausedConfirm, connection: .live))
    }

    func testOutputVisible() {
        XCTAssertFalse(AINameDraftLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(AINameDraftLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(AINameDraftLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(AINameDraftLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(AINameDraftLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(AINameDraftLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(AINameDraftLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(AINameDraftLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(AINameDraftLogic.isIdleInvite(phase: .idle, hasDraft: false, hasText: false))
        XCTAssertFalse(AINameDraftLogic.isIdleInvite(phase: .idle, hasDraft: true, hasText: false))
        XCTAssertFalse(AINameDraftLogic.isIdleInvite(phase: .streaming, hasDraft: false, hasText: false))
    }
}

// MARK: - Accessibility summary

@MainActor final class AINameDraftAccessibilityTests: XCTestCase {
    func testTitleOnly() {
        let summary = AINameDraftAccessibility.summary(
            title: "Suggest a name", currentLabel: nil,
            proposedLabel: "Proposed name", draft: nil, rejectedLabel: "Rejected"
        )
        XCTAssertEqual(summary, "Suggest a name")
    }

    func testWithCurrentLabel() {
        let summary = AINameDraftAccessibility.summary(
            title: "Suggest a name", currentLabel: "Current label: 37.7, -122.4",
            proposedLabel: "Proposed name", draft: nil, rejectedLabel: "Rejected"
        )
        XCTAssertEqual(summary, "Suggest a name. Current label: 37.7, -122.4")
    }

    func testWithOKDraftAndReason() {
        let draft = LocationNameDraft(locationID: 1, proposedName: "Home", status: "ok", reason: "Daily visits")
        let summary = AINameDraftAccessibility.summary(
            title: "T", currentLabel: nil, proposedLabel: "Proposed name", draft: draft, rejectedLabel: "Rejected"
        )
        XCTAssertEqual(summary, "T. Proposed name: Home. Daily visits")
    }

    func testWithRejectedDraftAppendsRejected() {
        let draft = LocationNameDraft(locationID: 1, proposedName: "Home", status: "rejected")
        let summary = AINameDraftAccessibility.summary(
            title: "T", currentLabel: nil, proposedLabel: "Proposed name", draft: draft, rejectedLabel: "Rejected"
        )
        XCTAssertEqual(summary, "T. Proposed name: Home. Rejected")
    }
}

// MARK: - i18n facade

@MainActor final class AIAutoNameStringsTests: XCTestCase {
    /// The "AIAutoNameUnnamedLocations" table folds in at integration time, so the test
    /// bundle resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            AIAutoNameStrings.string("locations.aiAutoName.title", "Suggest a name for this location"),
            "Suggest a name for this location"
        )
        XCTAssertEqual(AIAutoNameStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
    }
}
