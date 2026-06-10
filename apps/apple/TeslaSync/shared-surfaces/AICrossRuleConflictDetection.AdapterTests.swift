//
//  AICrossRuleConflictDetection.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  Pure-adapter coverage for the AICrossRuleConflictDetection surface: the JSON value accessors,
//  the `tool_result` → `[RuleConflict]` decode (the web `handleEvent` walk), the conflict-kind
//  label mapping (web `labelForKind`), the structural-flag projection (`activeFlags` order +
//  chip localisation + tone), and the relationship line. No network, no SwiftUI — these run in
//  the XCTest targets and the SwiftPM verification harness.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON value accessors

@MainActor final class RuleConflictJSONValueTests: XCTestCase {
    func testStringValueOnlyForStrings() {
        XCTAssertEqual(RuleConflictJSONValue.string("hi").stringValue, "hi")
        XCTAssertNil(RuleConflictJSONValue.number(3).stringValue)
        XCTAssertNil(RuleConflictJSONValue.bool(true).stringValue)
        XCTAssertNil(RuleConflictJSONValue.null.stringValue)
    }

    func testNumberValueOnlyForNumbers() {
        XCTAssertEqual(RuleConflictJSONValue.number(42).numberValue, 42)
        XCTAssertNil(RuleConflictJSONValue.string("42").numberValue)
        XCTAssertNil(RuleConflictJSONValue.bool(false).numberValue)
    }

    func testBoolValueOnlyForBools() {
        XCTAssertEqual(RuleConflictJSONValue.bool(true).boolValue, true)
        XCTAssertEqual(RuleConflictJSONValue.bool(false).boolValue, false)
        XCTAssertNil(RuleConflictJSONValue.number(1).boolValue)
        XCTAssertNil(RuleConflictJSONValue.string("true").boolValue)
    }

    func testObjectAndArrayAccessors() {
        XCTAssertEqual(RuleConflictJSONValue.array([.number(1)]).arrayValue?.count, 1)
        XCTAssertNil(RuleConflictJSONValue.string("x").arrayValue)
        XCTAssertEqual(RuleConflictJSONValue.object(["a": .number(1)]).objectValue?.count, 1)
        XCTAssertNil(RuleConflictJSONValue.number(1).objectValue)
    }
}

// MARK: - Conflict decode (web `handleEvent` walk)

@MainActor final class RuleConflictDecodeTests: XCTestCase {
    private func result(
        name: String = RuleConflict.toolName,
        ok: Bool = true,
        data: [String: RuleConflictJSONValue]?
    ) -> RuleConflictToolResult {
        RuleConflictToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    private func conflictObject(
        kind: RuleConflictJSONValue = .string("redundant_duplicate"),
        ruleA: RuleConflictJSONValue? = .number(11),
        ruleB: RuleConflictJSONValue? = .number(12),
        extra: [String: RuleConflictJSONValue] = [:]
    ) -> RuleConflictJSONValue {
        var fields: [String: RuleConflictJSONValue] = ["kind": kind]
        if let ruleA { fields["rule_a_id"] = ruleA }
        if let ruleB { fields["rule_b_id"] = ruleB }
        for (key, value) in extra {
            fields[key] = value
        }
        return .object(fields)
    }

    func testDecodesFullConflictWithAllFields() {
        let conflicts = RuleConflict.list(from: result(data: ["conflicts": .array([
            conflictObject(extra: [
                "rule_a_name": .string("Low battery"),
                "rule_b_name": .string("Battery below 20%"),
                "signal_name": .string("battery_level"),
                "reason": .string("Identical thresholds"),
                "severity_mismatch": .bool(true),
                "cooldown_mismatch": .bool(true),
                "trigger_mode_mismatch": .bool(true),
                "subsumes": .bool(true)
            ])
        ])]))
        XCTAssertEqual(conflicts?.count, 1)
        let conflict = conflicts?.first
        XCTAssertEqual(conflict?.kind, "redundant_duplicate")
        XCTAssertEqual(conflict?.ruleAID, 11)
        XCTAssertEqual(conflict?.ruleBID, 12)
        XCTAssertEqual(conflict?.ruleAName, "Low battery")
        XCTAssertEqual(conflict?.ruleBName, "Battery below 20%")
        XCTAssertEqual(conflict?.signalName, "battery_level")
        XCTAssertEqual(conflict?.reason, "Identical thresholds")
        XCTAssertEqual(conflict?.severityMismatch, true)
        XCTAssertEqual(conflict?.cooldownMismatch, true)
        XCTAssertEqual(conflict?.triggerModeMismatch, true)
        XCTAssertEqual(conflict?.subsumes, true)
    }

    func testDecodesMinimalConflictDefaultsFlagsFalse() {
        let conflicts = RuleConflict.list(from: result(data: ["conflicts": .array([conflictObject()])]))
        let conflict = conflicts?.first
        XCTAssertEqual(conflict?.severityMismatch, false)
        XCTAssertEqual(conflict?.cooldownMismatch, false)
        XCTAssertEqual(conflict?.triggerModeMismatch, false)
        XCTAssertEqual(conflict?.subsumes, false)
        XCTAssertNil(conflict?.ruleAName)
        XCTAssertNil(conflict?.signalName)
    }

    func testEmptyConflictsArrayIsResolvedNotRejected() {
        // Web: conflicts != null && length === 0 → the "no conflicts" capture (distinct from nil).
        let conflicts = RuleConflict.list(from: result(data: ["conflicts": .array([])]))
        XCTAssertEqual(conflicts, [])
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(RuleConflict.list(from: result(name: "summarize", data: ["conflicts": .array([])])))
    }

    func testRejectsNotOK() {
        XCTAssertNil(RuleConflict.list(from: result(ok: false, data: ["conflicts": .array([])])))
    }

    func testRejectsNilData() {
        XCTAssertNil(RuleConflict.list(from: result(data: nil)))
    }

    func testRejectsMissingConflictsArray() {
        XCTAssertNil(RuleConflict.list(from: result(data: ["status": .string("ok")])))
        // A non-array `conflicts` is also rejected (web `Array.isArray`).
        XCTAssertNil(RuleConflict.list(from: result(data: ["conflicts": .string("none")])))
    }

    func testSkipsMalformedElementsButKeepsValidOnes() {
        let conflicts = RuleConflict.list(from: result(data: ["conflicts": .array([
            .null, // not an object → skip
            .string("nope"), // not an object → skip
            conflictObject(ruleA: nil), // missing rule_a_id → skip
            conflictObject(ruleA: .string("11")), // rule_a_id not a number → skip
            conflictObject(kind: .number(1)), // kind not a string → skip
            conflictObject(ruleA: .number(20), ruleB: .number(21)) // valid → kept
        ])]))
        XCTAssertEqual(conflicts?.count, 1)
        XCTAssertEqual(conflicts?.first?.ruleAID, 20)
        XCTAssertEqual(conflicts?.first?.ruleBID, 21)
    }

    func testStrictBooleanFlags() {
        // Web `=== true`: a non-bool / false value never sets the flag.
        let conflicts = RuleConflict.list(from: result(data: ["conflicts": .array([
            conflictObject(extra: [
                "subsumes": .string("true"),
                "severity_mismatch": .number(1),
                "cooldown_mismatch": .bool(false)
            ])
        ])]))
        let conflict = conflicts?.first
        XCTAssertEqual(conflict?.subsumes, false)
        XCTAssertEqual(conflict?.severityMismatch, false)
        XCTAssertEqual(conflict?.cooldownMismatch, false)
    }

    func testStableIdentity() {
        let conflict = RuleConflict(kind: "overlapping_threshold", ruleAID: 5, ruleBID: 9)
        XCTAssertEqual(conflict.id, "overlapping_threshold:5:9")
    }
}

// MARK: - Kind label mapping (web `labelForKind`)

@MainActor final class RuleConflictKindTests: XCTestCase {
    func testKnownKindsMapToKeys() {
        let redundant = RuleConflictKind.localization(for: "redundant_duplicate")
        XCTAssertEqual(redundant?.key, "notifications.alertStudio.aiConflicts.kind.redundant_duplicate")
        XCTAssertEqual(redundant?.fallback, "Redundant duplicate")

        let overlapping = RuleConflictKind.localization(for: "overlapping_threshold")
        XCTAssertEqual(overlapping?.key, "notifications.alertStudio.aiConflicts.kind.overlapping_threshold")
        XCTAssertEqual(overlapping?.fallback, "Overlapping threshold")
    }

    func testUnknownKindHasNoMapping() {
        // Web `labelForKind` returns the raw kind verbatim for an unknown class.
        XCTAssertNil(RuleConflictKind.localization(for: "some_future_kind"))
    }
}

// MARK: - Structural-flag projection (chips)

@MainActor final class RuleConflictFlagTests: XCTestCase {
    func testActiveFlagsOrderMatchesWeb() {
        let conflict = RuleConflict(
            kind: "redundant_duplicate",
            ruleAID: 1,
            ruleBID: 2,
            severityMismatch: true,
            cooldownMismatch: true,
            triggerModeMismatch: true,
            subsumes: true
        )
        XCTAssertEqual(
            conflict.activeFlags(),
            [.subsumes, .severityMismatch, .cooldownMismatch, .triggerModeMismatch]
        )
    }

    func testActiveFlagsSubsetAndEmpty() {
        let none = RuleConflict(kind: "k", ruleAID: 1, ruleBID: 2)
        XCTAssertTrue(none.activeFlags().isEmpty)

        let some = RuleConflict(kind: "k", ruleAID: 1, ruleBID: 2, cooldownMismatch: true, subsumes: true)
        XCTAssertEqual(some.activeFlags(), [.subsumes, .cooldownMismatch])
    }

    func testFlagToneAndLocalization() {
        XCTAssertTrue(RuleConflictFlag.subsumes.isWarningTone)
        XCTAssertFalse(RuleConflictFlag.severityMismatch.isWarningTone)
        XCTAssertFalse(RuleConflictFlag.cooldownMismatch.isWarningTone)
        XCTAssertFalse(RuleConflictFlag.triggerModeMismatch.isWarningTone)

        XCTAssertEqual(
            RuleConflictFlag.triggerModeMismatch.localization.key,
            "notifications.alertStudio.aiConflicts.chip.triggerModeMismatch"
        )
        XCTAssertEqual(RuleConflictFlag.subsumes.localization.fallback, "Subsumes")
    }
}

// MARK: - Relationship line (web secondary text)

@MainActor final class RuleConflictRelationTests: XCTestCase {
    func testFullRelationWithNamesAndSignal() {
        let conflict = RuleConflict(
            kind: "k",
            ruleAID: 11,
            ruleBID: 12,
            ruleAName: "Low battery",
            ruleBName: "Below 20%",
            signalName: "battery_level"
        )
        XCTAssertEqual(
            conflict.relationDescription(rulePrefix: "Rule"),
            "Rule 11 (Low battery) ↔ Rule 12 (Below 20%) · battery_level"
        )
    }

    func testBareRelationWithoutOptionalParts() {
        let conflict = RuleConflict(kind: "k", ruleAID: 3, ruleBID: 4)
        XCTAssertEqual(conflict.relationDescription(rulePrefix: "Rule"), "Rule 3 ↔ Rule 4")
    }
}
