//
//  AIFeatureCard.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  Pure-core coverage for the AIFeatureCard scaffold — the adapter, the decision logic, the
//  projection, the accessibility builders, and the i18n key set. Everything here is Foundation-only
//  and reads the pure types directly (no store, no rendered view), so each web boolean / branch is
//  asserted in isolation. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Stream phase (web `AiStreamState`)

final class AIFeatureStreamPhaseTests: XCTestCase {
    func testIsStreamingOnlyWhileStreaming() {
        XCTAssertTrue(AIFeatureStreamPhase.streaming.isStreaming)
        XCTAssertFalse(AIFeatureStreamPhase.idle.isStreaming)
        XCTAssertFalse(AIFeatureStreamPhase.pausedConfirm.isStreaming)
        XCTAssertFalse(AIFeatureStreamPhase.done.isStreaming)
        XCTAssertFalse(AIFeatureStreamPhase.error("x").isStreaming)
    }

    func testIsErrorOnlyForError() {
        XCTAssertTrue(AIFeatureStreamPhase.error("boom").isError)
        XCTAssertFalse(AIFeatureStreamPhase.idle.isError)
        XCTAssertFalse(AIFeatureStreamPhase.done.isError)
    }

    func testIsDoneOnlyForDone() {
        XCTAssertTrue(AIFeatureStreamPhase.done.isDone)
        XCTAssertFalse(AIFeatureStreamPhase.streaming.isDone)
    }
}

// MARK: - Input snapshot

final class AIFeatureCardInputTests: XCTestCase {
    func testErrorMessageExtractedOnlyForErrorPhase() {
        XCTAssertEqual(AIFeatureCardInput(phase: .error("rate limit")).errorMessage, "rate limit")
        XCTAssertNil(AIFeatureCardInput(phase: .idle).errorMessage)
        XCTAssertNil(AIFeatureCardInput(phase: .streaming).errorMessage)
    }

    func testDefaults() {
        let input = AIFeatureCardInput()
        XCTAssertEqual(input.phase, .idle)
        XCTAssertEqual(input.text, "")
        XCTAssertTrue(input.canStart)
        XCTAssertEqual(input.connection, .live)
    }
}

// MARK: - Content config (web props)

final class AIFeatureCardContentTests: XCTestCase {
    private func content(emptyHint: String? = nil, buttonTitle: String? = nil) -> AIFeatureCardContent {
        AIFeatureCardContent(
            title: "Summarize",
            description: "Writes a summary.",
            buttonLabel: "Summarize",
            emptyHint: emptyHint,
            buttonTitle: buttonTitle
        )
    }

    func testHasEmptyHint() {
        XCTAssertFalse(content(emptyHint: nil).hasEmptyHint)
        XCTAssertFalse(content(emptyHint: "").hasEmptyHint)
        XCTAssertTrue(content(emptyHint: "Pick a row").hasEmptyHint)
    }

    func testResolvedButtonTitleFallsBackToDescription() {
        XCTAssertEqual(content(buttonTitle: nil).resolvedButtonTitle, "Writes a summary.")
        XCTAssertEqual(content(buttonTitle: "Run Helix").resolvedButtonTitle, "Run Helix")
    }
}

// MARK: - Logic (web `AIFeatureCard` + `AiOutputPanel` booleans)

final class AIFeatureCardLogicTests: XCTestCase {
    func testButtonDisabledMirrorsWebPlusOffline() {
        // Enabled: canStart, idle, live.
        XCTAssertFalse(AIFeatureCardLogic.buttonDisabled(canStart: true, phase: .idle, connection: .live))
        // Web `!canStart`.
        XCTAssertTrue(AIFeatureCardLogic.buttonDisabled(canStart: false, phase: .idle, connection: .live))
        // Web `streaming`.
        XCTAssertTrue(AIFeatureCardLogic.buttonDisabled(canStart: true, phase: .streaming, connection: .live))
        // Native leaf: offline disables even when canStart + idle.
        XCTAssertTrue(AIFeatureCardLogic.buttonDisabled(canStart: true, phase: .idle, connection: .offline))
        // Stale still allows the action.
        XCTAssertFalse(AIFeatureCardLogic.buttonDisabled(canStart: true, phase: .idle, connection: .stale))
    }

    func testEffectivePlacementCoercedByInputSlot() {
        XCTAssertEqual(AIFeatureCardLogic.effectivePlacement(.inline, hasInputSlot: false), .inline)
        XCTAssertEqual(AIFeatureCardLogic.effectivePlacement(.below, hasInputSlot: false), .below)
        // Web `inputSlot ? 'below' : buttonPlacement` — a slot coerces below even when asked inline.
        XCTAssertEqual(AIFeatureCardLogic.effectivePlacement(.inline, hasInputSlot: true), .below)
    }

    func testShowsEmptyHint() {
        XCTAssertTrue(AIFeatureCardLogic.showsEmptyHint(canStart: false, hasEmptyHint: true))
        XCTAssertFalse(AIFeatureCardLogic.showsEmptyHint(canStart: true, hasEmptyHint: true))
        XCTAssertFalse(AIFeatureCardLogic.showsEmptyHint(canStart: false, hasEmptyHint: false))
    }

    func testOutputHasAnything() {
        XCTAssertFalse(AIFeatureCardLogic.outputHasAnything(phase: .idle, hasText: false))
        XCTAssertTrue(AIFeatureCardLogic.outputHasAnything(phase: .idle, hasText: true))
        XCTAssertTrue(AIFeatureCardLogic.outputHasAnything(phase: .streaming, hasText: false))
        XCTAssertTrue(AIFeatureCardLogic.outputHasAnything(phase: .done, hasText: false))
        XCTAssertTrue(AIFeatureCardLogic.outputHasAnything(phase: .error("x"), hasText: false))
        XCTAssertFalse(AIFeatureCardLogic.outputHasAnything(phase: .pausedConfirm, hasText: false))
    }

    func testThinkingVisibleOnlyWhenStreamingAndEmpty() {
        XCTAssertTrue(AIFeatureCardLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(AIFeatureCardLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(AIFeatureCardLogic.thinkingVisible(phase: .idle, hasText: false))
    }
}

// MARK: - Projection (web `AiOutputPanel` render branches)

final class AIFeatureCardProjectionTests: XCTestCase {
    func testHiddenWhenIdleAndEmpty() {
        XCTAssertEqual(AIFeatureCardProjection.outputState(phase: .idle, text: ""), .hidden)
    }

    func testHiddenWhenDoneWithNoText() {
        // The done-with-no-text case collapses (the feature's children carry the real output) so the
        // panel is never a blank box.
        XCTAssertEqual(AIFeatureCardProjection.outputState(phase: .done, text: ""), .hidden)
    }

    func testThinkingWhenStreamingAndEmpty() {
        XCTAssertEqual(AIFeatureCardProjection.outputState(phase: .streaming, text: ""), .thinking)
    }

    func testTextWhenStreamingWithDeltas() {
        XCTAssertEqual(AIFeatureCardProjection.outputState(phase: .streaming, text: "Hi"), .text("Hi"))
    }

    func testTextWhenDoneWithText() {
        XCTAssertEqual(AIFeatureCardProjection.outputState(phase: .done, text: "Summary"), .text("Summary"))
    }

    func testErrorTakesPrecedence() {
        // Even with accumulated text, an error phase surfaces the error row (web precedence).
        XCTAssertEqual(
            AIFeatureCardProjection.outputState(phase: .error("boom"), text: "partial"),
            .error("boom")
        )
    }

    func testResolveDerivesEverything() {
        let resolved = AIFeatureCardProjection.resolve(
            AIFeatureCardInput(phase: .streaming, text: "", canStart: true, connection: .stale)
        )
        XCTAssertEqual(resolved.phase, .streaming)
        XCTAssertEqual(resolved.connection, .stale)
        XCTAssertTrue(resolved.isStreaming)
        XCTAssertTrue(resolved.buttonDisabled) // streaming
        XCTAssertEqual(resolved.output, .thinking)
    }
}

// MARK: - Accessibility (testable seam)

final class AIFeatureCardAccessibilityTests: XCTestCase {
    func testActionLabelFoldsInVerb() {
        XCTAssertEqual(
            AIFeatureCardAccessibility.actionLabel(askHelix: "Ask Helix", verb: "Summarize"),
            "Ask Helix · Summarize"
        )
    }

    func testBadgeLabelHasNoSuffixWhenLive() {
        XCTAssertEqual(
            AIFeatureCardAccessibility.badgeLabel(brand: "Helix", connection: .live, freshnessNote: "Live"),
            "Helix"
        )
    }

    func testBadgeLabelAppendsNoteWhenNotLive() {
        XCTAssertEqual(
            AIFeatureCardAccessibility.badgeLabel(
                brand: "Helix", connection: .stale, freshnessNote: "Stale — tap refresh to update"
            ),
            "Helix, Stale — tap refresh to update"
        )
        XCTAssertEqual(
            AIFeatureCardAccessibility.badgeLabel(
                brand: "Helix", connection: .offline, freshnessNote: "Offline — showing the last known state"
            ),
            "Helix, Offline — showing the last known state"
        )
    }
}

// MARK: - Meta + i18n key set (web source keys present in the catalog)

final class AIFeatureCardMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(AIFeatureCardMeta.surfaceSlug, "AIFeatureCard")
        XCTAssertEqual(AIFeatureCard<EmptyView, EmptyView>.surfaceSlug, "AIFeatureCard")
    }

    /// Asserts every web-source string key resolves to its English copy through the P1/S10 facade —
    /// the catalog folds the value to the same English, so this holds whether or not the per-surface
    /// table is bundled in the test host.
    func testWebSourceKeysResolve() {
        let expected: [String: String] = [
            "helix.badge": "Helix",
            "helix.ariaLabel": "Helix",
            "helix.askHelix": "Ask Helix",
            "helix.thinking": "Helix is thinking…",
            "helix.errorLabel": "Helix error:",
            "ai.common.errorUnknown": "unknown"
        ]
        for (key, english) in expected {
            XCTAssertEqual(AIFeatureCardStrings.string(key, english), english, "key \(key)")
            XCTAssertFalse(AIFeatureCardStrings.string(key, english).isEmpty, "key \(key) empty")
        }
    }
}
