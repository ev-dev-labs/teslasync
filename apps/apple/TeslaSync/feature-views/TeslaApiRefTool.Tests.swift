//
//  TeslaApiRefTool.Tests.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  Unit coverage for the TeslaApiRefTool surface:
//    • Adapter (cached catalog → projection) — the search filter across method / path /
//      desc, the method → badge-tone mapping, the shell phase + freshness resolution,
//      the result-count summary, and the relative-time buckets (port parity with the
//      web source).
//    • Catalog — the bundled endpoint table matches the web `TESLA_ENDPOINTS` constant.
//    • State holder — `TeslaApiRefModel` phase / freshness / connection tracking plus the
//      P1/S11 `view.opened` telemetry + source wiring (incl. the static catalog source).
//    • Accessibility — the VoiceOver row label (Method / Path / Endpoint Desc) + the
//      freshness copy.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by InMemoryTeslaApiRefSource. The pure adapter subset is
//  additionally proven by an executed headless harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: filter / tone / phase / freshness / format

final class TeslaApiRefBuilderTests: XCTestCase {
    private var catalog: [TeslaApiEndpoint] {
        TeslaApiCatalog.endpoints
    }

    func testEmptyOrWhitespaceQueryReturnsFullCatalog() {
        XCTAssertEqual(TeslaApiRefBuilder.filter(catalog, search: "").count, catalog.count)
        XCTAssertEqual(TeslaApiRefBuilder.filter(catalog, search: "   ").count, catalog.count)
    }

    func testFilterMatchesPathCaseInsensitively() {
        let rows = TeslaApiRefBuilder.filter(catalog, search: "CHARGE")
        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.allSatisfy { row in
            row.method.lowercased().contains("charge")
                || row.path.lowercased().contains("charge")
                || row.desc.lowercased().contains("charge")
        })
        XCTAssertTrue(rows.contains { $0.path.contains("charge_start") })
    }

    func testFilterMatchesMethod() {
        let rows = TeslaApiRefBuilder.filter(catalog, search: "get")
        XCTAssertTrue(rows.contains { $0.path == "/api/1/vehicles" })
        XCTAssertTrue(rows.allSatisfy { row in
            row.method.lowercased().contains("get")
                || row.path.lowercased().contains("get")
                || row.desc.lowercased().contains("get")
        })
    }

    func testFilterMatchesDescription() {
        let rows = TeslaApiRefBuilder.filter(catalog, search: "wake")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.path, "/api/1/vehicles/{id}/command/wake_up")
    }

    func testFilterWithNoMatchesIsEmpty() {
        XCTAssertTrue(TeslaApiRefBuilder.filter(catalog, search: "zzz-no-such-endpoint").isEmpty)
    }

    func testMethodToneMapsReadsToInfoAndMutationsToWarning() {
        XCTAssertEqual(TeslaApiRefBuilder.methodTone(for: "GET"), .info)
        XCTAssertEqual(TeslaApiRefBuilder.methodTone(for: "get"), .info)
        XCTAssertEqual(TeslaApiRefBuilder.methodTone(for: "POST"), .warning)
        XCTAssertEqual(TeslaApiRefBuilder.methodTone(for: "DELETE"), .warning)
    }

    func testResolvePhase() {
        XCTAssertEqual(TeslaApiRefBuilder.resolvePhase(status: .loading, endpointCount: 0), .loading)
        XCTAssertEqual(TeslaApiRefBuilder.resolvePhase(status: .loaded, endpointCount: 0), .empty)
        XCTAssertEqual(TeslaApiRefBuilder.resolvePhase(status: .empty, endpointCount: 0), .empty)
        XCTAssertEqual(TeslaApiRefBuilder.resolvePhase(status: .failed("x"), endpointCount: 0), .error("x"))
        XCTAssertEqual(TeslaApiRefBuilder.resolvePhase(status: .loading, endpointCount: 11), .content)
        XCTAssertEqual(TeslaApiRefBuilder.resolvePhase(status: .failed("x"), endpointCount: 11), .content)
    }

    func testResolveFreshnessPrecedence() {
        XCTAssertEqual(TeslaApiRefBuilder.resolveFreshness(ApiRefUpdate(connection: .offline)), .offline)
        XCTAssertEqual(TeslaApiRefBuilder.resolveFreshness(ApiRefUpdate(isError: true)), .error)
        XCTAssertEqual(TeslaApiRefBuilder.resolveFreshness(ApiRefUpdate(isFetching: true)), .fetching)
        XCTAssertEqual(TeslaApiRefBuilder.resolveFreshness(ApiRefUpdate(connection: .stale)), .stale)
        XCTAssertEqual(TeslaApiRefBuilder.resolveFreshness(ApiRefUpdate()), .fresh)
        XCTAssertEqual(
            TeslaApiRefBuilder.resolveFreshness(ApiRefUpdate(connection: .offline, isError: true)),
            .offline
        )
    }

    func testResultsLabelBareVersusFiltered() {
        XCTAssertTrue(TeslaApiRefBuilder.resultsLabel(shown: 11, total: 11).contains("11"))
        let filtered = TeslaApiRefBuilder.resultsLabel(shown: 3, total: 11)
        XCTAssertTrue(filtered.contains("3"))
        XCTAssertTrue(filtered.contains("11"))
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertEqual(TeslaApiRefBuilder.relativeTime(since: now, now: now), "just now")
        XCTAssertTrue(TeslaApiRefBuilder.relativeTime(since: now.addingTimeInterval(-120), now: now).contains("2"))
        XCTAssertTrue(TeslaApiRefBuilder.relativeTime(since: now.addingTimeInterval(-7200), now: now).contains("2"))
        XCTAssertTrue(TeslaApiRefBuilder.relativeTime(since: now.addingTimeInterval(-172_800), now: now).contains("2"))
        XCTAssertTrue(TeslaApiRefBuilder.relativeTime(since: now.addingTimeInterval(-1_209_600), now: now)
            .contains("2"))
    }
}

// MARK: - Catalog parity (port of the web `TESLA_ENDPOINTS`)

final class TeslaApiCatalogTests: XCTestCase {
    func testCatalogMatchesWebConstant() {
        let endpoints = TeslaApiCatalog.endpoints
        XCTAssertEqual(endpoints.count, 11)
        XCTAssertEqual(endpoints.first?.method, "GET")
        XCTAssertEqual(endpoints.first?.path, "/api/1/vehicles")
        XCTAssertEqual(endpoints.first?.desc, "List vehicles")
        XCTAssertEqual(endpoints.last?.path, "/api/1/vehicles/{id}/nearby_charging_sites")
        XCTAssertEqual(endpoints.count(where: { $0.method == "GET" }), 3)
        XCTAssertEqual(endpoints.count(where: { $0.method == "POST" }), 8)
        XCTAssertEqual(endpoints.first?.id, endpoints.first?.path)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class TeslaApiRefModelTests: XCTestCase {
    private func makeModel(
        _ update: ApiRefUpdate,
        telemetry: TeslaApiRefTelemetry = OSLogTeslaApiRefTelemetry()
    ) -> (TeslaApiRefModel, InMemoryTeslaApiRefSource) {
        let source = InMemoryTeslaApiRefSource(initial: update)
        let model = TeslaApiRefModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ApiRefUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ApiRefUpdate(status: .loaded, endpoints: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ApiRefUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testContentWhenCatalogPresentEvenIfFailed() {
        let (model, _) = makeModel(ApiRefUpdate(status: .failed("net"), endpoints: TeslaApiCatalog.endpoints))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.totalCount, 11)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyTeslaApiRefTelemetry()
        let (model, source) = makeModel(ApiRefUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TeslaApiRefModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ApiRefUpdate(status: .loaded, endpoints: TeslaApiCatalog.endpoints))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(ApiRefUpdate(status: .loading))
        model.start()
        source.push(
            ApiRefUpdate(
                status: .loaded,
                connection: .offline,
                endpoints: TeslaApiCatalog.endpoints,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.freshness, .offline)
    }

    func testStaticSourceDeliversBundledCatalog() {
        let model = TeslaApiRefModel(source: StaticTeslaApiRefSource())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.totalCount, TeslaApiCatalog.endpoints.count)
        XCTAssertEqual(model.connection, .live)
    }

    func testSurfaceSlugIsCanonical() {
        XCTAssertEqual(TeslaApiRefTool.surfaceSlug, "TeslaApiRefTool")
        XCTAssertEqual(TeslaApiRefModel.surfaceSlug, "TeslaApiRefTool")
    }
}

// MARK: - Accessibility label content

final class TeslaApiRefAccessibilityTests: XCTestCase {
    func testRowLabelIncludesMethodPathAndDescription() {
        let endpoint = TeslaApiEndpoint(method: "GET", path: "/api/1/vehicles", desc: "List vehicles")
        let label = TeslaApiRefAccessibility.rowLabel(for: endpoint)
        XCTAssertTrue(label.contains("GET"))
        XCTAssertTrue(label.contains("/api/1/vehicles"))
        XCTAssertTrue(label.contains("List vehicles"))
        XCTAssertTrue(label.contains("Method"))
        XCTAssertTrue(label.contains("Path"))
        XCTAssertTrue(label.contains("Endpoint Desc"))
    }

    func testFreshnessLabelIsLocalized() {
        XCTAssertEqual(TeslaApiRefAccessibility.freshnessLabel(.fresh), "Live")
        XCTAssertEqual(TeslaApiRefAccessibility.freshnessLabel(.stale), "Stale")
        XCTAssertEqual(TeslaApiRefAccessibility.freshnessLabel(.offline), "Offline")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTeslaApiRefTelemetry: TeslaApiRefTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
