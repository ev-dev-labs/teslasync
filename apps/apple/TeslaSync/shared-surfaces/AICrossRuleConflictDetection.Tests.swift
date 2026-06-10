//
//  AICrossRuleConflictDetection.Tests.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  Logic / request / accessibility / i18n coverage for the AICrossRuleConflictDetection surface
//  (the per-adapter decode lives in `…AdapterTests.swift`, the state-holder wiring in
//  `…ModelTests.swift`). These assert the pure web-ported booleans (`AIFeatureCard` /
//  `AiOutputPanel` branches), the memoised request body, the spoken summary, and the per-surface
//  i18n table. No network, no SwiftUI rendering.
//

import XCTest
@testable import TeslaSync

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class RuleConflictLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(RuleConflictLogic.isBusy(.streaming))
        XCTAssertTrue(RuleConflictLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(RuleConflictLogic.isBusy(.idle))
        XCTAssertFalse(RuleConflictLogic.isBusy(.done))
        XCTAssertFalse(RuleConflictLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresTwoRules() {
        // Web `ruleIds.length >= 2` — you cannot have a conflict with one rule.
        XCTAssertFalse(RuleConflictLogic.canStart(ruleCount: 0, phase: .idle))
        XCTAssertFalse(RuleConflictLogic.canStart(ruleCount: 1, phase: .idle))
        XCTAssertTrue(RuleConflictLogic.canStart(ruleCount: 2, phase: .idle))
        XCTAssertTrue(RuleConflictLogic.canStart(ruleCount: 5, phase: .streaming))
        XCTAssertFalse(RuleConflictLogic.canStart(ruleCount: 5, phase: .pausedConfirm))
    }

    func testButtonDisabled() {
        XCTAssertFalse(RuleConflictLogic.buttonDisabled(ruleCount: 2, phase: .idle, connection: .live))
        XCTAssertTrue(RuleConflictLogic.buttonDisabled(ruleCount: 2, phase: .streaming, connection: .live))
        XCTAssertTrue(RuleConflictLogic.buttonDisabled(ruleCount: 1, phase: .idle, connection: .live))
        XCTAssertTrue(RuleConflictLogic.buttonDisabled(ruleCount: 2, phase: .idle, connection: .offline))
        XCTAssertTrue(RuleConflictLogic.buttonDisabled(ruleCount: 2, phase: .pausedConfirm, connection: .live))
    }

    func testOutputVisible() {
        XCTAssertFalse(RuleConflictLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(RuleConflictLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(RuleConflictLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(RuleConflictLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(RuleConflictLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(RuleConflictLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(RuleConflictLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(RuleConflictLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testEmptyAndConflictsVisibility() {
        // nil = nothing detected yet → neither.
        XCTAssertFalse(RuleConflictLogic.showsEmptyMessage(nil))
        XCTAssertFalse(RuleConflictLogic.showsConflicts(nil))
        // [] = resolved, no conflicts → empty message only.
        XCTAssertTrue(RuleConflictLogic.showsEmptyMessage([]))
        XCTAssertFalse(RuleConflictLogic.showsConflicts([]))
        // non-empty → list only.
        let some = [RuleConflict(kind: "k", ruleAID: 1, ruleBID: 2)]
        XCTAssertFalse(RuleConflictLogic.showsEmptyMessage(some))
        XCTAssertTrue(RuleConflictLogic.showsConflicts(some))
    }
}

// MARK: - Request body (web memoised body)

@MainActor final class RuleConflictRequestTests: XCTestCase {
    func testBodyAlwaysSendsRuleIDs() {
        let body = RuleConflictRequest.body(ruleIDs: [11, 12, 13], vehicleID: nil)
        XCTAssertEqual(body["rule_ids"], .array([.number(11), .number(12), .number(13)]))
        XCTAssertNil(body["vehicle_id"])
    }

    func testBodyIncludesVehicleOnlyWhenPresent() {
        let body = RuleConflictRequest.body(ruleIDs: [1, 2], vehicleID: 7)
        XCTAssertEqual(body["vehicle_id"], .number(7))
        XCTAssertEqual(body["rule_ids"], .array([.number(1), .number(2)]))
    }

    func testPathStripsApiPrefix() {
        // The client auto-adds /api/v1; the hook url must not double it.
        XCTAssertEqual(RuleConflictRequest.path, "/ai/alerts/rules/conflicts")
        XCTAssertFalse(RuleConflictRequest.path.hasPrefix("/api/v1"))
    }
}

// MARK: - Accessibility summary

@MainActor final class RuleConflictAccessibilityTests: XCTestCase {
    private func kindLabel(_ kind: String) -> String {
        RuleConflictKind.localization(for: kind)?.fallback ?? kind
    }

    func testTitleOnlyWhenNothingDetected() {
        let summary = RuleConflictAccessibility.summary(
            title: "Detect cross-rule conflicts",
            conflicts: nil,
            emptyLabel: "No conflicts",
            rulePrefix: "Rule",
            kindLabel: kindLabel
        )
        XCTAssertEqual(summary, "Detect cross-rule conflicts")
    }

    func testEmptyAppendsEmptyLabel() {
        let summary = RuleConflictAccessibility.summary(
            title: "Title",
            conflicts: [],
            emptyLabel: "No structural conflicts found.",
            rulePrefix: "Rule",
            kindLabel: kindLabel
        )
        XCTAssertEqual(summary, "Title. No structural conflicts found.")
    }

    func testConflictsAppendKindAndRelation() {
        let conflicts = [
            RuleConflict(kind: "redundant_duplicate", ruleAID: 11, ruleBID: 12),
            RuleConflict(kind: "overlapping_threshold", ruleAID: 12, ruleBID: 13, signalName: "cabin_temp")
        ]
        let summary = RuleConflictAccessibility.summary(
            title: "Title",
            conflicts: conflicts,
            emptyLabel: "No conflicts",
            rulePrefix: "Rule",
            kindLabel: kindLabel
        )
        XCTAssertEqual(
            summary,
            "Title. Redundant duplicate. Rule 11 ↔ Rule 12. Overlapping threshold. Rule 12 ↔ Rule 13 · cabin_temp"
        )
    }
}

// MARK: - i18n facade

@MainActor final class RuleConflictStringsTests: XCTestCase {
    /// The "AICrossRuleConflictDetection" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesParityKeysToFallback() {
        XCTAssertEqual(
            RuleConflictStrings.string("notifications.alertStudio.aiConflicts.title", "Detect cross-rule conflicts"),
            "Detect cross-rule conflicts"
        )
        XCTAssertEqual(
            RuleConflictStrings.string("notifications.alertStudio.aiConflicts.detectButton", "Detect conflicts"),
            "Detect conflicts"
        )
        XCTAssertEqual(RuleConflictStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
    }

    func testTableNameMatchesSurfaceSlug() {
        XCTAssertEqual(RuleConflictStrings.table, RuleConflictSurface.slug)
    }
}
