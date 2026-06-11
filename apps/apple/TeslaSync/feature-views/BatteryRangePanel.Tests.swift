//
//  BatteryRangePanel.Tests.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  State-holder coverage for the BatteryRangePanel surface: `BatteryRangePanelModel.resolvePhase`
//  across loading / empty / loaded / failed, plus the model wiring, the P1/S11 `view.opened`
//  telemetry, the freshness flag, and the stale one-shot auto-refresh. The projection + distance
//  math are covered in BatteryRangePanel.ProjectionTests.swift.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryBatteryRangePanelSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Phase resolution

@MainActor final class BatteryRangePanelPhaseTests: XCTestCase {
    private let snapshot = BatteryRangePanelSnapshot(batteryLevel: 72)

    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .loading)), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        XCTAssertEqual(
            BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .loading, snapshot: snapshot)),
            .content
        )
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .empty)), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .loaded)), .empty)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(
            BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .loaded, snapshot: snapshot)),
            .content
        )
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(
            BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testFailedWithCachedDataStaysContent() {
        XCTAssertEqual(
            BatteryRangePanelModel.resolvePhase(BatteryRangePanelUpdate(status: .failed("boom"), snapshot: snapshot)),
            .content
        )
    }
}

// MARK: - State holder: wiring + telemetry + freshness + stale auto-refresh

@MainActor final class BatteryRangePanelModelTests: XCTestCase {
    private func makeModel(
        _ update: BatteryRangePanelUpdate,
        telemetry: BatteryRangePanelTelemetry = OSLogBatteryRangePanelTelemetry()
    ) -> (BatteryRangePanelModel, InMemoryBatteryRangePanelSource) {
        let source = InMemoryBatteryRangePanelSource(initial: update)
        let model = BatteryRangePanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loadedUpdate(connection: BatteryRangePanelConnection = .live) -> BatteryRangePanelUpdate {
        BatteryRangePanelUpdate(
            status: .loaded,
            connection: connection,
            snapshot: BatteryRangePanelSnapshot(batteryLevel: 82, isCharging: true)
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyBatteryRangePanelTelemetry()
        let (model, source) = makeModel(loadedUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.content.gauge.valueText, "82")
        XCTAssertEqual(spy.surfaces, [BatteryRangePanelSurface.slug])
        XCTAssertEqual(spy.surfaces, ["BatteryRangePanel"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BatteryRangePanelUpdate(status: .loading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEmptyResolvesToEmptyPhase() {
        let (model, _) = makeModel(BatteryRangePanelUpdate(status: .empty, snapshot: nil))
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
        let spy = SpyBatteryRangePanelTelemetry()
        let (model, _) = makeModel(loadedUpdate(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["BatteryRangePanel", "BatteryRangePanel"])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBatteryRangePanelTelemetry: BatteryRangePanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
