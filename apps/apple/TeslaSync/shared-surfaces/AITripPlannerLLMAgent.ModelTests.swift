//
//  AITripPlannerLLMAgent.ModelTests.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  State-holder coverage for `TripPlannerAgentModel`: the wiring over `TripPlannerAgentSource`, the
//  P1/S11 `view.opened` telemetry (deferred past the off-mode gate), the stale one-shot auto-refresh
//  + re-arm, the offline no-refresh rule, and the generate / cancel / refresh / stop delegation.
//  Driven by `InMemoryTripPlannerAgentSource` with an injected locale — no network, no real store.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let sf = TripPlannerAgentLocation(lat: 37.7749, lng: -122.4194, name: "San Francisco")
private let la = TripPlannerAgentLocation(lat: 34.0522, lng: -118.2437, name: "Los Angeles")

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class TripPlannerAgentModelTests: XCTestCase {
    private func makeModel(
        _ input: TripPlannerAgentInput,
        telemetry: TripPlannerAgentTelemetry = OSLogTripPlannerAgentTelemetry()
    ) -> (TripPlannerAgentModel, InMemoryTripPlannerAgentSource) {
        let source = InMemoryTripPlannerAgentSource(initial: input)
        let model = TripPlannerAgentModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        origin: TripPlannerAgentLocation? = sf,
        destination: TripPlannerAgentLocation? = la,
        connection: TripPlannerAgentConnection = .live,
        stream: TripPlannerAgentStreamSnapshot = .idle
    ) -> TripPlannerAgentInput {
        TripPlannerAgentInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            origin: origin,
            destination: destination,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTripPlannerAgentTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AITripPlannerLLMAgent.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyTripPlannerAgentTelemetry()
        let (model, _) = makeModel(
            TripPlannerAgentInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyTripPlannerAgentTelemetry()
        let (model, source) = makeModel(
            TripPlannerAgentInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AITripPlannerLLMAgent.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AITripPlannerLLMAgent.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(TripPlannerAgentInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: TripPlannerAgentStreamSnapshot(state: .done, text: "SF → LA.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "SF → LA.")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(enabled())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(enabled(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(enabled(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(connection: .stale)) // refresh 1
        source.push(enabled(connection: .live)) // re-arm
        source.push(enabled(connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testGenerateDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.generate()
        XCTAssertEqual(source.generateCount, 1)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AITripPlannerLLMAgent.surfaceSlug, "AITripPlannerLLMAgent")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTripPlannerAgentTelemetry: TripPlannerAgentTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
