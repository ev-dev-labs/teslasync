//
//  AnnouncerRegion.Tests.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  Adapter + projection coverage for the AnnouncerRegion surface:
//    • Priority — the polite/assertive urgency → interrupting mapping (web aria-live role).
//    • Padding — the verbatim port of the web `announceCounter % 4` rotating zero-width-space
//      suffix that forces re-announcement of duplicate messages.
//    • Input — the latest polite / assertive derivation (web `polite` / `assertive` state).
//    • Projection — the render branches plus the P4 leaf contract across
//      loading / empty / error / data, including most-recent-first ordering.
//    • Accessibility — the composed VoiceOver region + history labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store, so each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

private func message(
    _ id: Int,
    _ text: String,
    _ priority: AnnouncerPriority,
    secondsAgo: TimeInterval = 0
) -> AnnouncerMessage {
    AnnouncerMessage(
        id: id,
        text: text,
        announcementText: AnnouncerPadding.padded(text, sequence: id),
        priority: priority,
        timestamp: Date(timeIntervalSinceReferenceDate: 1000 - secondsAgo)
    )
}

// MARK: - Priority (web aria-live role)

final class AnnouncerPriorityTests: XCTestCase {
    func testAssertiveInterruptsAndPoliteQueues() {
        XCTAssertTrue(AnnouncerPriority.assertive.isInterrupting)
        XCTAssertFalse(AnnouncerPriority.polite.isInterrupting)
    }

    func testRawValuesMatchWebTokens() {
        XCTAssertEqual(AnnouncerPriority.polite.rawValue, "polite")
        XCTAssertEqual(AnnouncerPriority.assertive.rawValue, "assertive")
    }
}

// MARK: - Padding (web `announceCounter % 4` zero-width suffix)

final class AnnouncerPaddingTests: XCTestCase {
    func testSuffixRotatesEveryFour() {
        let zwsp = AnnouncerPadding.zeroWidthSpace
        XCTAssertEqual(AnnouncerPadding.suffix(for: 1), zwsp)
        XCTAssertEqual(AnnouncerPadding.suffix(for: 2), zwsp + zwsp)
        XCTAssertEqual(AnnouncerPadding.suffix(for: 3), zwsp + zwsp + zwsp)
        XCTAssertEqual(AnnouncerPadding.suffix(for: 4), "")
        XCTAssertEqual(AnnouncerPadding.suffix(for: 5), zwsp)
        XCTAssertEqual(AnnouncerPadding.suffix(for: 8), "")
    }

    func testPaddedAppendsSuffixToMessage() {
        let padded = AnnouncerPadding.padded("Saved", sequence: 1)
        XCTAssertEqual(padded, "Saved" + AnnouncerPadding.zeroWidthSpace)
        XCTAssertTrue(padded.hasPrefix("Saved"))
    }

    func testZeroWidthSpaceIsU200B() {
        XCTAssertEqual(AnnouncerPadding.zeroWidthSpace, "\u{200B}")
    }

    func testDuplicateMessagesProduceDistinctPaddedStrings() {
        // The web dedupe contract: identical consecutive messages must differ once padded.
        let first = AnnouncerPadding.padded("Selection cleared", sequence: 1)
        let second = AnnouncerPadding.padded("Selection cleared", sequence: 2)
        XCTAssertNotEqual(first, second)
    }
}

// MARK: - Input derivation (web `polite` / `assertive` state)

final class AnnouncerRegionInputTests: XCTestCase {
    func testLatestPoliteAndAssertivePickTheMostRecentOfEachPriority() {
        let input = AnnouncerRegionInput(entries: [
            message(1, "first polite", .polite),
            message(2, "an alert", .assertive),
            message(3, "second polite", .polite)
        ])
        XCTAssertEqual(input.latestPolite?.text, "second polite")
        XCTAssertEqual(input.latestAssertive?.text, "an alert")
    }

    func testLatestIsNilWhenNoMessageOfThatPriority() {
        let input = AnnouncerRegionInput(entries: [message(1, "only polite", .polite)])
        XCTAssertNil(input.latestAssertive)
        XCTAssertEqual(input.latestPolite?.text, "only polite")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AnnouncerRegionProjectionTests: XCTestCase {
    private let entries = [
        message(1, "Filter applied", .polite, secondsAgo: 30),
        message(2, "Session expiring", .assertive, secondsAgo: 5)
    ]

    func testErrorTakesPrecedence() {
        let resolved = AnnouncerRegionProjection.resolve(
            AnnouncerRegionInput(entries: entries, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.entries.isEmpty)
        XCTAssertNil(resolved.polite)
        XCTAssertNil(resolved.assertive)
    }

    func testLoadingWhenFlagged() {
        let resolved = AnnouncerRegionProjection.resolve(AnnouncerRegionInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoEntries() {
        let resolved = AnnouncerRegionProjection.resolve(AnnouncerRegionInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.entries.isEmpty)
    }

    func testDataDerivesRegionsAndOrdersMostRecentFirst() {
        let resolved = AnnouncerRegionProjection.resolve(AnnouncerRegionInput(entries: entries))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.polite?.text, "Filter applied")
        XCTAssertEqual(resolved.assertive?.text, "Session expiring")
        // Most-recent-first: id 2 before id 1.
        XCTAssertEqual(resolved.entries.map(\.id), [2, 1])
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = AnnouncerRegionProjection.resolve(
            AnnouncerRegionInput(entries: entries, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility summaries

final class AnnouncerRegionAccessibilityTests: XCTestCase {
    func testRegionLabelReadsNameThenMessage() {
        let label = AnnouncerRegionAccessibility.regionLabel(
            regionName: "Polite",
            message: "Saved view applied",
            emptyWord: "no announcement yet"
        )
        XCTAssertEqual(label, "Polite: Saved view applied")
    }

    func testRegionLabelFallsBackToEmptyWord() {
        let label = AnnouncerRegionAccessibility.regionLabel(
            regionName: "Assertive",
            message: "",
            emptyWord: "no announcement yet"
        )
        XCTAssertEqual(label, "Assertive: no announcement yet")
    }

    func testHistoryLabelReadsPriorityThenMessage() {
        let label = AnnouncerRegionAccessibility.historyLabel(
            priorityWord: "Assertive",
            message: "Session expires in 2 minutes"
        )
        XCTAssertEqual(label, "Assertive: Session expires in 2 minutes")
    }
}
