//
//  Pagination.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the i18next `{{token}}`
//  interpolation port, the layout metrics + SF Symbol iconography, the default page-size options, and the
//  ``PaginationProjector`` — the verbatim port of the component's body arithmetic (`totalPages = max(1,
//  ceil(total / pageSize))`, `start = (page-1)*pageSize+1` shown as 0 when empty, `end = min(page*pageSize,
//  total)`, and the `page <= 1` / `page >= totalPages` disabled predicates). Split from
//  Pagination.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class PaginationAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(PaginationSurface.slug, "Pagination")
    }
}

// MARK: - Interpolation (web i18next `{{token}}`)

final class PaginationInterpolationTests: XCTestCase {
    func testSubstitutesSingleToken() {
        XCTAssertEqual(
            PaginationInterpolation.interpolate("{{count}} / page", ["count": "50"]),
            "50 / page"
        )
    }

    func testSubstitutesMultipleTokens() {
        XCTAssertEqual(
            PaginationInterpolation.interpolate(
                "Showing {{start}}–{{end}} of {{total}}",
                ["start": "1", "end": "25", "total": "248"]
            ),
            "Showing 1–25 of 248"
        )
    }

    func testLeavesUnknownTokenIntact() {
        XCTAssertEqual(
            PaginationInterpolation.interpolate("Page {{page}} of {{total}}", ["page": "2"]),
            "Page 2 of {{total}}"
        )
    }
}

// MARK: - Defaults + iconography + layout

final class PaginationValueTypeTests: XCTestCase {
    func testDefaultPageSizeOptionsMatchWeb() {
        XCTAssertEqual(PaginationDefaults.pageSizeOptions, [25, 50, 100])
    }

    func testSymbolsAreStable() {
        XCTAssertEqual(PaginationSymbol.first, "chevron.backward.2")
        XCTAssertEqual(PaginationSymbol.previous, "chevron.backward")
        XCTAssertEqual(PaginationSymbol.next, "chevron.forward")
        XCTAssertEqual(PaginationSymbol.last, "chevron.forward.2")
    }

    func testLayoutMetricsAreSane() {
        XCTAssertEqual(PaginationLayout.iconSide, 16, "web h-4 w-4")
        XCTAssertEqual(PaginationLayout.disabledOpacity, 0.3, "web disabled:opacity-30")
        XCTAssertGreaterThan(PaginationLayout.topPadding, 0)
        XCTAssertGreaterThan(PaginationLayout.buttonPadding, 0)
        XCTAssertGreaterThanOrEqual(PaginationLayout.controlSpacing, 0)
    }
}

// MARK: - Projector: totalPages (web `max(1, ceil(total / pageSize))`)

final class PaginationProjectorTotalPagesTests: XCTestCase {
    func testEmptyTotalIsOnePage() {
        XCTAssertEqual(PaginationProjector.totalPages(total: 0, pageSize: 25), 1)
    }

    func testExactMultiple() {
        XCTAssertEqual(PaginationProjector.totalPages(total: 100, pageSize: 25), 4)
    }

    func testRemainderRoundsUp() {
        XCTAssertEqual(PaginationProjector.totalPages(total: 101, pageSize: 25), 5)
        XCTAssertEqual(PaginationProjector.totalPages(total: 99, pageSize: 25), 4)
    }

    func testSinglePartialPage() {
        XCTAssertEqual(PaginationProjector.totalPages(total: 12, pageSize: 25), 1)
    }

    func testZeroPageSizeIsGuardedToOneDivisor() {
        // The web would yield Infinity on a zero divisor; native integer division would trap. The projector
        // clamps the divisor to 1, so total pages == total (never a crash).
        XCTAssertEqual(PaginationProjector.totalPages(total: 7, pageSize: 0), 7)
    }

    func testNegativeTotalIsTreatedAsEmpty() {
        XCTAssertEqual(PaginationProjector.totalPages(total: -10, pageSize: 25), 1)
    }
}

// MARK: - Projector: range (web `start` / `end`)

final class PaginationProjectorRangeTests: XCTestCase {
    func testFirstPageRange() {
        let range = PaginationProjector.range(page: 1, pageSize: 25, total: 248)
        XCTAssertEqual(range.start, 1)
        XCTAssertEqual(range.end, 25)
    }

    func testMiddlePageRange() {
        let range = PaginationProjector.range(page: 4, pageSize: 25, total: 248)
        XCTAssertEqual(range.start, 76)
        XCTAssertEqual(range.end, 100)
    }

    func testLastPageRangeClampsEndToTotal() {
        let range = PaginationProjector.range(page: 10, pageSize: 25, total: 248)
        XCTAssertEqual(range.start, 226)
        XCTAssertEqual(range.end, 248, "end = min(page*pageSize, total)")
    }

    func testEmptyRangeShowsZeros() {
        let range = PaginationProjector.range(page: 1, pageSize: 25, total: 0)
        XCTAssertEqual(range.start, 0, "web `total > 0 ? start : 0`")
        XCTAssertEqual(range.end, 0)
    }
}

// MARK: - Projector: project (full render state + disabled predicates)

final class PaginationProjectorProjectTests: XCTestCase {
    func testFirstPageOfManyDisablesBackwardEnablesForward() {
        let proj = PaginationProjector.project(page: 1, pageSize: 25, total: 248)
        XCTAssertEqual(proj.totalPages, 10)
        XCTAssertFalse(proj.canGoToPrevious)
        XCTAssertFalse(proj.canGoToFirst)
        XCTAssertTrue(proj.canGoToNext)
        XCTAssertTrue(proj.canGoToLast)
        XCTAssertFalse(proj.isEmpty)
    }

    func testMiddlePageEnablesBoth() {
        let proj = PaginationProjector.project(page: 4, pageSize: 25, total: 248)
        XCTAssertTrue(proj.canGoToPrevious)
        XCTAssertTrue(proj.canGoToNext)
    }

    func testLastPageEnablesBackwardDisablesForward() {
        let proj = PaginationProjector.project(page: 10, pageSize: 25, total: 248)
        XCTAssertTrue(proj.canGoToPrevious)
        XCTAssertFalse(proj.canGoToNext)
        XCTAssertFalse(proj.canGoToLast)
    }

    func testSinglePageDisablesEverything() {
        let proj = PaginationProjector.project(page: 1, pageSize: 25, total: 12)
        XCTAssertEqual(proj.totalPages, 1)
        XCTAssertFalse(proj.canGoToPrevious)
        XCTAssertFalse(proj.canGoToNext)
    }

    func testEmptyDataSet() {
        let proj = PaginationProjector.project(page: 1, pageSize: 25, total: 0)
        XCTAssertTrue(proj.isEmpty)
        XCTAssertEqual(proj.totalPages, 1)
        XCTAssertEqual(proj.displayStart, 0)
        XCTAssertEqual(proj.displayEnd, 0)
        XCTAssertFalse(proj.canGoToPrevious)
        XCTAssertFalse(proj.canGoToNext)
    }

    func testNavigationTargets() {
        let proj = PaginationProjector.project(page: 4, pageSize: 25, total: 248)
        XCTAssertEqual(proj.firstPage, 1)
        XCTAssertEqual(proj.previousPage, 3)
        XCTAssertEqual(proj.nextPage, 5)
        XCTAssertEqual(proj.lastPage, 10)
    }

    func testProjectionEquatable() {
        let lhs = PaginationProjector.project(page: 2, pageSize: 50, total: 200)
        let rhs = PaginationProjector.project(page: 2, pageSize: 50, total: 200)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, PaginationProjector.project(page: 3, pageSize: 50, total: 200))
    }
}
