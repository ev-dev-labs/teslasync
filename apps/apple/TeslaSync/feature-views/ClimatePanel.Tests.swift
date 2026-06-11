//
//  ClimatePanel.Tests.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  State-holder coverage for the ClimatePanel surface: `CabinClimatePanelModel.resolvePhase`
//  across loading / empty / loaded / failed, plus the model wiring, the P1/S11 `view.opened`
//  telemetry, the freshness flag, and the stale one-shot auto-refresh. The projection + temperature
//  math are covered in ClimatePanel.ProjectionTests.swift.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryCabinClimatePanelSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Phase resolution

@MainActor final class CabinClimatePanelPhaseTests: XCTestCase {
    private let snapshot = CabinClimatePanelSnapshot(insideTempC: 21)

    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .loading)), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        XCTAssertEqual(
            CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .loading, snapshot: snapshot)),
            .content
        )
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .empty)), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .loaded)), .empty)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(
            CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .loaded, snapshot: snapshot)),
            .content
        )
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(
            CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testFailedWithCachedDataStaysContent() {
        XCTAssertEqual(
            CabinClimatePanelModel.resolvePhase(CabinClimatePanelUpdate(status: .failed("boom"), snapshot: snapshot)),
            .content
        )
    }
}

// MARK: - State holder: wiring + telemetry + freshness + stale auto-refresh

@MainActor final class CabinClimatePanelModelTests: XCTestCase {
    private func makeModel(
        _ update: CabinClimatePanelUpdate,
        telemetry: CabinClimatePanelTelemetry = OSLogCabinClimatePanelTelemetry()
    ) -> (CabinClimatePanelModel, InMemoryCabinClimatePanelSource) {
        let source = InMemoryCabinClimatePanelSource(initial: update)
        let model = CabinClimatePanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loadedUpdate(connection: CabinClimatePanelConnection = .live) -> CabinClimatePanelUpdate {
        CabinClimatePanelUpdate(
            status: .loaded,
            connection: connection,
            snapshot: CabinClimatePanelSnapshot(insideTempC: 21, isClimateOn: true)
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyCabinClimatePanelTelemetry()
        let (model, source) = makeModel(loadedUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.content.cabin.value, "21.0°C")
        XCTAssertEqual(spy.surfaces, [ClimatePanelSurface.slug])
        XCTAssertEqual(spy.surfaces, ["ClimatePanel"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CabinClimatePanelUpdate(status: .loading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEmptyResolvesToEmptyPhase() {
        let (model, _) = makeModel(CabinClimatePanelUpdate(status: .empty, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.showsFreshness)
    }

    func testShowsFreshnessOnlyWhenContentAndNotLive() {
        let (model, source) = makeModel(loadedUpdate())
        model.start()
        XCTAssertFalse(model.showsFreshness)
        source.push(loadedUpdate(connection: .stale))
        XCTAssertTrue(model.showsFreshness)
        XCTAssertEqual(model.connection, .stale)
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let (model, source) = makeModel(loadedUpdate())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(connection: .stale))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(connection: .live))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(loadedUpdate())
        model.start()
        source.push(loadedUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopResetsStartedSoTelemetryCanReemit() {
        let spy = SpyCabinClimatePanelTelemetry()
        let (model, _) = makeModel(loadedUpdate(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ClimatePanel", "ClimatePanel"])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCabinClimatePanelTelemetry: CabinClimatePanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
