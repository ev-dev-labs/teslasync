//
//  FleetApiSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  State-holder coverage for the FleetApiSection surface: the `@Observable`
//  FleetApiSectionModel applying source snapshots (queries / vehicles / connection
//  → phase / freshness / derived flags), the P1/S11 `view.opened` telemetry, the
//  request lifecycle (loading → resolved result filed under the request id), and
//  the start/stop/refresh source wiring. Driven by InMemoryFleetApiSource — no
//  network, no view.
//

import XCTest
@testable import TeslaSync

@MainActor final class FleetApiSectionModelTests: XCTestCase {
    private func makeModel(
        _ snapshot: FleetSnapshot,
        canned: [String: ToolResult] = [:],
        autoResolve: Bool = true,
        telemetry: FleetApiTelemetry = OSLogFleetApiTelemetry()
    ) -> (FleetApiSectionModel, InMemoryFleetApiSource) {
        let source = InMemoryFleetApiSource(initial: snapshot, canned: canned, autoResolve: autoResolve)
        let model = FleetApiSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testAppliesSnapshot() {
        let stamp = Date()
        let (model, _) = makeModel(FleetSnapshot(
            fleetInfo: .loaded(.object(["baseUrl": .string("u")])),
            publicKeyStatus: .loaded(.object(["configured": .bool(true)])),
            vehicles: [VehicleOption(vin: "V1", label: "Car")],
            connection: .stale,
            updatedAt: stamp
        ))
        model.start()
        XCTAssertEqual(model.vehicles.count, 1)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.updatedAt, stamp)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.freshness, .stale)
    }

    func testDerivedFlags() {
        let (model, _) = makeModel(FleetSnapshot(
            fleetInfo: .loaded(.object(["authenticated": .bool(true), "hostname": .string("h.example")])),
            publicKeyStatus: .loaded(.object(["configured": .bool(true)]))
        ))
        model.start()
        XCTAssertTrue(model.isAuthenticated)
        XCTAssertTrue(model.isKeypairConfigured)
        XCTAssertEqual(model.hostname, "h.example")
    }

    func testDerivedFlagsDefaultFalseWhileLoading() {
        let (model, _) = makeModel(FleetSnapshot(fleetInfo: .loading, publicKeyStatus: .loading))
        model.start()
        XCTAssertFalse(model.isAuthenticated)
        XCTAssertFalse(model.isKeypairConfigured)
        XCTAssertEqual(model.hostname, "")
        XCTAssertEqual(model.phase, .loading)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyFleetApiTelemetry()
        let (model, source) = makeModel(FleetSnapshot(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FleetApiSectionModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRunFilesLoadingThenResolves() {
        let (model, source) = makeModel(FleetSnapshot(), autoResolve: false)
        model.start()
        let request = FleetRequest(id: "register-partner", endpoint: "register-partner", method: .post)
        model.run(request)
        XCTAssertEqual(model.result(for: "register-partner"), .loading)
        XCTAssertEqual(source.performed.map(\.id), ["register-partner"])
        source.resolve("register-partner", .success(.object(["registered": .bool(true)])))
        XCTAssertEqual(model.result(for: "register-partner"), .success(.object(["registered": .bool(true)])))
    }

    func testRunAutoResolvesFromCanned() {
        let (model, _) = makeModel(
            FleetSnapshot(),
            canned: ["fleet-status": .success(.object(["online": .number(2)]))]
        )
        model.start()
        model.run(FleetRequest(id: "fleet-status", endpoint: "fleet-status", method: .post))
        XCTAssertEqual(model.result(for: "fleet-status"), .success(.object(["online": .number(2)])))
    }

    func testResultDefaultsToIdle() {
        let (model, _) = makeModel(FleetSnapshot())
        model.start()
        XCTAssertEqual(
            model.result(for: "never-run", idleKey: "k", idleFallback: "f"),
            .idle(messageKey: "k", fallback: "f")
        )
    }

    func testRefreshAndStopDelegate() {
        let (model, source) = makeModel(FleetSnapshot())
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testPushUpdatesFreshness() {
        let (model, source) = makeModel(FleetSnapshot(fleetInfo: .loading, publicKeyStatus: .loading))
        model.start()
        source.push(FleetSnapshot(
            fleetInfo: .loaded(.object(["baseUrl": .string("u")])),
            publicKeyStatus: .loaded(.object([:])),
            connection: .offline,
            updatedAt: Date()
        ))
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.connection, .offline)
    }

    func testSurfaceSlugMatchesDiagnosticsContract() {
        XCTAssertEqual(FleetApiSection.surfaceSlug, "FleetApiSection")
        XCTAssertEqual(FleetApiSectionModel.surfaceSlug, "FleetApiSection")
    }
}

// MARK: - Test double

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFleetApiTelemetry: FleetApiTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
