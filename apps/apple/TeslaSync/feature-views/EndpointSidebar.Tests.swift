//
//  EndpointSidebar.Tests.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  Unit coverage for the EndpointSidebar surface:
//    • Adapter (search → filter → group) — `EndpointSidebarBuilder` parity with
//      the web `filtered` / `grouped` / `defaultOpen` view-locals.
//    • State holder — `EndpointSidebarModel` phase resolution + search-driven
//      projection + selection forwarding + P1/S11 `view.opened` telemetry.
//    • Method mapping — `HTTPMethod` token/parse + the badge tone table.
//    • Accessibility — the VoiceOver row/group label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryEndpointCatalogSource`. The
//  pure-adapter subset is additionally proven by a standalone host harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum EndpointFixtures {
    static func make(
        _ method: HTTPMethod,
        _ path: String,
        tag: String,
        summary: String = "",
        operationId: String = ""
    ) -> ParsedEndpoint {
        ParsedEndpoint(method: method, path: path, tag: tag, summary: summary, operationId: operationId)
    }

    static let catalog: [ParsedEndpoint] = [
        make(.get, "/vehicles", tag: "Vehicles", summary: "List vehicles", operationId: "listVehicles"),
        make(.get, "/vehicles/{id}/state", tag: "Vehicles", summary: "State", operationId: "getVehicleState"),
        make(.get, "/charging", tag: "Charging", summary: "Sessions", operationId: "listCharging"),
        make(.delete, "/charging/{id}", tag: "Charging", summary: "Delete", operationId: "deleteCharging"),
        make(.get, "/drives", tag: "Drives", summary: "List drives", operationId: "listDrives")
    ]
}

// MARK: - Adapter: search → filter → group (web view-local parity)

@MainActor final class EndpointSidebarBuilderTests: XCTestCase {
    func testEmptyQueryReturnsAllEndpoints() {
        XCTAssertEqual(EndpointSidebarBuilder.filter(EndpointFixtures.catalog, query: "").count, 5)
    }

    func testWhitespaceQueryReturnsAllEndpoints() {
        XCTAssertEqual(EndpointSidebarBuilder.filter(EndpointFixtures.catalog, query: "   ").count, 5)
    }

    func testFilterMatchesPathCaseInsensitively() {
        let result = EndpointSidebarBuilder.filter(EndpointFixtures.catalog, query: "CHARG")
        XCTAssertEqual(result.count, 2)
        XCTAssertTrue(result.allSatisfy { $0.path.contains("charging") })
    }

    func testFilterMatchesSummaryAndOperationId() {
        XCTAssertEqual(EndpointSidebarBuilder.filter(EndpointFixtures.catalog, query: "list drives").count, 1)
        XCTAssertEqual(EndpointSidebarBuilder.filter(EndpointFixtures.catalog, query: "getVehicleState").count, 1)
    }

    func testFilterWithNoMatchIsEmpty() {
        XCTAssertTrue(EndpointSidebarBuilder.filter(EndpointFixtures.catalog, query: "zzzzz").isEmpty)
    }

    func testGroupPreservesFirstSeenTagOrder() {
        let endpoints = [
            EndpointFixtures.make(.get, "/b1", tag: "Beta"),
            EndpointFixtures.make(.get, "/a1", tag: "Alpha"),
            EndpointFixtures.make(.get, "/b2", tag: "Beta"),
            EndpointFixtures.make(.get, "/c1", tag: "Gamma")
        ]
        let groups = EndpointSidebarBuilder.group(endpoints, selected: nil)
        XCTAssertEqual(groups.map(\.tag), ["Beta", "Alpha", "Gamma"])
        XCTAssertEqual(groups.first?.count, 2)
    }

    func testBlankTagFallsBackToOther() {
        let groups = EndpointSidebarBuilder.group([EndpointFixtures.make(.get, "/x", tag: "  ")], selected: nil)
        XCTAssertEqual(groups.first?.tag, EndpointSidebarProjection.untaggedTag)
    }

    func testGroupsAutoExpandWhenFiveOrFewer() {
        let groups = EndpointSidebarBuilder.group(EndpointFixtures.catalog, selected: nil)
        XCTAssertTrue(groups.allSatisfy(\.isInitiallyExpanded))
    }

    func testManyGroupsCollapseExceptSelectedTag() {
        let endpoints = (0 ..< 6).map { EndpointFixtures.make(.get, "/p\($0)", tag: "Tag\($0)") }
        let selected = endpoints[3]
        let groups = EndpointSidebarBuilder.group(endpoints, selected: selected)
        let selectedGroup = groups.first { $0.tag == "Tag3" }
        let otherGroup = groups.first { $0.tag == "Tag0" }
        XCTAssertEqual(selectedGroup?.isInitiallyExpanded, true)
        XCTAssertEqual(otherGroup?.isInitiallyExpanded, false)
    }

    func testProjectReportsFilteredCount() {
        let projection = EndpointSidebarBuilder.project(
            endpoints: EndpointFixtures.catalog, query: "charg", selected: nil
        )
        XCTAssertEqual(projection.filteredCount, 2)
        XCTAssertFalse(projection.hasNoMatches)
    }

    func testProjectFlagsNoMatches() {
        let projection = EndpointSidebarBuilder.project(
            endpoints: EndpointFixtures.catalog, query: "zzz", selected: nil
        )
        XCTAssertTrue(projection.hasNoMatches)
        XCTAssertEqual(projection.filteredCount, 0)
    }
}

// MARK: - State holder: phases + telemetry + selection + search

@MainActor final class EndpointSidebarModelTests: XCTestCase {
    private func makeModel(
        _ update: EndpointSidebarUpdate,
        telemetry: EndpointSidebarTelemetry = OSLogEndpointSidebarTelemetry(),
        onSelect: (@MainActor (ParsedEndpoint) -> Void)? = nil
    ) -> (EndpointSidebarModel, InMemoryEndpointCatalogSource) {
        let source = InMemoryEndpointCatalogSource(initial: update)
        let model = EndpointSidebarModel(source: source, telemetry: telemetry, onSelect: onSelect)
        return (model, source)
    }

    func testLoadingWithoutEndpointsShowsLoading() {
        let (model, _) = makeModel(EndpointSidebarUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutEndpointsShowsEmpty() {
        let (model, _) = makeModel(EndpointSidebarUpdate(status: .loaded, endpoints: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(EndpointSidebarUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedEndpointsStayVisibleWhileFetchingOrFailed() {
        let (loading, _) = makeModel(
            EndpointSidebarUpdate(status: .loading, endpoints: EndpointFixtures.catalog)
        )
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(
            EndpointSidebarUpdate(status: .failed("net"), endpoints: EndpointFixtures.catalog)
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyEndpointTelemetry()
        let (model, source) = makeModel(EndpointSidebarUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [EndpointSidebarView.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EndpointSidebarUpdate(status: .loaded, endpoints: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testSelectUpdatesSelectionAndForwardsToHost() {
        var forwarded: ParsedEndpoint?
        let (model, _) = makeModel(
            EndpointSidebarUpdate(status: .loaded, endpoints: EndpointFixtures.catalog),
            onSelect: { forwarded = $0 }
        )
        model.start()
        let target = EndpointFixtures.catalog[2]
        model.select(target)
        XCTAssertEqual(model.selected?.id, target.id)
        XCTAssertTrue(model.isSelected(target))
        XCTAssertEqual(forwarded?.id, target.id)
    }

    func testSearchDrivesProjection() {
        let (model, _) = makeModel(
            EndpointSidebarUpdate(status: .loaded, endpoints: EndpointFixtures.catalog)
        )
        model.start()
        XCTAssertEqual(model.projection.filteredCount, 5)
        model.search = "charg"
        XCTAssertEqual(model.projection.filteredCount, 2)
        XCTAssertEqual(model.projection.groups.map(\.tag), ["Charging"])
    }

    func testIncomingSelectionSeedsModel() {
        let target = EndpointFixtures.catalog[1]
        let (model, _) = makeModel(
            EndpointSidebarUpdate(status: .loaded, endpoints: EndpointFixtures.catalog, selected: target)
        )
        model.start()
        XCTAssertEqual(model.selected?.id, target.id)
    }
}

// MARK: - HTTP method token / parse / tone

@MainActor final class EndpointMethodTests: XCTestCase {
    func testTokenIsAlwaysUpperCased() {
        XCTAssertEqual(HTTPMethod.get.token, "GET")
        XCTAssertEqual(HTTPMethod.patch.token, "PATCH")
        XCTAssertEqual(HTTPMethod.other("trace").token, "TRACE")
    }

    func testParsingIsCaseInsensitiveWithFallback() {
        XCTAssertEqual(HTTPMethod(token: "post"), .post)
        XCTAssertEqual(HTTPMethod(token: " Delete "), .delete)
        XCTAssertEqual(HTTPMethod(token: "HEAD"), .other("HEAD"))
    }

    func testToneTableMatchesWebMethodColors() {
        XCTAssertEqual(endpointMethodTone(.get).color, TSTone.success.color)
        XCTAssertEqual(endpointMethodTone(.post).color, TSTone.info.color)
        XCTAssertEqual(endpointMethodTone(.put).color, TSTone.warning.color)
        XCTAssertEqual(endpointMethodTone(.delete).color, TSTone.danger.color)
        XCTAssertEqual(endpointMethodTone(.patch).color, TSTone.accent.color)
        XCTAssertEqual(endpointMethodTone(.other("X")).color, TSTone.neutral.color)
    }
}

// MARK: - Accessibility label content

@MainActor final class EndpointSidebarAccessibilityTests: XCTestCase {
    func testRowLabelIncludesMethodPathAndSummary() {
        let endpoint = EndpointFixtures.make(.get, "/vehicles", tag: "Vehicles", summary: "List vehicles")
        let label = EndpointSidebarAccessibility.rowLabel(for: endpoint, isSelected: false)
        XCTAssertTrue(label.contains("GET"))
        XCTAssertTrue(label.contains("/vehicles"))
        XCTAssertTrue(label.contains("List vehicles"))
        XCTAssertFalse(label.contains("Selected"))
    }

    func testRowLabelAppendsSelectedSuffix() {
        let endpoint = EndpointFixtures.make(.post, "/x", tag: "T")
        let label = EndpointSidebarAccessibility.rowLabel(for: endpoint, isSelected: true)
        XCTAssertTrue(label.contains("Selected"))
    }

    func testGroupLabelIncludesTagAndCount() {
        let label = EndpointSidebarAccessibility.groupLabel(tag: "Vehicles", count: 3)
        XCTAssertTrue(label.contains("Vehicles"))
        XCTAssertTrue(label.contains("3"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEndpointTelemetry: EndpointSidebarTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
