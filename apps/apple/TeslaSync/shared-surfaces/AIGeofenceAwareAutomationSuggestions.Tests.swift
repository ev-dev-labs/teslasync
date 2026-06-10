//
//  AIGeofenceAwareAutomationSuggestions.Tests.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  Unit coverage for the AIGeofenceAwareAutomationSuggestions surface:
//    • Adapter — the `tool_result` → `GeofenceAutomationDraft` decode (the web
//      `handleEvent` + `normalizeAutomationInput` guard chains), the prompt/stream-
//      lifecycle button logic (isBusy / canStart / buttonDisabled / output visibility /
//      emptyHint), and the spoken summary.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification
//  harness. They have no network and no real store. Per-state view rendering is covered by
//  the #Preview blocks (compiled by the app targets) and the dual-SDK typecheck; the per-
//  state *behaviour* is asserted in `…ModelTests.swift` through the model's derived flags.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON value accessors

@MainActor final class GeofenceAutomationJSONTests: XCTestCase {
    func testStringValueOnlyForStrings() {
        XCTAssertEqual(GeofenceAutomationJSON.string("hi").stringValue, "hi")
        XCTAssertNil(GeofenceAutomationJSON.number(3).stringValue)
        XCTAssertNil(GeofenceAutomationJSON.bool(true).stringValue)
        XCTAssertNil(GeofenceAutomationJSON.null.stringValue)
    }

    func testNumberValueOnlyForNumbers() {
        XCTAssertEqual(GeofenceAutomationJSON.number(42).numberValue, 42)
        XCTAssertNil(GeofenceAutomationJSON.string("42").numberValue)
        XCTAssertNil(GeofenceAutomationJSON.bool(false).numberValue)
    }

    func testBoolValueOnlyForBools() {
        XCTAssertEqual(GeofenceAutomationJSON.bool(true).boolValue, true)
        XCTAssertNil(GeofenceAutomationJSON.number(1).boolValue)
        XCTAssertNil(GeofenceAutomationJSON.string("true").boolValue)
    }

    func testArrayAndObjectValues() {
        XCTAssertEqual(GeofenceAutomationJSON.array([.null]).arrayValue, [.null])
        XCTAssertNil(GeofenceAutomationJSON.string("x").arrayValue)
        XCTAssertEqual(GeofenceAutomationJSON.object(["a": .number(1)]).objectValue, ["a": .number(1)])
        XCTAssertNil(GeofenceAutomationJSON.array([]).objectValue)
    }
}

// MARK: - Graph normalize (web `normalizeAutomationInput`)

@MainActor final class GeofenceAutomationNormalizeTests: XCTestCase {
    private func nodes(_ count: Int) -> GeofenceAutomationJSON {
        .array(Array(repeating: .object([:]), count: count))
    }

    private func graph(
        name: GeofenceAutomationJSON? = .string("Home guard"),
        description: GeofenceAutomationJSON? = nil,
        vehicleID: GeofenceAutomationJSON? = .number(42),
        enabled: GeofenceAutomationJSON? = .bool(true),
        triggers: GeofenceAutomationJSON? = .array([.object([:])]),
        conditions: GeofenceAutomationJSON? = .array([.object([:]), .object([:])]),
        actions: GeofenceAutomationJSON? = .array([.object([:])])
    ) -> GeofenceAutomationJSON {
        var obj: [String: GeofenceAutomationJSON] = [:]
        if let name { obj["name"] = name }
        if let description { obj["description"] = description }
        if let vehicleID { obj["vehicle_id"] = vehicleID }
        if let enabled { obj["enabled"] = enabled }
        if let triggers { obj["triggers"] = triggers }
        if let conditions { obj["conditions"] = conditions }
        if let actions { obj["actions"] = actions }
        return .object(obj)
    }

    func testNormalizesFullGraphWithCounts() {
        let input = GeofenceAutomationInput.normalize(graph(
            description: .string("Enables overheat protection."),
            triggers: nodes(1), conditions: nodes(2), actions: nodes(3)
        ))
        XCTAssertEqual(input?.name, "Home guard")
        XCTAssertEqual(input?.description, "Enables overheat protection.")
        XCTAssertEqual(input?.vehicleID, 42)
        XCTAssertEqual(input?.enabled, true)
        XCTAssertEqual(input?.triggers.count, 1)
        XCTAssertEqual(input?.conditions.count, 2)
        XCTAssertEqual(input?.actions.count, 3)
    }

    func testDescriptionDefaultsToEmpty() {
        let input = GeofenceAutomationInput.normalize(graph(description: nil))
        XCTAssertEqual(input?.description, "")
    }

    func testNonStringDescriptionFallsBackToEmpty() {
        let input = GeofenceAutomationInput.normalize(graph(description: .number(9)))
        XCTAssertEqual(input?.description, "")
    }

    func testRejectsNonObject() {
        XCTAssertNil(GeofenceAutomationInput.normalize(.string("nope")))
        XCTAssertNil(GeofenceAutomationInput.normalize(nil))
    }

    func testRejectsMissingRequiredFields() {
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(name: nil)))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(vehicleID: nil)))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(enabled: nil)))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(triggers: nil)))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(conditions: nil)))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(actions: nil)))
    }

    func testRejectsTypeMismatches() {
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(name: .number(1))))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(vehicleID: .string("42"))))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(enabled: .string("true"))))
        // triggers/conditions/actions must be arrays, not objects.
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(triggers: .object([:]))))
        XCTAssertNil(GeofenceAutomationInput.normalize(graph(actions: .number(2))))
    }

    func testAcceptsEmptyNodeArrays() {
        let input = GeofenceAutomationInput.normalize(graph(
            triggers: .array([]), conditions: .array([]), actions: .array([])
        ))
        XCTAssertEqual(input?.triggers.count, 0)
        XCTAssertEqual(input?.conditions.count, 0)
        XCTAssertEqual(input?.actions.count, 0)
    }
}

// MARK: - Draft decode (web `handleEvent` wrapper guard chain)

@MainActor final class GeofenceAutomationDraftDecodeTests: XCTestCase {
    private var okGraph: GeofenceAutomationJSON {
        .object([
            "name": .string("Home guard"),
            "description": .string("desc"),
            "vehicle_id": .number(42),
            "enabled": .bool(true),
            "triggers": .array([.object([:])]),
            "conditions": .array([]),
            "actions": .array([.object([:]), .object([:])])
        ])
    }

    private func result(
        name: String = GeofenceAutomationDraft.toolName,
        ok: Bool = true,
        data: [String: GeofenceAutomationJSON]?
    ) -> GeofenceAutomationToolResult {
        GeofenceAutomationToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    func testDecodesOKDraftWithValidationError() {
        let draft = GeofenceAutomationDraft.from(result(data: [
            "draft": okGraph,
            "status": .string("ok"),
            "validation_error": .string("note")
        ]))
        XCTAssertEqual(draft?.input.name, "Home guard")
        XCTAssertEqual(draft?.input.triggers.count, 1)
        XCTAssertEqual(draft?.input.actions.count, 2)
        XCTAssertEqual(draft?.status, "ok")
        XCTAssertEqual(draft?.isOK, true)
        XCTAssertEqual(draft?.validationError, "note")
    }

    func testDecodesInvalidDraftWithoutValidationError() {
        let draft = GeofenceAutomationDraft.from(result(data: [
            "draft": okGraph,
            "status": .string("invalid")
        ]))
        XCTAssertEqual(draft?.status, "invalid")
        XCTAssertEqual(draft?.isOK, false)
        XCTAssertNil(draft?.validationError)
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(GeofenceAutomationDraft.from(result(
            name: "summarize", data: ["draft": okGraph, "status": .string("ok")]
        )))
    }

    func testRejectsNotOK() {
        XCTAssertNil(GeofenceAutomationDraft.from(result(
            ok: false, data: ["draft": okGraph, "status": .string("ok")]
        )))
    }

    func testRejectsNilData() {
        XCTAssertNil(GeofenceAutomationDraft.from(result(data: nil)))
    }

    func testRejectsMissingStatus() {
        XCTAssertNil(GeofenceAutomationDraft.from(result(data: ["draft": okGraph])))
    }

    func testRejectsNonStringStatus() {
        XCTAssertNil(GeofenceAutomationDraft.from(result(data: [
            "draft": okGraph, "status": .number(1)
        ])))
    }

    func testRejectsMissingDraft() {
        XCTAssertNil(GeofenceAutomationDraft.from(result(data: ["status": .string("ok")])))
    }

    func testRejectsMalformedDraft() {
        // A draft missing `vehicle_id` fails normalize → the whole frame is dropped.
        let bad = GeofenceAutomationJSON.object(["name": .string("X"), "enabled": .bool(true)])
        XCTAssertNil(GeofenceAutomationDraft.from(result(data: [
            "draft": bad, "status": .string("ok")
        ])))
    }

    func testIgnoresNonStringValidationError() {
        let draft = GeofenceAutomationDraft.from(result(data: [
            "draft": okGraph, "status": .string("ok"), "validation_error": .number(9)
        ]))
        XCTAssertNotNil(draft)
        XCTAssertNil(draft?.validationError)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class GeofenceAutomationLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(GeofenceAutomationLogic.isBusy(.streaming))
        XCTAssertTrue(GeofenceAutomationLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(GeofenceAutomationLogic.isBusy(.idle))
        XCTAssertFalse(GeofenceAutomationLogic.isBusy(.done))
        XCTAssertFalse(GeofenceAutomationLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresVehiclePromptAndNotPaused() {
        XCTAssertTrue(GeofenceAutomationLogic.canStart(vehicleID: 1, prompt: "go", phase: .idle))
        XCTAssertFalse(GeofenceAutomationLogic.canStart(vehicleID: 0, prompt: "go", phase: .idle))
        XCTAssertFalse(GeofenceAutomationLogic.canStart(vehicleID: -2, prompt: "go", phase: .idle))
        XCTAssertFalse(GeofenceAutomationLogic.canStart(vehicleID: 1, prompt: "", phase: .idle))
        XCTAssertFalse(GeofenceAutomationLogic.canStart(vehicleID: 1, prompt: "   \n ", phase: .idle))
        XCTAssertFalse(GeofenceAutomationLogic.canStart(vehicleID: 1, prompt: "go", phase: .pausedConfirm))
        XCTAssertTrue(GeofenceAutomationLogic.canStart(vehicleID: 1, prompt: "go", phase: .streaming))
    }

    func testButtonDisabled() {
        XCTAssertFalse(GeofenceAutomationLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(GeofenceAutomationLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(GeofenceAutomationLogic.buttonDisabled(
            vehicleID: 0, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(GeofenceAutomationLogic.buttonDisabled(
            vehicleID: 1, prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(GeofenceAutomationLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(GeofenceAutomationLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(GeofenceAutomationLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(GeofenceAutomationLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(GeofenceAutomationLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(GeofenceAutomationLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(GeofenceAutomationLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(GeofenceAutomationLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(GeofenceAutomationLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(GeofenceAutomationLogic.isIdleInvite(phase: .idle, hasDraft: false, hasText: false))
        XCTAssertFalse(GeofenceAutomationLogic.isIdleInvite(phase: .idle, hasDraft: true, hasText: false))
        XCTAssertFalse(GeofenceAutomationLogic.isIdleInvite(phase: .streaming, hasDraft: false, hasText: false))
    }

    func testEmptyHintPicksFirstUnmetPredicate() {
        XCTAssertEqual(
            GeofenceAutomationLogic.emptyHint(vehicleID: 0, prompt: "go", phase: .idle), .selectVehicle
        )
        XCTAssertEqual(
            GeofenceAutomationLogic.emptyHint(vehicleID: 5, prompt: "  ", phase: .idle), .describeAutomation
        )
        XCTAssertNil(GeofenceAutomationLogic.emptyHint(vehicleID: 5, prompt: "go", phase: .idle))
        // No hint while busy/paused — the disabled reason there is the stream, not input.
        XCTAssertNil(GeofenceAutomationLogic.emptyHint(vehicleID: 0, prompt: "", phase: .streaming))
        XCTAssertNil(GeofenceAutomationLogic.emptyHint(vehicleID: 0, prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class GeofenceAutomationAccessibilityTests: XCTestCase {
    private let labels = GeofenceAutomationAccessibility.Labels(
        title: "Suggest a geofence-aware automation",
        proposed: "Proposed automation",
        unnamed: "(unnamed)",
        triggers: "Triggers",
        conditions: "Conditions",
        actions: "Actions",
        rejected: "Proposal rejected by validator"
    )

    private func input(
        name: String,
        description: String = "",
        triggers: Int,
        conditions: Int,
        actions: Int
    ) -> GeofenceAutomationInput {
        let nodes: (Int) -> [GeofenceAutomationJSON] = { Array(repeating: .object([:]), count: $0) }
        return GeofenceAutomationInput(
            name: name, description: description, vehicleID: 1, enabled: true,
            triggers: nodes(triggers), conditions: nodes(conditions), actions: nodes(actions)
        )
    }

    func testTitleOnlyWhenNoDraft() {
        let summary = GeofenceAutomationAccessibility.summary(labels: labels, draft: nil)
        XCTAssertEqual(summary, "Suggest a geofence-aware automation")
    }

    func testOKDraftReadsNameDescriptionAndCounts() {
        let draft = GeofenceAutomationDraft(
            input: input(
                name: "Home guard",
                description: "Overheat protection",
                triggers: 1,
                conditions: 2,
                actions: 3
            ),
            status: "ok"
        )
        let summary = GeofenceAutomationAccessibility.summary(labels: labels, draft: draft)
        XCTAssertEqual(
            summary,
            "Suggest a geofence-aware automation. Proposed automation: Home guard. Overheat protection. "
                + "Triggers: 1. Conditions: 2. Actions: 3"
        )
    }

    func testUnnamedDraftUsesFallbackNameAndAppendsRejected() {
        let draft = GeofenceAutomationDraft(
            input: input(name: "", triggers: 0, conditions: 0, actions: 0),
            status: "invalid",
            validationError: "No geofence matched"
        )
        let summary = GeofenceAutomationAccessibility.summary(labels: labels, draft: draft)
        XCTAssertEqual(
            summary,
            "Suggest a geofence-aware automation. Proposed automation: (unnamed). "
                + "Triggers: 0. Conditions: 0. Actions: 0. No geofence matched. "
                + "Proposal rejected by validator"
        )
    }
}

// MARK: - i18n facade

@MainActor final class GeofenceAutomationStringsTests: XCTestCase {
    /// The "AIGeofenceAwareAutomationSuggestions" table folds in at integration time, so the
    /// test bundle resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            GeofenceAutomationStrings.string(
                "automations.builder.aiGeofenceAware.title", "Suggest a geofence-aware automation"
            ),
            "Suggest a geofence-aware automation"
        )
        XCTAssertEqual(GeofenceAutomationStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
    }
}
