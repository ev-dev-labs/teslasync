//
//  Pagination.Tests.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + value types live
//  in Pagination.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • PaginationController — the once-only `view.opened` + idempotent + not-re-emitted-after-stop/start; the
//      derived display + accessibility strings (showing summary, page indicator, per-page label, "Page X of
//      Y", the four button labels + nav label) through an injected resolver with i18next interpolation; the
//      `showsPageSizeSelector` guard; and the navigation actions (first/prev/next/last fire the page callback
//      with the web target and are gated by the disabled predicates; the page-size action fires its callback).
//    • Views — the public host + every subview compose across the enabled / disabled / empty / with-and-
//      without-selector branches.
//    • Strings — the facade resolves the fallback for an unknown key and the keys / defaults are stable.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - PaginationController (telemetry + derived strings + actions)

@MainActor
final class PaginationControllerTests: XCTestCase {
    /// A resolver that echoes the fallback — the deterministic native shape of i18next `t` in tests.
    private let echo: PaginationResolve = { _, fallback in fallback }

    private func makeController(
        page: Int = 4,
        pageSize: Int = 25,
        total: Int = 248,
        options: [Int] = PaginationDefaults.pageSizeOptions,
        onPageChange: @escaping (Int) -> Void = { _ in },
        onPageSizeChange: ((Int) -> Void)? = nil,
        telemetry: any PaginationTelemetry = OSLogPaginationTelemetry()
    ) -> PaginationController {
        PaginationController(
            page: page,
            pageSize: pageSize,
            total: total,
            pageSizeOptions: options,
            onPageChange: onPageChange,
            onPageSizeChange: onPageSizeChange,
            resolve: echo,
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let controller = makeController(telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [PaginationSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let controller = makeController(telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [PaginationSurface.slug], "view.opened fires once per instance")
    }

    func testShowingTextInterpolatesWindow() {
        XCTAssertEqual(makeController(page: 1).showingText, "Showing 1–25 of 248")
        XCTAssertEqual(makeController(page: 10).showingText, "Showing 226–248 of 248")
    }

    func testShowingTextEmptyShowsZeros() {
        XCTAssertEqual(makeController(page: 1, total: 0).showingText, "Showing 0–0 of 0")
    }

    func testPageIndicatorText() {
        XCTAssertEqual(makeController(page: 4).pageIndicatorText, "4 / 10")
        XCTAssertEqual(makeController(page: 1, total: 0).pageIndicatorText, "1 / 1")
    }

    func testCurrentPageAccessibilityLabel() {
        XCTAssertEqual(makeController(page: 4).currentPageAccessibilityLabel, "Page 4 of 10")
    }

    func testPerPageLabelInterpolatesCount() {
        XCTAssertEqual(makeController().perPageLabel(50), "50 / page")
    }

    func testButtonAndNavLabelsResolveDefaults() {
        let controller = makeController()
        XCTAssertEqual(controller.navAccessibilityLabel, "Pagination")
        XCTAssertEqual(controller.firstAccessibilityLabel, "First page")
        XCTAssertEqual(controller.previousAccessibilityLabel, "Previous page")
        XCTAssertEqual(controller.nextAccessibilityLabel, "Next page")
        XCTAssertEqual(controller.lastAccessibilityLabel, "Last page")
        XCTAssertEqual(controller.pageSizeAccessibilityLabel, "Rows per page")
    }

    func testLabelsUseInjectedResolver() {
        let resolver: PaginationResolve = { key, fallback in
            key == PaginationStrings.nextKey ? "Seite vor" : fallback
        }
        let controller = PaginationController(
            page: 1, pageSize: 25, total: 100,
            onPageChange: { _ in }, resolve: resolver
        )
        XCTAssertEqual(controller.nextAccessibilityLabel, "Seite vor")
    }

    func testShowsPageSizeSelectorReflectsCallback() {
        XCTAssertFalse(makeController(onPageSizeChange: nil).showsPageSizeSelector)
        XCTAssertTrue(makeController(onPageSizeChange: { _ in }).showsPageSizeSelector)
    }

    func testNavigationActionsFireWebTargets() {
        let spy = PaginationActionSpy()
        let controller = makeController(page: 4, onPageChange: spy.recordPage)
        controller.goToFirst()
        controller.goToPrevious()
        controller.goToNext()
        controller.goToLast()
        XCTAssertEqual(spy.pages, [1, 3, 5, 10], "first=1, prev=page-1, next=page+1, last=totalPages")
    }

    func testBackwardActionsAreNoOpOnFirstPage() {
        let spy = PaginationActionSpy()
        let controller = makeController(page: 1, onPageChange: spy.recordPage)
        controller.goToFirst()
        controller.goToPrevious()
        XCTAssertTrue(spy.pages.isEmpty, "first/prev disabled when page <= 1")
    }

    func testForwardActionsAreNoOpOnLastPage() {
        let spy = PaginationActionSpy()
        let controller = makeController(page: 10, onPageChange: spy.recordPage)
        controller.goToNext()
        controller.goToLast()
        XCTAssertTrue(spy.pages.isEmpty, "next/last disabled when page >= totalPages")
    }

    func testSelectPageSizeFiresCallback() {
        let spy = PaginationActionSpy()
        let controller = makeController(onPageSizeChange: spy.recordSize)
        controller.selectPageSize(50)
        XCTAssertEqual(spy.sizes, [50])
    }

    func testSelectPageSizeIsNoOpWithoutCallback() {
        let controller = makeController(onPageSizeChange: nil)
        controller.selectPageSize(50) // must not crash; nothing observes it
        XCTAssertFalse(controller.showsPageSizeSelector)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class PaginationViewTests: XCTestCase {
    func testSurfaceSlugExposed() {
        XCTAssertEqual(PaginationView.surfaceSlug, "Pagination")
    }

    func testRootComposesWithAndWithoutSelectorAndWhenEmpty() {
        _ = PaginationView(controller: PaginationController(
            page: 1, pageSize: 25, total: 248, onPageChange: { _ in }, onPageSizeChange: { _ in }
        ))
        _ = PaginationView(controller: PaginationController(
            page: 2, pageSize: 25, total: 248, onPageChange: { _ in }
        ))
        _ = PaginationView(controller: PaginationController(
            page: 1, pageSize: 25, total: 0, onPageChange: { _ in }, onPageSizeChange: { _ in }
        ))
    }

    func testButtonComposesEnabledAndDisabled() {
        _ = PaginationButton(symbol: PaginationSymbol.first, label: "First page", isEnabled: true) {}
        _ = PaginationButton(symbol: PaginationSymbol.last, label: "Last page", isEnabled: false) {}
    }

    func testPageIndicatorComposes() {
        _ = PaginationPageIndicator(text: "4 / 10", accessibilityLabel: "Page 4 of 10")
    }

    func testShowingLabelComposes() {
        _ = PaginationShowingLabel(text: "Showing 1–25 of 248")
    }

    func testPageSizeMenuComposes() {
        _ = PaginationPageSizeMenu(
            selected: 25,
            options: [25, 50, 100],
            accessibilityLabel: "Rows per page",
            optionLabel: { "\($0) / page" },
            onSelect: { _ in }
        )
    }
}

// MARK: - Strings facade (P1/S10)

final class PaginationStringsTests: XCTestCase {
    func testResolveReturnsFallbackForUnknownKey() {
        XCTAssertEqual(PaginationStrings.resolve("pagination.___unknown___", "Fallback"), "Fallback")
    }

    func testKeysAreStable() {
        XCTAssertEqual(PaginationStrings.table, "Pagination")
        XCTAssertEqual(PaginationStrings.navLabelKey, "a11y.pagination")
        XCTAssertEqual(PaginationStrings.showingKey, "pagination.showing")
        XCTAssertEqual(PaginationStrings.pageSizeKey, "pagination.pageSize")
        XCTAssertEqual(PaginationStrings.perPageKey, "pagination.perPage")
        XCTAssertEqual(PaginationStrings.firstKey, "pagination.first")
        XCTAssertEqual(PaginationStrings.previousKey, "pagination.previous")
        XCTAssertEqual(PaginationStrings.currentPageKey, "pagination.currentPage")
        XCTAssertEqual(PaginationStrings.nextKey, "pagination.next")
        XCTAssertEqual(PaginationStrings.lastKey, "pagination.last")
    }

    func testDefaultsAreStable() {
        XCTAssertEqual(PaginationStrings.navLabelDefault, "Pagination")
        XCTAssertEqual(PaginationStrings.showingDefault, "Showing {{start}}–{{end}} of {{total}}")
        XCTAssertEqual(PaginationStrings.perPageDefault, "{{count}} / page")
        XCTAssertEqual(PaginationStrings.currentPageDefault, "Page {{page}} of {{total}}")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: PaginationTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records the page / page-size targets the controller fires through its callbacks. `@MainActor` like the
/// controller it observes, so no cross-actor synchronization is needed.
@MainActor
private final class PaginationActionSpy {
    private(set) var pages: [Int] = []
    private(set) var sizes: [Int] = []

    func recordPage(_ page: Int) {
        pages.append(page)
    }

    func recordSize(_ size: Int) {
        sizes.append(size)
    }
}
