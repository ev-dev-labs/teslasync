//
//  PageContainer.Tests.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  Adapter + projection coverage for the PageContainer surface:
//    • Query status — the web `isError ? … : isFetching ? … : isStale ? … : 'fresh'` mapping
//      (`error → offline`), with error winning over a simultaneous fetching / stale.
//    • Worst-of reducer — web `pickWorstQuery` (error > stale > fetching > fresh, first-wins ties) +
//      the "empty array treated like undefined" rule.
//    • Relative-age label — the verbatim port of web `formatRelativeTime` (just-now / m / h / d / w
//      buckets, future-safe).
//    • Freshness readout — the web `DataFreshness` `relativeTime` ternary across every band.
//    • Empty message — the caller override vs the rebuilt `No {title} found.` default.
//    • Projection — the render branches (loading > error > empty > content) + the freshness axis being
//      independent of the body phase.
//    • Accessibility — the freshness chip + error tile spoken labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly.
//

import Foundation
import XCTest
@testable import TeslaSync

private let identityResolver: PageContainerResolve = { _, fallback in fallback }
private let keyResolver: PageContainerResolve = { key, _ in key }
private let epoch = Date(timeIntervalSince1970: 1_000_000)

// MARK: - Query status (web `FreshnessStatus` mapping)

final class PageContainerQueryStatusTests: XCTestCase {
    func testFreshWhenIdle() {
        XCTAssertEqual(PageContainerFreshnessStatus.status(for: PageContainerQuery()), .fresh)
    }

    func testFetchingWhenFetching() {
        XCTAssertEqual(
            PageContainerFreshnessStatus.status(for: PageContainerQuery(isFetching: true)),
            .fetching
        )
    }

    func testStaleWhenStale() {
        XCTAssertEqual(
            PageContainerFreshnessStatus.status(for: PageContainerQuery(isStale: true)),
            .stale
        )
    }

    func testOfflineWhenError() {
        XCTAssertEqual(
            PageContainerFreshnessStatus.status(for: PageContainerQuery(isError: true)),
            .offline
        )
    }

    func testErrorWinsOverFetchingAndStale() {
        let query = PageContainerQuery(isFetching: true, isStale: true, isError: true)
        XCTAssertEqual(PageContainerFreshnessStatus.status(for: query), .offline)
    }

    func testFetchingWinsOverStale() {
        let query = PageContainerQuery(isFetching: true, isStale: true)
        XCTAssertEqual(PageContainerFreshnessStatus.status(for: query), .fetching)
    }

    func testRanksAreOrdered() {
        XCTAssertLessThan(PageContainerFreshnessStatus.fresh.rawValue, PageContainerFreshnessStatus.fetching.rawValue)
        XCTAssertLessThan(PageContainerFreshnessStatus.fetching.rawValue, PageContainerFreshnessStatus.stale.rawValue)
        XCTAssertLessThan(PageContainerFreshnessStatus.stale.rawValue, PageContainerFreshnessStatus.offline.rawValue)
    }
}

// MARK: - Worst-of reducer (web `pickWorstQuery` + array/undefined rule)

final class PageContainerQueryResolverTests: XCTestCase {
    func testEmptyResolvesToNil() {
        XCTAssertNil(PageContainerQueryResolver.resolve([]))
        XCTAssertNil(PageContainerQueryResolver.worst([]))
    }

    func testSingleResolvesToItself() {
        let query = PageContainerQuery(isStale: true)
        XCTAssertEqual(PageContainerQueryResolver.resolve([query]), query)
    }

    func testPicksMostDegraded() {
        let fresh = PageContainerQuery()
        let stale = PageContainerQuery(isStale: true)
        let error = PageContainerQuery(isError: true)
        XCTAssertEqual(PageContainerQueryResolver.resolve([fresh, stale, error]), error)
        XCTAssertEqual(PageContainerQueryResolver.resolve([fresh, stale]), stale)
        XCTAssertEqual(PageContainerQueryResolver.resolve([fresh, PageContainerQuery(isFetching: true)]).map {
            PageContainerFreshnessStatus.status(for: $0)
        }, .fetching)
    }

    func testTieKeepsFirstOccurrence() {
        let first = PageContainerQuery(isStale: true, dataUpdatedAt: epoch)
        let second = PageContainerQuery(isStale: true, dataUpdatedAt: epoch.addingTimeInterval(-99))
        XCTAssertEqual(PageContainerQueryResolver.resolve([first, second]), first)
    }
}

// MARK: - Relative-age label (web `formatRelativeTime`)

final class PageContainerRelativeTimeTests: XCTestCase {
    private func label(_ ageSeconds: TimeInterval) -> String {
        PageContainerRelativeTime.label(
            updatedAt: epoch,
            now: epoch.addingTimeInterval(ageSeconds),
            strings: identityResolver
        )
    }

    func testJustNowUnderAMinute() {
        XCTAssertEqual(label(0), "just now")
        XCTAssertEqual(label(59), "just now")
    }

    func testFutureClampsToJustNow() {
        XCTAssertEqual(label(-30), "just now")
    }

    func testMinutes() {
        XCTAssertEqual(label(60), "1m ago")
        XCTAssertEqual(label(125), "2m ago")
    }

    func testHours() {
        XCTAssertEqual(label(3600), "1h ago")
        XCTAssertEqual(label(7250), "2h ago")
    }

    func testDays() {
        XCTAssertEqual(label(86400), "1d ago")
    }

    func testWeeks() {
        XCTAssertEqual(label(604_800), "1w ago")
        XCTAssertEqual(label(1_300_000), "2w ago")
    }
}

// MARK: - Freshness readout (web `DataFreshness.relativeTime`)

final class PageContainerFreshnessReadoutTests: XCTestCase {
    private func resolve(_ query: PageContainerQuery, ageSeconds: TimeInterval = 0) -> PageContainerFreshnessReadout {
        PageContainerFreshnessReadout.resolve(
            query: query,
            now: epoch.addingTimeInterval(ageSeconds),
            strings: identityResolver
        )
    }

    func testFetchingShowsUpdating() {
        let readout = resolve(PageContainerQuery(isFetching: true, dataUpdatedAt: epoch))
        XCTAssertEqual(readout.status, .fetching)
        XCTAssertEqual(readout.ageLabel, "updating…")
    }

    func testFreshWithTimestampShowsRelativeAge() {
        let readout = resolve(PageContainerQuery(dataUpdatedAt: epoch), ageSeconds: 125)
        XCTAssertEqual(readout.status, .fresh)
        XCTAssertEqual(readout.ageLabel, "2m ago")
    }

    func testStaleWithTimestampShowsRelativeAge() {
        let readout = resolve(PageContainerQuery(isStale: true, dataUpdatedAt: epoch), ageSeconds: 3600)
        XCTAssertEqual(readout.status, .stale)
        XCTAssertEqual(readout.ageLabel, "1h ago")
    }

    func testOfflineWithoutTimestampShowsOfflineWord() {
        let readout = resolve(PageContainerQuery(isError: true))
        XCTAssertEqual(readout.status, .offline)
        XCTAssertEqual(readout.ageLabel, "offline")
    }

    func testOfflineWithTimestampStillShowsRelativeAge() {
        // Web: `updatedAt && !isFetching` wins the relativeTime branch even when isError.
        let readout = resolve(PageContainerQuery(isError: true, dataUpdatedAt: epoch), ageSeconds: 60)
        XCTAssertEqual(readout.status, .offline)
        XCTAssertEqual(readout.ageLabel, "1m ago")
    }

    func testFreshWithoutTimestampIsBlank() {
        let readout = resolve(PageContainerQuery())
        XCTAssertEqual(readout.status, .fresh)
        XCTAssertEqual(readout.ageLabel, "")
    }
}

// MARK: - Empty message (web `emptyMessage ?? No {title} found.`)

final class PageContainerEmptyMessageTests: XCTestCase {
    func testExplicitMessageWins() {
        let message = PageContainerEmptyMessage.resolve(
            explicit: "No drives in this range.",
            title: "Drives",
            strings: identityResolver
        )
        XCTAssertEqual(message, "No drives in this range.")
    }

    func testDefaultLowercasesTitle() {
        let message = PageContainerEmptyMessage.resolve(explicit: nil, title: "Drives", strings: identityResolver)
        XCTAssertEqual(message, "No drives found.")
    }

    func testEmptyExplicitFallsBackToDefault() {
        let message = PageContainerEmptyMessage.resolve(explicit: "", title: "Charging", strings: identityResolver)
        XCTAssertEqual(message, "No charging found.")
    }
}

// MARK: - Projection (render branches + freshness axis)

final class PageContainerProjectionTests: XCTestCase {
    private func resolve(_ input: PageContainerInput) -> PageContainerResolved {
        PageContainerProjection.resolve(input: input, now: epoch, strings: identityResolver)
    }

    func testLoadingTakesPrecedenceOverErrorAndEmpty() {
        let resolved = resolve(PageContainerInput(
            title: "Drives",
            isLoading: true,
            errorMessage: "boom",
            isEmpty: true
        ))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorTakesPrecedenceOverEmpty() {
        let resolved = resolve(PageContainerInput(title: "Drives", errorMessage: "HTTP 500", isEmpty: true))
        XCTAssertEqual(resolved.phase, .error("HTTP 500"))
    }

    func testEmptyResolvesDefaultCopy() {
        let resolved = resolve(PageContainerInput(title: "Drives", isEmpty: true))
        XCTAssertEqual(resolved.phase, .empty("No drives found."))
    }

    func testEmptyUsesExplicitCopy() {
        let resolved = resolve(PageContainerInput(title: "Drives", isEmpty: true, emptyMessage: "Nothing here yet."))
        XCTAssertEqual(resolved.phase, .empty("Nothing here yet."))
    }

    func testContentWhenHealthy() {
        let resolved = resolve(PageContainerInput(title: "Drives"))
        XCTAssertEqual(resolved.phase, .content)
    }

    func testEmptyMessageIgnoredWhenNotEmpty() {
        let resolved = resolve(PageContainerInput(title: "Drives", emptyMessage: "ignored"))
        XCTAssertEqual(resolved.phase, .content)
    }

    func testHeaderMapsTitleSubtitleAndCopyLink() {
        let resolved = resolve(PageContainerInput(title: "Energy", subtitle: "kWh", copyLink: true))
        XCTAssertEqual(resolved.header.title, "Energy")
        XCTAssertEqual(resolved.header.subtitle, "kWh")
        XCTAssertTrue(resolved.header.showCopyLink)
    }

    func testFreshnessNilWhenNoQuery() {
        XCTAssertNil(resolve(PageContainerInput(title: "Drives")).freshness)
    }

    func testFreshnessIndependentOfBodyPhase() {
        // The chip lives in the header above the body — present even while the body is loading.
        let resolved = resolve(PageContainerInput(
            title: "Drives",
            isLoading: true,
            query: PageContainerQuery(isStale: true, dataUpdatedAt: epoch)
        ))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.freshnessStatus, .stale)
    }
}

// MARK: - Accessibility

final class PageContainerAccessibilityTests: XCTestCase {
    func testFreshnessLabelRefetchableReadsRefresh() {
        let label = PageContainerAccessibility.freshnessLabel(
            status: .stale,
            refetchable: true,
            strings: identityResolver
        )
        XCTAssertEqual(label, "Refresh")
    }

    func testFreshnessLabelStaticReadsState() {
        let label = PageContainerAccessibility.freshnessLabel(
            status: .offline,
            refetchable: false,
            strings: identityResolver
        )
        XCTAssertEqual(label, "Data freshness: Offline")
    }

    func testStatusWords() {
        XCTAssertEqual(PageContainerAccessibility.statusWord(.fresh, strings: identityResolver), "Fresh")
        XCTAssertEqual(PageContainerAccessibility.statusWord(.fetching, strings: identityResolver), "Updating")
        XCTAssertEqual(PageContainerAccessibility.statusWord(.stale, strings: identityResolver), "Stale")
        XCTAssertEqual(PageContainerAccessibility.statusWord(.offline, strings: identityResolver), "Offline")
    }

    func testFreshnessLabelUsesCatalogKeys() {
        XCTAssertEqual(
            PageContainerAccessibility.freshnessLabel(status: .stale, refetchable: true, strings: keyResolver),
            "freshness.refresh"
        )
    }

    func testErrorLabelCombinesTitleAndMessage() {
        let label = PageContainerAccessibility.errorLabel(message: "HTTP 500", strings: identityResolver)
        XCTAssertEqual(label, "Something went wrong. HTTP 500")
    }

    func testErrorLabelTitleOnlyWhenNoMessage() {
        XCTAssertEqual(
            PageContainerAccessibility.errorLabel(message: "", strings: identityResolver),
            "Something went wrong"
        )
    }

    func testErrorLabelDoesNotDoubleTerminalPunctuation() {
        let label = PageContainerAccessibility.errorLabel(message: "Try again.", strings: { _, _ in "Failed." })
        XCTAssertEqual(label, "Failed. Try again.")
    }
}
