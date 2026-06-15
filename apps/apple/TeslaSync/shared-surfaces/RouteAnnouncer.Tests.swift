//
//  RouteAnnouncer.Tests.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  Adapter + projection coverage for the RouteAnnouncer surface:
//    • Padding — the verbatim port of the web `announceCounter % 4` rotating zero-width-space
//      suffix that forces re-announcement of two routes that resolve to the same title.
//    • Logic — the deferred read-time decision: an empty title clears the region (web
//      `setMessage('')`), a present title builds a padded announcement carrying the route.
//    • Projection — the render branches plus the P4 leaf contract across
//      loading / empty / error / data.
//    • Accessibility — the composed VoiceOver region + history labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure core directly.
//

import XCTest
@testable import TeslaSync

private func announcement(_ id: Int, _ path: String, _ title: String) -> RouteAnnouncement {
    RouteAnnouncement(
        id: id,
        path: path,
        title: title,
        announcementText: RouteAnnouncerPadding.padded(title, sequence: id),
        timestamp: Date(timeIntervalSinceReferenceDate: Double(id))
    )
}

// MARK: - Padding (web `announceCounter % 4` zero-width suffix)

final class RouteAnnouncerPaddingTests: XCTestCase {
    func testSuffixRotatesEveryFour() {
        let zwsp = RouteAnnouncerPadding.zeroWidthSpace
        XCTAssertEqual(RouteAnnouncerPadding.suffix(for: 1), zwsp)
        XCTAssertEqual(RouteAnnouncerPadding.suffix(for: 2), zwsp + zwsp)
        XCTAssertEqual(RouteAnnouncerPadding.suffix(for: 3), zwsp + zwsp + zwsp)
        XCTAssertEqual(RouteAnnouncerPadding.suffix(for: 4), "")
        XCTAssertEqual(RouteAnnouncerPadding.suffix(for: 5), zwsp)
        XCTAssertEqual(RouteAnnouncerPadding.suffix(for: 8), "")
    }

    func testPaddedAppendsSuffixToTitle() {
        let padded = RouteAnnouncerPadding.padded("Drives — TeslaSync", sequence: 1)
        XCTAssertEqual(padded, "Drives — TeslaSync" + RouteAnnouncerPadding.zeroWidthSpace)
        XCTAssertTrue(padded.hasPrefix("Drives — TeslaSync"))
    }

    func testZeroWidthSpaceIsU200B() {
        XCTAssertEqual(RouteAnnouncerPadding.zeroWidthSpace, "\u{200B}")
    }

    func testDuplicateTitlesProduceDistinctPaddedStrings() {
        // The web dedupe contract: two routes resolving to the same title must differ once padded
        // so the screen reader re-reads the second navigation.
        let first = RouteAnnouncerPadding.padded("Charging Session — TeslaSync", sequence: 1)
        let second = RouteAnnouncerPadding.padded("Charging Session — TeslaSync", sequence: 2)
        XCTAssertNotEqual(first, second)
    }
}

// MARK: - Logic (web deferred `document.title` read)

final class RouteAnnouncerLogicTests: XCTestCase {
    func testEmptyTitleClearsTheRegion() {
        let result = RouteAnnouncerLogic.announcement(
            path: "/drives", title: "", sequence: 1, at: Date()
        )
        XCTAssertNil(result)
    }

    func testPresentTitleBuildsPaddedAnnouncement() {
        let stamp = Date(timeIntervalSinceReferenceDate: 42)
        let result = RouteAnnouncerLogic.announcement(
            path: "/drives", title: "Drives — TeslaSync", sequence: 1, at: stamp
        )
        XCTAssertEqual(result?.id, 1)
        XCTAssertEqual(result?.path, "/drives")
        XCTAssertEqual(result?.title, "Drives — TeslaSync")
        XCTAssertEqual(result?.announcementText, "Drives — TeslaSync" + RouteAnnouncerPadding.zeroWidthSpace)
        XCTAssertEqual(result?.timestamp, stamp)
    }

    func testSequenceDrivesTheRotatingPadding() {
        let first = RouteAnnouncerLogic.announcement(path: "/a", title: "Same", sequence: 1, at: Date())
        let second = RouteAnnouncerLogic.announcement(path: "/b", title: "Same", sequence: 2, at: Date())
        XCTAssertNotEqual(first?.announcementText, second?.announcementText)
        XCTAssertEqual(first?.title, second?.title)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class RouteAnnouncerProjectionTests: XCTestCase {
    private let history = [
        announcement(2, "/charging/1", "Charging Session — TeslaSync"),
        announcement(1, "/drives", "Drives — TeslaSync")
    ]

    func testErrorTakesPrecedence() {
        let resolved = RouteAnnouncerProjection.resolve(
            isLoading: true, errorMessage: "boom", current: history.first, history: history
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.history.isEmpty)
        XCTAssertNil(resolved.current)
    }

    func testLoadingWhenFlagged() {
        let resolved = RouteAnnouncerProjection.resolve(
            isLoading: true, errorMessage: nil, current: nil, history: []
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoHistory() {
        let resolved = RouteAnnouncerProjection.resolve(
            isLoading: false, errorMessage: nil, current: nil, history: []
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.history.isEmpty)
    }

    func testDataPassesCurrentAndHistoryThrough() {
        let resolved = RouteAnnouncerProjection.resolve(
            isLoading: false, errorMessage: nil, current: history.first, history: history
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.current?.title, "Charging Session — TeslaSync")
        XCTAssertEqual(resolved.history.map(\.id), [2, 1])
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = RouteAnnouncerProjection.resolve(
            isLoading: false, errorMessage: "", current: history.first, history: history
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility summaries

final class RouteAnnouncerAccessibilityTests: XCTestCase {
    func testRegionLabelReadsNameThenTitle() {
        let label = RouteAnnouncerAccessibility.regionLabel(
            regionName: "Live region",
            title: "Drives — TeslaSync",
            emptyWord: "no page announced yet"
        )
        XCTAssertEqual(label, "Live region: Drives — TeslaSync")
    }

    func testRegionLabelFallsBackToEmptyWord() {
        let label = RouteAnnouncerAccessibility.regionLabel(
            regionName: "Live region",
            title: "",
            emptyWord: "no page announced yet"
        )
        XCTAssertEqual(label, "Live region: no page announced yet")
    }

    func testHistoryLabelReadsNavigatedThenTitle() {
        let label = RouteAnnouncerAccessibility.historyLabel(
            navigatedWord: "Navigated",
            title: "Charging Session — TeslaSync"
        )
        XCTAssertEqual(label, "Navigated: Charging Session — TeslaSync")
    }
}
