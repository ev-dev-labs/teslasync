//
//  TemperatureGauges.ModelTests.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  State-holder coverage for the temperature-gauges surface (the adapter + accessibility logic
//  tests live in TemperatureGauges.Tests.swift; the per-state view-render smoke tests live in
//  TemperatureGauges.ViewTests.swift): `TemperatureGaugesModel` phase resolution, projection
//  recompute, refresh delegation, the stale one-shot auto-refresh, and the P1/S11 `view.opened`
//  telemetry. Driven by `InMemoryTemperatureGaugesSource`, so the tests run with no network and no
//  real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class TemperatureGaugesModelTests: XCTestCase {
    private func makeModel(
        _ update: TemperatureGaugesUpdate,
        telemetry: TemperatureGaugesTelemetry = OSLogTemperatureGaugesTelemetry()
    ) -> (TemperatureGaugesModel, InMemoryTemperatureGaugesSource) {
        let source = InMemoryTemperatureGaugesSource(initial: update)
        let model = TemperatureGaugesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> [TempSensorInput] {
        [
            TempSensorInput(
                id: "frontMotor",
                labelKey: "drivetrain.frontMotor",
                labelFallback: "Front Motor",
                valueCelsius: 95,
                maxTempCelsius: 150
            ),
            TempSensorInput(
                id: "battery",
                labelKey: "drivetrain.battery",
                labelFallback: "Battery",
                valueCelsius: 34,
                maxTempCelsius: 60
            )
        ]
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(TemperatureGaugesModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testHasDataTreatsNilAndEmptyAsNoData() {
        XCTAssertFalse(TemperatureGaugesModel.hasData(nil))
        XCTAssertFalse(TemperatureGaugesModel.hasData([]))
        XCTAssertTrue(TemperatureGaugesModel.hasData(sample()))
    }

    func testInitialContentProjectsGauges() {
        let (model, _) = makeModel(TemperatureGaugesUpdate(status: .loaded, sensors: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauges.count, 2)
        XCTAssertEqual(model.projection?.gauges.first?.valueText, "95")
    }

    func testEmptyLoadingErrorPhases() {
        let (empty, _) = makeModel(TemperatureGaugesUpdate(status: .empty, sensors: []))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(TemperatureGaugesUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(TemperatureGaugesUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedGaugesStayContentWhileFailing() {
        let (model, source) = makeModel(TemperatureGaugesUpdate(status: .loaded, sensors: sample()))
        model.start()
        source.push(TemperatureGaugesUpdate(status: .failed("net"), connection: .offline, sensors: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(TemperatureGaugesUpdate(status: .loading))
        model.start()
        source.push(
            TemperatureGaugesUpdate(
                status: .loaded,
                connection: .offline,
                isFetching: true,
                sensors: sample(),
                units: TemperatureGaugesUnitPrefs(temperature: .fahrenheit),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.temperature, .fahrenheit)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
        XCTAssertEqual(model.projection?.gauges.first?.unit, "°F")
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(TemperatureGaugesUpdate(status: .loaded, sensors: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(TemperatureGaugesUpdate(status: .loaded, sensors: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0) // live → no refresh
        source.push(TemperatureGaugesUpdate(status: .loaded, connection: .stale, sensors: sample()))
        XCTAssertEqual(source.refreshCount, 1) // stale → one auto-refresh
        source.push(TemperatureGaugesUpdate(status: .loaded, connection: .stale, sensors: sample()))
        XCTAssertEqual(source.refreshCount, 1) // still stale → guarded
        source.push(TemperatureGaugesUpdate(status: .loaded, connection: .live, sensors: sample()))
        source.push(TemperatureGaugesUpdate(status: .loaded, connection: .stale, sensors: sample()))
        XCTAssertEqual(source.refreshCount, 2) // re-armed after live
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(TemperatureGaugesUpdate(status: .loaded, sensors: sample()))
        model.start()
        source.push(TemperatureGaugesUpdate(status: .loaded, connection: .offline, sensors: sample()))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTemperatureGaugesTelemetry()
        let (model, source) = makeModel(TemperatureGaugesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TemperatureGaugesSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
final class SpyTemperatureGaugesTelemetry: TemperatureGaugesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
