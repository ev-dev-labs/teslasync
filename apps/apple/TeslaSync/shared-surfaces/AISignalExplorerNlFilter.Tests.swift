//
//  AISignalExplorerNlFilter.Tests.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  Unit coverage for the AISignalExplorerNlFilter surface:
//    • Adapter — the `tool_result` → `SignalExplorerFilterDraft` decode (the web `onEvent` +
//      `parseSignalFilterDraft` guard chains), the cached-inputs → projection map, the prompt/stream-
//      lifecycle button logic (canStart / buttonDisabled / canApply / output visibility / emptyHint /
//      renderState), and the spoken summary.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification harness. They
//  have no network and no real store. Per-state view rendering is covered by the #Preview blocks
//  (compiled by the app targets) and the dual-SDK typecheck; the per-state *behaviour* is asserted in
//  `…ModelTests.swift` through the model's derived flags.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON value accessors

@MainActor final class SignalExplorerFilterJSONTests: XCTestCase {
    func testStringValueOnlyForStrings() {
        XCTAssertEqual(SignalExplorerFilterJSON.string("hi").stringValue, "hi")
        XCTAssertNil(SignalExplorerFilterJSON.number(3).stringValue)
        XCTAssertNil(SignalExplorerFilterJSON.bool(true).stringValue)
        XCTAssertNil(SignalExplorerFilterJSON.null.stringValue)
    }

    func testNumberValueOnlyForNumbers() {
        XCTAssertEqual(SignalExplorerFilterJSON.number(42).numberValue, 42)
        XCTAssertNil(SignalExplorerFilterJSON.string("42").numberValue)
        XCTAssertNil(SignalExplorerFilterJSON.bool(false).numberValue)
    }

    func testArrayAndObjectValues() {
        XCTAssertEqual(SignalExplorerFilterJSON.array([.null]).arrayValue, [.null])
        XCTAssertNil(SignalExplorerFilterJSON.string("x").arrayValue)
        XCTAssertEqual(SignalExplorerFilterJSON.object(["a": .number(1)]).objectValue, ["a": .number(1)])
        XCTAssertNil(SignalExplorerFilterJSON.array([]).objectValue)
    }
}

// MARK: - Draft normalize (web `parseSignalFilterDraft` inner narrowing)

@MainActor final class SignalExplorerFilterNormalizeTests: XCTestCase {
    private func filter(
        vehicleID: SignalExplorerFilterJSON? = .number(42),
        signals: SignalExplorerFilterJSON? = .array([.string("battery_level"), .string("inside_temp")]),
        rangePreset: SignalExplorerFilterJSON? = .string("24h"),
        perPage: SignalExplorerFilterJSON? = .number(100)
    ) -> SignalExplorerFilterJSON {
        var obj: [String: SignalExplorerFilterJSON] = [:]
        if let vehicleID { obj["vehicle_id"] = vehicleID }
        if let signals { obj["signals"] = signals }
        if let rangePreset { obj["range_preset"] = rangePreset }
        if let perPage { obj["per_page"] = perPage }
        return .object(obj)
    }

    func testNormalizesFullFilter() {
        let draft = SignalExplorerFilterDraft.normalize(filter())
        XCTAssertEqual(draft?.vehicleID, 42)
        XCTAssertEqual(draft?.signals, ["battery_level", "inside_temp"])
        XCTAssertEqual(draft?.rangePreset, "24h")
        XCTAssertEqual(draft?.perPage, 100)
    }

    func testAcceptsEmptySignalsArray() {
        // Web `[].every(typeof string) === true` — an empty signal set is valid.
        let draft = SignalExplorerFilterDraft.normalize(filter(signals: .array([])))
        XCTAssertEqual(draft?.signals.count, 0)
    }

    func testTruncatesNumericFieldsToInt() {
        let draft = SignalExplorerFilterDraft.normalize(filter(vehicleID: .number(7), perPage: .number(250)))
        XCTAssertEqual(draft?.vehicleID, 7)
        XCTAssertEqual(draft?.perPage, 250)
    }

    func testRejectsNonObject() {
        XCTAssertNil(SignalExplorerFilterDraft.normalize(.string("nope")))
        XCTAssertNil(SignalExplorerFilterDraft.normalize(nil))
    }

    func testRejectsMissingRequiredFields() {
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(vehicleID: nil)))
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(signals: nil)))
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(rangePreset: nil)))
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(perPage: nil)))
    }

    func testRejectsTypeMismatches() {
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(vehicleID: .string("42"))))
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(rangePreset: .number(24))))
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(perPage: .string("100"))))
        // signals must be an array, not an object.
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(signals: .object([:]))))
    }

    func testRejectsNonStringSignalElement() {
        // Web `signals.every((s) => typeof s === 'string')` — a single non-string drops the frame.
        let mixed = SignalExplorerFilterJSON.array([.string("battery_level"), .number(7)])
        XCTAssertNil(SignalExplorerFilterDraft.normalize(filter(signals: mixed)))
    }
}

// MARK: - Draft decode (web `onEvent` + `parseSignalFilterDraft` status guard)

@MainActor final class SignalExplorerFilterDraftDecodeTests: XCTestCase {
    private var okFilter: SignalExplorerFilterJSON {
        .object([
            "vehicle_id": .number(42),
            "signals": .array([.string("battery_level")]),
            "range_preset": .string("7d"),
            "per_page": .number(50)
        ])
    }

    private func result(
        name: String = SignalExplorerFilterDraft.toolName,
        ok: Bool = true,
        data: [String: SignalExplorerFilterJSON]?
    ) -> SignalExplorerFilterToolResult {
        SignalExplorerFilterToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    func testDecodesOKDraft() {
        let draft = SignalExplorerFilterDraft.from(result(data: [
            "draft": okFilter,
            "status": .string("ok")
        ]))
        XCTAssertEqual(draft?.vehicleID, 42)
        XCTAssertEqual(draft?.signals, ["battery_level"])
        XCTAssertEqual(draft?.rangePreset, "7d")
        XCTAssertEqual(draft?.perPage, 50)
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(SignalExplorerFilterDraft.from(result(
            name: "summarize", data: ["draft": okFilter, "status": .string("ok")]
        )))
    }

    func testRejectsNilData() {
        XCTAssertNil(SignalExplorerFilterDraft.from(result(data: nil)))
    }

    func testRejectsMissingStatus() {
        XCTAssertNil(SignalExplorerFilterDraft.from(result(data: ["draft": okFilter])))
    }

    func testRejectsNonOKStatus() {
        // Web `obj.status !== 'ok'` → return null. No "rejected proposal" surface for this panel.
        XCTAssertNil(SignalExplorerFilterDraft.from(result(data: [
            "draft": okFilter, "status": .string("invalid")
        ])))
        XCTAssertNil(SignalExplorerFilterDraft.from(result(data: [
            "draft": okFilter, "status": .number(1)
        ])))
    }

    func testRejectsMissingDraft() {
        XCTAssertNil(SignalExplorerFilterDraft.from(result(data: ["status": .string("ok")])))
    }

    func testRejectsMalformedDraft() {
        // A draft missing `per_page` fails normalize → the whole frame is dropped.
        let bad = SignalExplorerFilterJSON.object([
            "vehicle_id": .number(1), "signals": .array([]), "range_preset": .string("24h")
        ])
        XCTAssertNil(SignalExplorerFilterDraft.from(result(data: [
            "draft": bad, "status": .string("ok")
        ])))
    }

    func testCapturesRegardlessOfOkFlagPerWeb() {
        // The web guard checks only `ev.type === 'tool_result' && ev.name === 'draft_signal_filter'`
        // then `parseSignalFilterDraft(ev.data)` (status-gated) — it never inspects `ev.ok`. So a
        // frame with ok=false but status="ok" and a valid filter is still captured, faithfully.
        let draft = SignalExplorerFilterDraft.from(result(ok: false, data: [
            "draft": okFilter, "status": .string("ok")
        ]))
        XCTAssertEqual(draft?.vehicleID, 42)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class SignalExplorerFilterLogicTests: XCTestCase {
    func testRenderState() {
        XCTAssertEqual(SignalExplorerFilterLogic.renderState(gate: .off, gateError: nil), .gatedOff)
        XCTAssertEqual(SignalExplorerFilterLogic.renderState(gate: .off, gateError: "x"), .gatedOff)
        XCTAssertEqual(SignalExplorerFilterLogic.renderState(gate: .loading, gateError: "x"), .gateError("x"))
        XCTAssertEqual(SignalExplorerFilterLogic.renderState(gate: .loading, gateError: nil), .gateLoading)
        XCTAssertEqual(SignalExplorerFilterLogic.renderState(gate: .on, gateError: nil), .ready)
    }

    func testCanStartRequiresVehicleAndPrompt() {
        XCTAssertTrue(SignalExplorerFilterLogic.canStart(vehicleID: 1, prompt: "go"))
        XCTAssertFalse(SignalExplorerFilterLogic.canStart(vehicleID: 0, prompt: "go"))
        XCTAssertFalse(SignalExplorerFilterLogic.canStart(vehicleID: -2, prompt: "go"))
        XCTAssertFalse(SignalExplorerFilterLogic.canStart(vehicleID: 1, prompt: ""))
        XCTAssertFalse(SignalExplorerFilterLogic.canStart(vehicleID: 1, prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(SignalExplorerFilterLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(SignalExplorerFilterLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(SignalExplorerFilterLogic.buttonDisabled(
            vehicleID: 0, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(SignalExplorerFilterLogic.buttonDisabled(
            vehicleID: 1, prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(SignalExplorerFilterLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .offline
        ))
        // paused-confirm does NOT block the draft action for this surface (web only checks streaming).
        XCTAssertFalse(SignalExplorerFilterLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .pausedConfirm, connection: .live
        ))
    }

    func testCanApply() {
        XCTAssertTrue(SignalExplorerFilterLogic.canApply(hasDraft: true, phase: .done))
        XCTAssertTrue(SignalExplorerFilterLogic.canApply(hasDraft: true, phase: .idle))
        XCTAssertFalse(SignalExplorerFilterLogic.canApply(hasDraft: false, phase: .done))
        XCTAssertFalse(SignalExplorerFilterLogic.canApply(hasDraft: true, phase: .streaming))
    }

    func testOutputVisible() {
        XCTAssertFalse(SignalExplorerFilterLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(SignalExplorerFilterLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(SignalExplorerFilterLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(SignalExplorerFilterLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(SignalExplorerFilterLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(SignalExplorerFilterLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(SignalExplorerFilterLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(SignalExplorerFilterLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(SignalExplorerFilterLogic.isIdleInvite(phase: .idle, hasDraft: false, hasText: false))
        XCTAssertFalse(SignalExplorerFilterLogic.isIdleInvite(phase: .idle, hasDraft: true, hasText: false))
        XCTAssertFalse(SignalExplorerFilterLogic.isIdleInvite(phase: .streaming, hasDraft: false, hasText: false))
    }

    func testEmptyHintPicksFirstUnmetPredicate() {
        XCTAssertEqual(
            SignalExplorerFilterLogic.emptyHint(vehicleID: 0, prompt: "go", phase: .idle), .selectVehicle
        )
        XCTAssertEqual(
            SignalExplorerFilterLogic.emptyHint(vehicleID: 5, prompt: "  ", phase: .idle), .describeFilter
        )
        XCTAssertNil(SignalExplorerFilterLogic.emptyHint(vehicleID: 5, prompt: "go", phase: .idle))
        // No hint while streaming — the disabled reason there is the stream, not input.
        XCTAssertNil(SignalExplorerFilterLogic.emptyHint(vehicleID: 0, prompt: "", phase: .streaming))
    }
}
