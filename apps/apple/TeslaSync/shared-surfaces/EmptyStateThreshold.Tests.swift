//
//  EmptyStateThreshold.Tests.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  Adapter + projection coverage for the EmptyStateThreshold surface:
//    • Symbols — the web lucide icons (`CheckCircle2` / `Info`) mapped to stable SF Symbols.
//    • Text — the verbatim (caller content) vs localized (facade-resolved) resolution.
//    • Message — the auto count copy (web `{{threshold}}` / `{{noun}}` / `{{current}}` interpolation,
//      with the `itemNoun` default falling back to `emptyState.threshold.defaultItem`) and the custom
//      override, plus that the web i18n keys are used.
//    • Gate — the `message` derivation + the `content(canAct:)` CTA gate.
//    • Projection — the render branches plus the P4 leaf contract across error / loading / threshold /
//      empty, including that the connectivity axis never hides the card.
//    • Accessibility — the composed VoiceOver `role="status"` label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

private let identityResolver: EmptyStateThresholdResolve = { _, fallback in fallback }
private let keyResolver: EmptyStateThresholdResolve = { key, _ in key }

// MARK: - Symbols (web lucide icons)

final class EmptyStateThresholdSymbolTests: XCTestCase {
    func testSymbolsAreStable() {
        XCTAssertEqual(EmptyStateThresholdSymbols.status, "checkmark.circle.fill")
        XCTAssertEqual(EmptyStateThresholdSymbols.info, "info.circle")
    }

    func testSymbolsAreNonEmpty() {
        XCTAssertFalse(EmptyStateThresholdSymbols.status.isEmpty)
        XCTAssertFalse(EmptyStateThresholdSymbols.info.isEmpty)
    }
}

// MARK: - i18n keys (web source `t(...)` keys)

final class EmptyStateThresholdKeyTests: XCTestCase {
    func testKeysMatchWebSource() {
        XCTAssertEqual(EmptyStateThresholdKeys.defaultItem, "emptyState.threshold.defaultItem")
        XCTAssertEqual(EmptyStateThresholdKeys.message, "emptyState.threshold.message")
    }
}

// MARK: - Text (verbatim vs facade-resolved)

final class EmptyStateThresholdTextTests: XCTestCase {
    func testVerbatimIgnoresResolver() {
        XCTAssertEqual(EmptyStateThresholdText.verbatim("Cost Heatmap").resolve(keyResolver), "Cost Heatmap")
        XCTAssertEqual(EmptyStateThresholdText.verbatim("Cost Heatmap").resolve(identityResolver), "Cost Heatmap")
    }

    func testLocalizedUsesResolver() {
        let text = EmptyStateThresholdText.localized(key: "section.heatmap", fallback: "Cost Heatmap")
        XCTAssertEqual(text.resolve(identityResolver), "Cost Heatmap")
        XCTAssertEqual(text.resolve(keyResolver), "section.heatmap")
    }
}

// MARK: - Message (auto count copy + custom override)

final class EmptyStateThresholdMessageTests: XCTestCase {
    func testAutoMessageWithExplicitNounMatchesWebCopy() {
        let message = EmptyStateThresholdMessage.auto(
            threshold: 30,
            noun: .verbatim("sessions"),
            current: 5
        )
        let resolved = message.resolve(identityResolver)
        XCTAssertTrue(resolved.contains("at least 30 sessions"), resolved)
        XCTAssertTrue(resolved.contains("5 so far"), resolved)
    }

    func testAutoMessageFallsBackToItemsNoun() {
        let message = EmptyStateThresholdMessage.auto(threshold: 10, noun: nil, current: 1)
        XCTAssertTrue(message.resolve(identityResolver).contains("at least 10 items"))
    }

    func testAutoMessageConsultsDefaultItemKeyForNoun() {
        let nounResolver: EmptyStateThresholdResolve = { key, fallback in
            key == EmptyStateThresholdKeys.defaultItem ? "widgets" : fallback
        }
        let message = EmptyStateThresholdMessage.auto(threshold: 10, noun: nil, current: 1)
        XCTAssertTrue(message.resolve(nounResolver).contains("10 widgets"))
    }

    func testAutoMessageConsultsMessageKeyAndInterpolatesAllTokens() {
        let templateResolver: EmptyStateThresholdResolve = { key, fallback in
            key == EmptyStateThresholdKeys.message ? "Have {{current}}/{{threshold}} {{noun}}." : fallback
        }
        let message = EmptyStateThresholdMessage.auto(
            threshold: 30,
            noun: .verbatim("sessions"),
            current: 5
        )
        XCTAssertEqual(message.resolve(templateResolver), "Have 5/30 sessions.")
    }

    func testCustomMessageOverridesAndIgnoresCounts() {
        let message = EmptyStateThresholdMessage.custom(.verbatim("Custom prompt here"))
        XCTAssertEqual(message.resolve(identityResolver), "Custom prompt here")
        XCTAssertFalse(message.resolve(identityResolver).contains("at least"))
    }
}

// MARK: - Gate (message derivation + CTA gate)

final class EmptyStateThresholdGateTests: XCTestCase {
    private func gate(
        current: Int = 5,
        threshold: Int = 30,
        custom: EmptyStateThresholdText? = nil,
        action: EmptyStateThresholdText? = nil
    ) -> EmptyStateThresholdGate {
        EmptyStateThresholdGate(
            currentCount: current,
            threshold: threshold,
            sectionLabel: .verbatim("Cost Heatmap"),
            itemNoun: .verbatim("sessions"),
            customMessage: custom,
            actionLabel: action
        )
    }

    func testMessageIsAutoWhenNoCustomSupplied() {
        XCTAssertEqual(gate().message, .auto(threshold: 30, noun: .verbatim("sessions"), current: 5))
    }

    func testMessageIsCustomWhenSupplied() {
        let custom = EmptyStateThresholdText.verbatim("Adjust the date range")
        XCTAssertEqual(gate(custom: custom).message, .custom(custom))
    }

    func testActionShownOnlyWhenLabelAndCapable() {
        let withLabel = gate(action: .verbatim("Adjust filters"))
        XCTAssertTrue(withLabel.content(canAct: true).showAction)
        XCTAssertFalse(withLabel.content(canAct: false).showAction)

        let withoutLabel = gate(action: nil)
        XCTAssertFalse(withoutLabel.content(canAct: true).showAction)
    }

    func testContentCarriesSectionDescriptionAndMessage() {
        let full = EmptyStateThresholdGate(
            currentCount: 5,
            threshold: 30,
            sectionLabel: .verbatim("Cost Heatmap"),
            itemNoun: .verbatim("sessions"),
            description: .verbatim("Where charging is cheapest.")
        )
        let content = full.content(canAct: false)
        XCTAssertEqual(content.sectionLabel, .verbatim("Cost Heatmap"))
        XCTAssertEqual(content.description, .verbatim("Where charging is cheapest."))
        XCTAssertEqual(content.message, .auto(threshold: 30, noun: .verbatim("sessions"), current: 5))
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class EmptyStateThresholdProjectionTests: XCTestCase {
    private func gate() -> EmptyStateThresholdGate {
        EmptyStateThresholdGate(
            currentCount: 5,
            threshold: 30,
            sectionLabel: .verbatim("Cost Heatmap"),
            actionLabel: .verbatim("Adjust filters")
        )
    }

    func testErrorTakesPrecedenceOverEverything() {
        let resolved = EmptyStateThresholdProjection.resolve(
            input: EmptyStateThresholdInput(gate: gate(), isLoading: true, errorMessage: "boom"),
            canAct: true
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.content)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = EmptyStateThresholdProjection.resolve(
            input: EmptyStateThresholdInput(gate: gate(), errorMessage: ""),
            canAct: true
        )
        XCTAssertEqual(resolved.phase, .threshold)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let resolved = EmptyStateThresholdProjection.resolve(
            input: EmptyStateThresholdInput(gate: gate(), isLoading: true),
            canAct: true
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.content)
    }

    func testThresholdWhenGatePresent() throws {
        let resolved = EmptyStateThresholdProjection.resolve(
            input: EmptyStateThresholdInput(gate: gate()),
            canAct: true
        )
        XCTAssertEqual(resolved.phase, .threshold)
        let content = try XCTUnwrap(resolved.content)
        XCTAssertTrue(content.showAction)
    }

    func testConnectivityNeverHidesTheCard() {
        for connection in [EmptyStateThresholdConnection.stale, .offline] {
            let resolved = EmptyStateThresholdProjection.resolve(
                input: EmptyStateThresholdInput(gate: gate(), connection: connection),
                canAct: true
            )
            XCTAssertEqual(resolved.phase, .threshold, "\(connection) must keep the card")
            XCTAssertNotNil(resolved.content)
        }
    }

    func testEmptyWhenNoGate() {
        let resolved = EmptyStateThresholdProjection.resolve(
            input: EmptyStateThresholdInput(),
            canAct: true
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.content)
    }

    func testActionGatedByCapability() throws {
        let resolved = EmptyStateThresholdProjection.resolve(
            input: EmptyStateThresholdInput(gate: gate()),
            canAct: false
        )
        let content = try XCTUnwrap(resolved.content)
        XCTAssertFalse(content.showAction)
    }
}

// MARK: - Accessibility

final class EmptyStateThresholdAccessibilityTests: XCTestCase {
    func testLabelReadsSectionDescriptionThenMessage() {
        let label = EmptyStateThresholdAccessibility.label(
            sectionLabel: "Cost Heatmap",
            description: "Where charging is cheapest",
            message: "Need at least 30 sessions"
        )
        XCTAssertEqual(label, "Cost Heatmap. Where charging is cheapest. Need at least 30 sessions")
    }

    func testLabelSkipsMissingDescription() {
        let label = EmptyStateThresholdAccessibility.label(
            sectionLabel: "Cost Heatmap",
            description: nil,
            message: "Need at least 30 sessions"
        )
        XCTAssertEqual(label, "Cost Heatmap. Need at least 30 sessions")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = EmptyStateThresholdAccessibility.label(
            sectionLabel: "Cost Heatmap.",
            description: nil,
            message: "You have 5 so far."
        )
        XCTAssertEqual(label, "Cost Heatmap. You have 5 so far.")
    }

    func testLabelEmptyWhenAllEmpty() {
        XCTAssertEqual(EmptyStateThresholdAccessibility.label(sectionLabel: "", description: "", message: ""), "")
    }
}
