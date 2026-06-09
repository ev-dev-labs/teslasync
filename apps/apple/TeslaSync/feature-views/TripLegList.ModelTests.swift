//
//  TripLegList.ModelTests.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  State-holder coverage for `TripLegListModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the connection axis (live / stale / offline) with
//  the one-shot stale auto-refresh (re-armed on return to live), offline keeping the
//  cached rows, and the manual refresh / stop-and-restart wiring. Driven through the
//  in-memory source — no network.
//

import XCTest
@testable import TeslaSync

private func sampleLeg(arrivalSoc: Double = 60) -> TripLegData {
    TripLegData(
        from: TripLocationData(lat: 0, lng: 0, name: "Home"),
        to: TripLocationData(lat: 0, lng: 0, name: "Work"),
        distanceM: 12340,
        durationS: 1234,
        energyWh: 12300,
        startSoc: 80,
        arrivalSoc: arrivalSoc
    )
}

private func sampleStop() -> TripChargeStopData {
    TripChargeStopData(
        name: "Supercharger",
        location: TripLocationData(lat: 0, lng: 0, name: "Supercharger"),
        chargeFromSoc: 20,
        chargeToSoc: 80,
        chargeDurationS: 1500,
        energyWh: 30000,
        cost: 12.5,
        isRecommended: true
    )
}

@MainActor
final class TripLegListModelTests: XCTestCase {
    private func makeModel(
        _ input: TripLegListInput,
        telemetry: TripLegListTelemetry = OSLogTripLegListTelemetry()
    ) -> (TripLegListModel, InMemoryTripLegListSource) {
        let source = InMemoryTripLegListSource(initial: input)
        let model = TripLegListModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: TripLegListInput {
        TripLegListInput(legs: [sampleLeg(), sampleLeg()], chargeStops: [sampleStop()])
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTripLegListTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 2)
        XCTAssertNotNil(model.resolved.rows[0].chargeStop)
        XCTAssertEqual(spy.surfaces, [TripLegList.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(TripLegListInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testResolvedWithoutLegsProjectsEmpty() {
        let (model, _) = makeModel(TripLegListInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(TripLegListInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(TripLegListInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(TripLegListInput(legs: [sampleLeg()]))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(TripLegListInput(legs: [sampleLeg()], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(TripLegListInput(legs: [sampleLeg()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(TripLegListInput(legs: [sampleLeg()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(TripLegListInput(legs: [sampleLeg()], connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(TripLegListInput(legs: [sampleLeg()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedRowsAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(TripLegListInput(legs: [sampleLeg()], chargeStops: [sampleStop()], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 1)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TripLegList.surfaceSlug, "TripLegList")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-
/// guarded so it satisfies the `Sendable` telemetry seam under Swift 6 strict
/// concurrency.
private final class SpyTripLegListTelemetry: TripLegListTelemetry, @unchecked Sendable {
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
