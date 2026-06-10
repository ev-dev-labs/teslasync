//
//  AIInboxAutoCategorization.Tests.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  Logic / request / accessibility / i18n coverage for the AIInboxAutoCategorization surface (the
//  per-adapter decode lives in `…AdapterTests.swift`, the state-holder wiring in
//  `…ModelTests.swift`). These assert the pure web-ported booleans (`AIFeatureCard` /
//  `AiOutputPanel` / Apply-button branches), the captured-proposal rule-id union (web `allRuleIds`),
//  the memoised request body, the spoken summary, and the per-surface i18n table. No network, no
//  SwiftUI rendering.
//

import XCTest
@testable import TeslaSync

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel + Apply)

@MainActor final class InboxCategoryLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(InboxCategoryLogic.isBusy(.streaming))
        XCTAssertTrue(InboxCategoryLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(InboxCategoryLogic.isBusy(.idle))
        XCTAssertFalse(InboxCategoryLogic.isBusy(.done))
        XCTAssertFalse(InboxCategoryLogic.isBusy(.error("x")))
    }

    func testCanStartBlockedOnlyByPausedConfirm() {
        // Web `canStart={state !== 'paused-confirm'}` — no scope minimum for the inbox categorize.
        XCTAssertTrue(InboxCategoryLogic.canStart(phase: .idle))
        XCTAssertTrue(InboxCategoryLogic.canStart(phase: .streaming))
        XCTAssertTrue(InboxCategoryLogic.canStart(phase: .done))
        XCTAssertTrue(InboxCategoryLogic.canStart(phase: .error("x")))
        XCTAssertFalse(InboxCategoryLogic.canStart(phase: .pausedConfirm))
    }

    func testSuggestDisabled() {
        XCTAssertFalse(InboxCategoryLogic.suggestDisabled(phase: .idle, connection: .live))
        XCTAssertTrue(InboxCategoryLogic.suggestDisabled(phase: .streaming, connection: .live))
        XCTAssertTrue(InboxCategoryLogic.suggestDisabled(phase: .pausedConfirm, connection: .live))
        XCTAssertTrue(InboxCategoryLogic.suggestDisabled(phase: .idle, connection: .offline))
    }

    func testApplyDisabled() {
        // Web `applyDisabled = allRuleIds.length === 0 || isBusy`.
        XCTAssertTrue(InboxCategoryLogic.applyDisabled(buckets: nil, phase: .idle))
        XCTAssertTrue(InboxCategoryLogic.applyDisabled(buckets: [], phase: .idle))
        let noIDs = [InboxCategoryBucket(category: "A", count: 1)]
        XCTAssertTrue(InboxCategoryLogic.applyDisabled(buckets: noIDs, phase: .idle))
        let withIDs = [InboxCategoryBucket(category: "A", count: 1, ruleIDs: [11])]
        XCTAssertFalse(InboxCategoryLogic.applyDisabled(buckets: withIDs, phase: .idle))
        XCTAssertTrue(InboxCategoryLogic.applyDisabled(buckets: withIDs, phase: .streaming))
    }

    func testAllRuleIDsAreDedupedAndSorted() {
        let buckets = [
            InboxCategoryBucket(category: "A", count: 1, ruleIDs: [30, 11]),
            InboxCategoryBucket(category: "B", count: 2, ruleIDs: [11, 12]),
            InboxCategoryBucket(category: "C", count: 3)
        ]
        XCTAssertEqual(InboxCategoryLogic.allRuleIDs(buckets), [11, 12, 30])
        XCTAssertEqual(InboxCategoryLogic.allRuleIDs(nil), [])
        XCTAssertEqual(InboxCategoryLogic.allRuleIDs([]), [])
    }

    func testOutputVisible() {
        XCTAssertFalse(InboxCategoryLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(InboxCategoryLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(InboxCategoryLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(InboxCategoryLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(InboxCategoryLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(InboxCategoryLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(InboxCategoryLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(InboxCategoryLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testProposalAndEmptyVisibility() {
        // nil = nothing suggested yet → neither.
        XCTAssertFalse(InboxCategoryLogic.showsProposal(nil))
        XCTAssertFalse(InboxCategoryLogic.showsEmptyProposal(nil))
        // [] = resolved, no categories → empty message only.
        XCTAssertTrue(InboxCategoryLogic.showsEmptyProposal([]))
        XCTAssertFalse(InboxCategoryLogic.showsProposal([]))
        // non-empty → chip list only.
        let some = [InboxCategoryBucket(category: "A", count: 1)]
        XCTAssertFalse(InboxCategoryLogic.showsEmptyProposal(some))
        XCTAssertTrue(InboxCategoryLogic.showsProposal(some))
    }
}

// MARK: - Request body (web memoised body)

@MainActor final class InboxCategoryRequestTests: XCTestCase {
    func testBodyOmitsEmptyAndNilFields() {
        let body = InboxCategoryRequest.body(vehicleID: nil, windowDays: nil, severities: [], ruleIDs: [])
        XCTAssertTrue(body.isEmpty)
    }

    func testBodyIncludesEveryPresentField() {
        let body = InboxCategoryRequest.body(
            vehicleID: 7,
            windowDays: 14,
            severities: ["critical", "warning"],
            ruleIDs: [11, 12]
        )
        XCTAssertEqual(body["vehicle_id"], .number(7))
        XCTAssertEqual(body["window_days"], .number(14))
        XCTAssertEqual(body["severities"], .array([.string("critical"), .string("warning")]))
        XCTAssertEqual(body["rule_ids"], .array([.number(11), .number(12)]))
    }

    func testBodyIncludesOnlyThePresentSubset() {
        let body = InboxCategoryRequest.body(vehicleID: 7, windowDays: nil, severities: [], ruleIDs: [])
        XCTAssertEqual(body["vehicle_id"], .number(7))
        XCTAssertNil(body["window_days"])
        XCTAssertNil(body["severities"])
        XCTAssertNil(body["rule_ids"])
    }

    func testPathStripsApiPrefix() {
        // The client auto-adds /api/v1; the hook url must not double it.
        XCTAssertEqual(InboxCategoryRequest.path, "/ai/alerts/inbox/categorize")
        XCTAssertFalse(InboxCategoryRequest.path.hasPrefix("/api/v1"))
    }
}

// MARK: - Accessibility summary

@MainActor final class InboxCategoryAccessibilityTests: XCTestCase {
    private func countLabel(_ count: Int) -> String {
        "\(count) alerts"
    }

    func testTitleOnlyWhenNothingSuggested() {
        let summary = InboxCategoryAccessibility.summary(
            title: "Suggest inbox categories",
            buckets: nil,
            emptyLabel: "No categories",
            countLabel: countLabel
        )
        XCTAssertEqual(summary, "Suggest inbox categories")
    }

    func testEmptyAppendsEmptyLabel() {
        let summary = InboxCategoryAccessibility.summary(
            title: "Title",
            buckets: [],
            emptyLabel: "No categories suggested.",
            countLabel: countLabel
        )
        XCTAssertEqual(summary, "Title. No categories suggested.")
    }

    func testBucketsAppendCategoryAndCount() {
        let buckets = [
            InboxCategoryBucket(category: "Battery & charging", count: 14),
            InboxCategoryBucket(category: "Tire pressure", count: 6)
        ]
        let summary = InboxCategoryAccessibility.summary(
            title: "Title",
            buckets: buckets,
            emptyLabel: "No categories",
            countLabel: countLabel
        )
        XCTAssertEqual(summary, "Title. Battery & charging, 14 alerts. Tire pressure, 6 alerts")
    }
}

// MARK: - i18n facade

@MainActor final class InboxCategoryStringsTests: XCTestCase {
    /// The "AIInboxAutoCategorization" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesParityKeysToFallback() {
        XCTAssertEqual(
            InboxCategoryStrings.string("notifications.inbox.aiCategorize.title", "Suggest inbox categories"),
            "Suggest inbox categories"
        )
        XCTAssertEqual(
            InboxCategoryStrings.string(
                "notifications.inbox.aiCategorize.applyButton", "Apply categories as filter"
            ),
            "Apply categories as filter"
        )
        XCTAssertEqual(InboxCategoryStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
    }

    func testFormatCountSubstitutesValue() {
        XCTAssertEqual(
            InboxCategoryStrings.format("notifications.inbox.aiCategorize.countA11y", "%lld alerts", 14),
            "14 alerts"
        )
    }

    func testTableNameMatchesSurfaceSlug() {
        XCTAssertEqual(InboxCategoryStrings.table, InboxCategorySurface.slug)
    }
}
