//
//  VisuallyHidden.Tests.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  Adapter + projection coverage for the VisuallyHidden surface:
//    • Priority — the polite/assertive urgency → role + aria-live mapping (web aria-live).
//    • Element — the `as` polymorphism → tag mapping (web `as` prop, default span).
//    • Semantics — the verbatim port of the web `liveProps` derivation across every mode, plus
//      the always-on sr-only base and the focusable reveal flag.
//    • Padding — the rotating zero-width-space suffix the `useAnnouncer` feed applies to force
//      re-announcement of duplicate messages.
//    • Input — the latest polite / assertive derivation (web `polite` / `assertive` state).
//    • Projection — the render branches plus the P4 leaf contract across
//      loading / empty / error / data, including most-recent-first ordering.
//    • Accessibility — the composed VoiceOver mode / region / history labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store,
//  so each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

private func message(
    _ id: Int,
    _ text: String,
    _ priority: VisuallyHiddenPriority,
    secondsAgo: TimeInterval = 0
) -> VisuallyHiddenMessage {
    VisuallyHiddenMessage(
        id: id,
        text: text,
        announcementText: VisuallyHiddenPadding.padded(text, sequence: id),
        priority: priority,
        timestamp: Date(timeIntervalSinceReferenceDate: 1000 - secondsAgo)
    )
}

// MARK: - Priority (web aria-live role)

final class VisuallyHiddenPriorityTests: XCTestCase {
    func testAssertiveInterruptsAndPoliteQueues() {
        XCTAssertTrue(VisuallyHiddenPriority.assertive.isInterrupting)
        XCTAssertFalse(VisuallyHiddenPriority.polite.isInterrupting)
    }

    func testRoleMatchesWebTernary() {
        XCTAssertEqual(VisuallyHiddenPriority.polite.role, "status")
        XCTAssertEqual(VisuallyHiddenPriority.assertive.role, "alert")
    }

    func testAriaLiveMatchesWebTokens() {
        XCTAssertEqual(VisuallyHiddenPriority.polite.ariaLive, "polite")
        XCTAssertEqual(VisuallyHiddenPriority.assertive.ariaLive, "assertive")
        XCTAssertEqual(VisuallyHiddenPriority.polite.rawValue, "polite")
        XCTAssertEqual(VisuallyHiddenPriority.assertive.rawValue, "assertive")
    }
}

// MARK: - Element (web `as` polymorphism)

final class VisuallyHiddenElementTests: XCTestCase {
    func testTagMapsAnchorToAnchorTag() {
        XCTAssertEqual(VisuallyHiddenElement.span.tag, "span")
        XCTAssertEqual(VisuallyHiddenElement.label.tag, "label")
        XCTAssertEqual(VisuallyHiddenElement.anchor.tag, "a")
        XCTAssertEqual(VisuallyHiddenElement.div.tag, "div")
    }

    func testAllCasesCoverEverySupportedElement() {
        XCTAssertEqual(VisuallyHiddenElement.allCases.map(\.tag), ["span", "label", "a", "div"])
    }
}

// MARK: - Semantics (verbatim port of the web `liveProps`)

final class VisuallyHiddenSemanticsTests: XCTestCase {
    func testHiddenIsScreenReaderOnlyWithNoLiveProps() {
        let semantics = VisuallyHiddenSemantics.resolve(for: .hidden)
        XCTAssertNil(semantics.role)
        XCTAssertNil(semantics.ariaLive)
        XCTAssertNil(semantics.ariaAtomic)
        XCTAssertFalse(semantics.focusReveals)
        XCTAssertFalse(semantics.isLiveRegion)
        XCTAssertTrue(semantics.screenReaderOnly)
    }

    func testPoliteLiveRegionMatchesWebStatusTriplet() {
        let semantics = VisuallyHiddenSemantics.resolve(for: .liveRegion(.polite))
        XCTAssertEqual(semantics.role, "status")
        XCTAssertEqual(semantics.ariaLive, "polite")
        XCTAssertEqual(semantics.ariaAtomic, "true")
        XCTAssertTrue(semantics.isLiveRegion)
        XCTAssertTrue(semantics.screenReaderOnly)
    }

    func testAssertiveLiveRegionMatchesWebAlertTriplet() {
        let semantics = VisuallyHiddenSemantics.resolve(for: .liveRegion(.assertive))
        XCTAssertEqual(semantics.role, "alert")
        XCTAssertEqual(semantics.ariaLive, "assertive")
        XCTAssertEqual(semantics.ariaAtomic, "true")
    }

    func testFocusableRevealsAndKeepsScreenReaderOnlyBase() {
        let semantics = VisuallyHiddenSemantics.resolve(for: .focusable)
        XCTAssertTrue(semantics.focusReveals)
        XCTAssertTrue(semantics.screenReaderOnly)
        XCTAssertNil(semantics.role)
        XCTAssertFalse(semantics.isLiveRegion)
    }

    func testWebFocusableBaseClassIsPinned() {
        XCTAssertEqual(VisuallyHiddenFocusable.webBaseClass, "focus:not-sr-only focus-visible:not-sr-only")
    }

    func testModeSlugIsStable() {
        XCTAssertEqual(VisuallyHiddenMode.hidden.slug, "hidden")
        XCTAssertEqual(VisuallyHiddenMode.liveRegion(.polite).slug, "live-polite")
        XCTAssertEqual(VisuallyHiddenMode.liveRegion(.assertive).slug, "live-assertive")
        XCTAssertEqual(VisuallyHiddenMode.focusable.slug, "focusable")
    }
}

// MARK: - Padding (the `useAnnouncer` rotating zero-width suffix)

final class VisuallyHiddenPaddingTests: XCTestCase {
    func testSuffixRotatesEveryFour() {
        let zwsp = VisuallyHiddenPadding.zeroWidthSpace
        XCTAssertEqual(VisuallyHiddenPadding.suffix(for: 1), zwsp)
        XCTAssertEqual(VisuallyHiddenPadding.suffix(for: 2), zwsp + zwsp)
        XCTAssertEqual(VisuallyHiddenPadding.suffix(for: 3), zwsp + zwsp + zwsp)
        XCTAssertEqual(VisuallyHiddenPadding.suffix(for: 4), "")
        XCTAssertEqual(VisuallyHiddenPadding.suffix(for: 5), zwsp)
    }

    func testZeroWidthSpaceIsU200B() {
        XCTAssertEqual(VisuallyHiddenPadding.zeroWidthSpace, "\u{200B}")
    }

    func testDuplicateMessagesProduceDistinctPaddedStrings() {
        let first = VisuallyHiddenPadding.padded("Selection cleared", sequence: 1)
        let second = VisuallyHiddenPadding.padded("Selection cleared", sequence: 2)
        XCTAssertNotEqual(first, second)
        XCTAssertTrue(first.hasPrefix("Selection cleared"))
    }
}

// MARK: - Input derivation (web `polite` / `assertive` state)

final class VisuallyHiddenInputTests: XCTestCase {
    func testLatestPoliteAndAssertivePickTheMostRecentOfEachPriority() {
        let input = VisuallyHiddenInput(messages: [
            message(1, "first polite", .polite),
            message(2, "an alert", .assertive),
            message(3, "second polite", .polite)
        ])
        XCTAssertEqual(input.latestPolite?.text, "second polite")
        XCTAssertEqual(input.latestAssertive?.text, "an alert")
    }

    func testLatestIsNilWhenNoMessageOfThatPriority() {
        let input = VisuallyHiddenInput(messages: [message(1, "only polite", .polite)])
        XCTAssertNil(input.latestAssertive)
        XCTAssertEqual(input.latestPolite?.text, "only polite")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class VisuallyHiddenProjectionTests: XCTestCase {
    private let messages = [
        message(1, "Filter applied", .polite, secondsAgo: 30),
        message(2, "Session expiring", .assertive, secondsAgo: 5)
    ]

    func testErrorTakesPrecedence() {
        let resolved = VisuallyHiddenProjection.resolve(
            VisuallyHiddenInput(messages: messages, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.recent.isEmpty)
        XCTAssertNil(resolved.polite)
        XCTAssertNil(resolved.assertive)
    }

    func testLoadingWhenFlagged() {
        let resolved = VisuallyHiddenProjection.resolve(VisuallyHiddenInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoMessages() {
        let resolved = VisuallyHiddenProjection.resolve(VisuallyHiddenInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.recent.isEmpty)
    }

    func testDataDerivesRegionsAndOrdersMostRecentFirst() {
        let resolved = VisuallyHiddenProjection.resolve(VisuallyHiddenInput(messages: messages))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.polite?.text, "Filter applied")
        XCTAssertEqual(resolved.assertive?.text, "Session expiring")
        XCTAssertEqual(resolved.recent.map(\.id), [2, 1])
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = VisuallyHiddenProjection.resolve(
            VisuallyHiddenInput(messages: messages, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility summaries

final class VisuallyHiddenAccessibilityTests: XCTestCase {
    func testModeLabelReadsNameThenSummary() {
        let label = VisuallyHiddenAccessibility.modeLabel(
            modeName: "Hidden",
            summary: "Exposed to assistive technology"
        )
        XCTAssertEqual(label, "Hidden: Exposed to assistive technology")
    }

    func testRegionLabelReadsNameThenMessage() {
        let label = VisuallyHiddenAccessibility.regionLabel(
            regionName: "Polite",
            message: "Saved view applied",
            emptyWord: "no announcement yet"
        )
        XCTAssertEqual(label, "Polite: Saved view applied")
    }

    func testRegionLabelFallsBackToEmptyWord() {
        let label = VisuallyHiddenAccessibility.regionLabel(
            regionName: "Assertive",
            message: "",
            emptyWord: "no announcement yet"
        )
        XCTAssertEqual(label, "Assertive: no announcement yet")
    }

    func testHistoryLabelReadsPriorityThenMessage() {
        let label = VisuallyHiddenAccessibility.historyLabel(
            priorityWord: "Assertive",
            message: "Session expires in 2 minutes"
        )
        XCTAssertEqual(label, "Assertive: Session expires in 2 minutes")
    }
}
