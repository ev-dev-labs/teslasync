//
//  HttpStatusTool.Tests.swift
//  TeslaSync — P4 feature view · 0016 · HttpStatusTool (Apple)
//
//  Unit coverage for the HttpStatusTool surface:
//    • Adapter (catalog → projection) — `HttpStatusProjector` parity with the web
//      `filtered` useMemo, the `Badge` variant ternary, and the `DataTable` sort
//      (`code`) + pagination (defaultPageSize 25), plus the status strings + a11y.
//    • State holder — `HttpStatusModel` phase resolution across loading / empty /
//      error / content, search / sort / pagination UI state, freshness tracking,
//      plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Accessibility — the VoiceOver summary + per-row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryHttpStatusSource`. String
//  assertions check the web English fallbacks (the per-surface table folds into
//  the master catalog at integration time, so it resolves to the `value:`
//  fallback in the un-integrated test bundle).
//

import XCTest
@testable import TeslaSync

// MARK: - Catalog: verbatim port of the web HTTP_CODES

@MainActor final class HttpStatusCatalogTests: XCTestCase {
    func testCatalogMatchesWebConstant() {
        XCTAssertEqual(HttpStatusCatalog.codes.count, 19)
        XCTAssertEqual(HttpStatusCatalog.codes.first?.code, 200)
        XCTAssertEqual(HttpStatusCatalog.codes.last?.code, 504)
    }

    func testCatalogPreservesSourceOrder() {
        let codes = HttpStatusCatalog.codes.map(\.code)
        XCTAssertEqual(codes.first, 200)
        XCTAssertEqual(codes[6], 400)
        XCTAssertEqual(Set(codes).count, codes.count, "codes are unique")
    }

    func testCatalogRowFields() throws {
        let notFound = try XCTUnwrap(HttpStatusCatalog.codes.first(where: { $0.code == 404 }))
        XCTAssertEqual(notFound.text, "Not Found")
        XCTAssertEqual(notFound.desc, "Resource not found")
    }
}

// MARK: - Tone: port of the web Badge variant ternary

@MainActor final class HttpStatusToneTests: XCTestCase {
    func testToneByRange() {
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 200), .success)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 204), .success)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 301), .info)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 304), .info)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 404), .warning)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 429), .warning)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 500), .danger)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 504), .danger)
    }

    func testToneBoundaries() {
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 299), .success)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 300), .info)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 399), .info)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 400), .warning)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 499), .warning)
        XCTAssertEqual(HttpStatusProjector.tone(forCode: 500), .danger)
    }
}

// MARK: - Filter: port of the web `filtered` useMemo

@MainActor final class HttpStatusFilterTests: XCTestCase {
    private let codes = HttpStatusCatalog.codes

    func testBlankQueryReturnsAll() {
        XCTAssertEqual(HttpStatusProjector.filter(codes, query: "").count, 19)
        XCTAssertEqual(HttpStatusProjector.filter(codes, query: "   ").count, 19)
    }

    func testNumericCodeSubstring() {
        let result = HttpStatusProjector.filter(codes, query: "404").map(\.code)
        XCTAssertEqual(result, [404])
    }

    func testNumericPrefixMatchesRange() {
        let result = HttpStatusProjector.filter(codes, query: "40").map(\.code)
        XCTAssertEqual(result, [400, 401, 403, 404, 405, 408, 409])
    }

    func testMatchesStatusTextCaseInsensitively() {
        let result = HttpStatusProjector.filter(codes, query: "NOT FOUND").map(\.code)
        XCTAssertEqual(result, [404])
    }

    func testMatchesDescription() {
        let result = HttpStatusProjector.filter(codes, query: "timeout").map(\.code)
        XCTAssertEqual(Set(result), [408, 504])
    }

    func testNoMatchReturnsEmpty() {
        XCTAssertTrue(HttpStatusProjector.filter(codes, query: "zzz").isEmpty)
    }

    func testUntrimmedLowercasedNeedleParity() {
        // Web: guard on `!search.trim()`, then `q = search.toLowerCase()` (untrimmed).
        // A leading space is kept in the needle, so " 40" matches nothing.
        XCTAssertTrue(HttpStatusProjector.filter(codes, query: " 40").isEmpty)
    }
}

// MARK: - Sort + pagination: the web DataTable `sortable` / `pagination`

@MainActor final class HttpStatusSortPaginationTests: XCTestCase {
    private let shuffled = [
        HttpStatusCode(code: 500, text: "e", desc: "e"),
        HttpStatusCode(code: 200, text: "a", desc: "a"),
        HttpStatusCode(code: 404, text: "d", desc: "d")
    ]

    func testUnsortedPreservesOrder() {
        XCTAssertEqual(HttpStatusProjector.sort(shuffled, by: .unsorted).map(\.code), [500, 200, 404])
    }

    func testAscendingDescending() {
        XCTAssertEqual(HttpStatusProjector.sort(shuffled, by: .ascending).map(\.code), [200, 404, 500])
        XCTAssertEqual(HttpStatusProjector.sort(shuffled, by: .descending).map(\.code), [500, 404, 200])
    }

    func testSortCycle() {
        XCTAssertEqual(HttpStatusSort.unsorted.next, .ascending)
        XCTAssertEqual(HttpStatusSort.ascending.next, .descending)
        XCTAssertEqual(HttpStatusSort.descending.next, .ascending)
    }

    func testPageCount() {
        XCTAssertEqual(HttpStatusProjector.pageCount(for: 19, pageSize: 25), 1)
        XCTAssertEqual(HttpStatusProjector.pageCount(for: 19, pageSize: 10), 2)
        XCTAssertEqual(HttpStatusProjector.pageCount(for: 0, pageSize: 10), 1)
    }

    func testSlice() {
        let codes = HttpStatusCatalog.codes
        XCTAssertEqual(HttpStatusProjector.slice(codes, page: 1, pageSize: 10).count, 10)
        XCTAssertEqual(HttpStatusProjector.slice(codes, page: 2, pageSize: 10).count, 9)
        XCTAssertTrue(HttpStatusProjector.slice(codes, page: 3, pageSize: 10).isEmpty)
    }
}

// MARK: - Projection: end-to-end derivation

@MainActor final class HttpStatusProjectionTests: XCTestCase {
    func testDefaultProjectionFitsOnePage() {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes)
        XCTAssertEqual(projection.rows.count, 19)
        XCTAssertEqual(projection.totalCount, 19)
        XCTAssertEqual(projection.filteredCount, 19)
        XCTAssertEqual(projection.pageCount, 1)
        XCTAssertEqual(projection.rangeStart, 1)
        XCTAssertEqual(projection.rangeEnd, 19)
        XCTAssertFalse(projection.isFilteredEmpty)
        XCTAssertFalse(projection.hasPagination)
        XCTAssertFalse(projection.hasQuery)
        XCTAssertEqual(projection.rows.first?.tone, .success)
    }

    func testFilteredProjection() {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes, query: "500")
        XCTAssertEqual(projection.rows.map(\.code), [500])
        XCTAssertEqual(projection.filteredCount, 1)
        XCTAssertEqual(projection.rangeStart, 1)
        XCTAssertEqual(projection.rangeEnd, 1)
        XCTAssertTrue(projection.hasQuery)
        XCTAssertEqual(projection.rows.first?.tone, .danger)
    }

    func testSearchEmptyProjection() {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes, query: "zzz")
        XCTAssertTrue(projection.rows.isEmpty)
        XCTAssertTrue(projection.isFilteredEmpty)
        XCTAssertEqual(projection.rangeStart, 0)
        XCTAssertEqual(projection.rangeEnd, 0)
    }

    func testPaginatedSecondPageRange() {
        let projection = HttpStatusProjector.project(
            codes: HttpStatusCatalog.codes,
            page: 2,
            pageSize: 10
        )
        XCTAssertEqual(projection.rows.count, 9)
        XCTAssertEqual(projection.page, 2)
        XCTAssertEqual(projection.pageCount, 2)
        XCTAssertEqual(projection.rangeStart, 11)
        XCTAssertEqual(projection.rangeEnd, 19)
        XCTAssertTrue(projection.hasPagination)
    }

    func testPageClampedIntoRange() {
        let projection = HttpStatusProjector.project(
            codes: HttpStatusCatalog.codes,
            page: 99,
            pageSize: 10
        )
        XCTAssertEqual(projection.page, 2)
    }

    func testDescendingSortProjection() {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes, sort: .descending)
        XCTAssertEqual(projection.rows.first?.code, 504)
        XCTAssertEqual(projection.rows.last?.code, 200)
    }
}

// MARK: - Strings + accessibility (English fallbacks)

@MainActor final class HttpStatusStringsTests: XCTestCase {
    func testToneLabels() {
        XCTAssertEqual(HttpStatusStrings.toneLabel(.success), "Success")
        XCTAssertEqual(HttpStatusStrings.toneLabel(.info), "Redirect")
        XCTAssertEqual(HttpStatusStrings.toneLabel(.warning), "Client error")
        XCTAssertEqual(HttpStatusStrings.toneLabel(.danger), "Server error")
    }

    func testParityKeysRenderVerbatim() {
        // The web keys are absent from en.json, so i18next renders the key text.
        XCTAssertEqual(HttpStatusStrings.string("Http Status", "Http Status"), "Http Status")
        XCTAssertEqual(HttpStatusStrings.string("Status Code", "Status Code"), "Status Code")
    }

    func testPageRangeAndPosition() {
        XCTAssertEqual(HttpStatusStrings.pageRange(start: 1, end: 19, total: 19), "1–19 of 19")
        XCTAssertEqual(HttpStatusStrings.pagePosition(page: 1, of: 2), "Page 1 of 2")
    }
}

@MainActor final class HttpStatusAccessibilityTests: XCTestCase {
    func testSummaryForContent() {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes)
        let summary = HttpStatusAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("19"))
        XCTAssertTrue(summary.contains("status codes"))
    }

    func testSummaryForSearchEmpty() {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes, query: "zzz")
        XCTAssertEqual(HttpStatusAccessibility.summary(for: projection), "No matching status codes")
    }

    func testRowLabelIncludesClassTextAndDesc() throws {
        let projection = HttpStatusProjector.project(codes: HttpStatusCatalog.codes, query: "404")
        let row = try? XCTUnwrap(projection.rows.first)
        XCTAssertEqual(
            try HttpStatusAccessibility.rowLabel(for: XCTUnwrap(row)),
            "404 Client error. Not Found. Resource not found"
        )
    }
}

// MARK: - State holder: phases + UI state + telemetry + source wiring

@MainActor final class HttpStatusModelTests: XCTestCase {
    private func makeModel(
        _ update: HttpStatusUpdate,
        telemetry: HttpStatusTelemetry = OSLogHttpStatusTelemetry()
    ) -> (HttpStatusModel, InMemoryHttpStatusSource) {
        let source = InMemoryHttpStatusSource(initial: update)
        let model = HttpStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutCatalogShowsLoading() {
        let (model, _) = makeModel(HttpStatusUpdate(status: .loading, codes: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(HttpStatusUpdate(status: .empty, codes: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(HttpStatusUpdate(status: .failed("boom"), codes: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testLoadedShowsContentWithFullCatalog() {
        let (model, _) = makeModel(
            HttpStatusUpdate(status: .loaded, codes: HttpStatusCatalog.codes)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 19)
    }

    func testCachedCatalogStaysVisibleOnFailure() {
        let (model, _) = makeModel(
            HttpStatusUpdate(status: .failed("net"), codes: HttpStatusCatalog.codes)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyHttpStatusTelemetry()
        let (model, source) = makeModel(HttpStatusUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HttpStatusTool.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(HttpStatusUpdate(status: .loaded, codes: HttpStatusCatalog.codes))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testSearchFiltersAndResetsPage() {
        let (model, _) = makeModel(HttpStatusUpdate(status: .loaded, codes: HttpStatusCatalog.codes))
        model.start()
        model.search = "429"
        XCTAssertEqual(model.projection.rows.map(\.code), [429])
        XCTAssertEqual(model.page, 1)
        XCTAssertTrue(model.projection.hasQuery)
    }

    func testToggleSortCyclesAndReprojects() {
        let (model, _) = makeModel(HttpStatusUpdate(status: .loaded, codes: HttpStatusCatalog.codes))
        model.start()
        model.toggleSort()
        XCTAssertEqual(model.sort, .ascending)
        model.toggleSort()
        XCTAssertEqual(model.sort, .descending)
        XCTAssertEqual(model.projection.rows.first?.code, 504)
    }

    func testPaginationNavigationClamps() {
        let source = InMemoryHttpStatusSource(
            initial: HttpStatusUpdate(status: .loaded, codes: HttpStatusCatalog.codes)
        )
        let model = HttpStatusModel(source: source, pageSize: 10)
        model.start()
        XCTAssertEqual(model.projection.pageCount, 2)
        model.previousPage()
        XCTAssertEqual(model.page, 1)
        model.nextPage()
        XCTAssertEqual(model.page, 2)
        model.nextPage()
        XCTAssertEqual(model.page, 2, "clamped at the last page")
        XCTAssertEqual(model.projection.rangeStart, 11)
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(HttpStatusUpdate(status: .loading, codes: nil))
        model.start()
        source.push(
            HttpStatusUpdate(
                status: .loaded,
                connection: .offline,
                codes: HttpStatusCatalog.codes,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
    }

    func testResolvePhaseTable() {
        XCTAssertEqual(HttpStatusModel.resolvePhase(status: .loading, hasCatalog: false), .loading)
        XCTAssertEqual(HttpStatusModel.resolvePhase(status: .loading, hasCatalog: true), .content)
        XCTAssertEqual(HttpStatusModel.resolvePhase(status: .empty, hasCatalog: true), .empty)
        XCTAssertEqual(HttpStatusModel.resolvePhase(status: .loaded, hasCatalog: false), .empty)
        XCTAssertEqual(HttpStatusModel.resolvePhase(status: .failed("x"), hasCatalog: true), .content)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(HttpStatusTool.surfaceSlug, "HttpStatusTool")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyHttpStatusTelemetry: HttpStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
