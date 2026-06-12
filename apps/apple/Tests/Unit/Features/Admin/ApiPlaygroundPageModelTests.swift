import XCTest
@testable import TeslaSync

/// State-machine tests for `ApiPlaygroundPageModel` — every data state the page renders
/// (loading / empty / error / success), plus selection, grouping, and the endpoint
/// count surfaced by `playground.endpointCount`.
@MainActor final class ApiPlaygroundPageModelTests: XCTestCase {
    private struct StubCatalog: ApiEndpointCatalogProviding {
        let endpoints: [ApiEndpoint]
        let fails: Bool

        init(_ endpoints: [ApiEndpoint], fails: Bool = false) {
            self.endpoints = endpoints
            self.fails = fails
        }

        func load() async throws -> [ApiEndpoint] {
            if fails { throw CatalogError() }
            return endpoints
        }
    }

    private struct CatalogError: Error {}

    private func sample(_ count: Int) -> [ApiEndpoint] {
        (0 ..< count).map {
            ApiEndpoint(method: .get, path: "/p\($0)", tag: $0.isMultiple(of: 2) ? "A" : "B", summary: "s")
        }
    }

    func testInitialStateIsLoading() {
        let model = ApiPlaygroundPageModel(catalog: StubCatalog([]))
        XCTAssertEqual(model.state, .loading)
        XCTAssertNil(model.selected)
        XCTAssertFalse(model.showsEndpointCount)
    }

    func testLoadSuccessPopulatesEndpoints() async {
        let endpoints = sample(3)
        let model = ApiPlaygroundPageModel(catalog: StubCatalog(endpoints))
        await model.load()
        XCTAssertEqual(model.state, .loaded(endpoints))
        XCTAssertEqual(model.endpointCount, 3)
        XCTAssertTrue(model.showsEndpointCount)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = ApiPlaygroundPageModel(catalog: StubCatalog([]))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertEqual(model.endpointCount, 0)
        XCTAssertFalse(model.showsEndpointCount)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = ApiPlaygroundPageModel(catalog: StubCatalog([], fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }

    func testSelectionAndClear() async {
        let endpoints = sample(2)
        let model = ApiPlaygroundPageModel(catalog: StubCatalog(endpoints))
        await model.load()
        model.select(endpoints[1])
        XCTAssertEqual(model.selected, endpoints[1])
        model.clearSelection()
        XCTAssertNil(model.selected)
    }

    func testGroupingPreservesFirstSeenOrder() async {
        let endpoints = [
            ApiEndpoint(method: .get, path: "/a", tag: "Vehicles", summary: ""),
            ApiEndpoint(method: .post, path: "/b", tag: "Alerts", summary: ""),
            ApiEndpoint(method: .get, path: "/c", tag: "Vehicles", summary: "")
        ]
        let model = ApiPlaygroundPageModel(catalog: StubCatalog(endpoints))
        await model.load()
        let groups = model.groupedEndpoints
        XCTAssertEqual(groups.map(\.tag), ["Vehicles", "Alerts"])
        XCTAssertEqual(groups.first?.endpoints.count, 2)
    }

    func testRefreshResetsSelection() async {
        let model = ApiPlaygroundPageModel(catalog: StubCatalog(sample(1)))
        await model.load()
        model.select(model.endpoints[0])
        await model.refresh()
        XCTAssertNil(model.selected)
        XCTAssertEqual(model.endpointCount, 1)
    }

    func testStaticCatalogIsNonEmptyAndWellFormed() async throws {
        let endpoints = try await StaticApiEndpointCatalog().load()
        XCTAssertFalse(endpoints.isEmpty)
        XCTAssertTrue(endpoints.allSatisfy { !$0.path.isEmpty && !$0.tag.isEmpty })
        XCTAssertEqual(Set(endpoints.map(\.id)).count, endpoints.count, "endpoint ids are unique")
    }
}
