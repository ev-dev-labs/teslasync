//
//  SpeedGearPanel.ModelTests.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  State-holder + view coverage for the driving-dynamics SpeedGearPanel surface (split from
//  SpeedGearPanel.Tests.swift to keep each file within the SwiftLint file-length budget):
//    • State holder — `SpeedGearPanelModel.resolvePhase` across loading / empty / loaded / failed,
//      the `hasData` rule, the model wiring, the P1/S11 `view.opened` telemetry, and the stale
//      auto-refresh transition.
//    • View — an `ImageRenderer` render smoke for every state (content / partial / empty / loading /
//      error / stale / offline).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemorySpeedGearSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private func sampleReading() -> SpeedGearMotorReading {
    SpeedGearMotorReading(shiftState: "D", powerKW: 142.6)
}

/// Two drives: avg = (10 + 20) / 2 = 15 m/s, top = 35 m/s (km/h → 54 / 126).
private func sampleDrives() -> [SpeedGearDriveSample] {
    [
        SpeedGearDriveSample(avgSpeedMps: 10, maxSpeedMps: 25),
        SpeedGearDriveSample(avgSpeedMps: 20, maxSpeedMps: 35)
    ]
}

// MARK: - State holder: phase, wiring, telemetry, freshness

@MainActor
final class SpeedGearPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: SpeedGearUpdate,
        telemetry: SpeedGearTelemetry = OSLogSpeedGearTelemetry()
    ) -> (SpeedGearPanelModel, InMemorySpeedGearSource) {
        let source = InMemorySpeedGearSource(initial: update)
        let model = SpeedGearPanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataUpdate: SpeedGearUpdate {
        SpeedGearUpdate(status: .loaded, reading: sampleReading(), drives: sampleDrives())
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(SpeedGearPanelModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }

    func testHasDataIsReadingOrDrives() {
        XCTAssertFalse(SpeedGearUpdate(status: .loaded).hasData)
        XCTAssertTrue(SpeedGearUpdate(status: .loaded, reading: sampleReading()).hasData)
        XCTAssertTrue(SpeedGearUpdate(status: .loaded, drives: sampleDrives()).hasData)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySpeedGearTelemetry()
        let (model, source) = makeModel(dataUpdate, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.metrics.count, 3)
        XCTAssertEqual(spy.surfaces, [SpeedGearPanelSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoading() {
        let (model, _) = makeModel(SpeedGearUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SpeedGearUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataUpdate)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.metrics.count, 3)
        XCTAssertEqual(model.projection?.shift.letter, "D")
    }

    func testEmptyPushProjectsEmpty() {
        let (model, source) = makeModel(SpeedGearUpdate(status: .loading))
        model.start()
        source.push(SpeedGearUpdate(status: .empty))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithoutDataProjectsEmpty() {
        let (model, source) = makeModel(SpeedGearUpdate(status: .loading))
        model.start()
        source.push(SpeedGearUpdate(status: .loaded))
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithCachedDataStaysContent() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(SpeedGearUpdate(status: .failed("boom"), reading: sampleReading(), drives: sampleDrives()))
        XCTAssertEqual(model.phase, .content)
    }

    func testFailedWithoutCachedDataProjectsError() {
        let (model, source) = makeModel(SpeedGearUpdate(status: .loading))
        model.start()
        source.push(SpeedGearUpdate(status: .failed("offline")))
        XCTAssertEqual(model.phase, .error("offline"))
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SpeedGearUpdate(
            status: .loaded,
            connection: .stale,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SpeedGearUpdate(
            status: .loaded,
            connection: .stale,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveThenStaleReArmsAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(SpeedGearUpdate(
            status: .loaded,
            connection: .stale,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SpeedGearUpdate(
            status: .loaded,
            connection: .live,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
        XCTAssertEqual(model.connection, .live)
        source.push(SpeedGearUpdate(
            status: .loaded,
            connection: .stale,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedDataWithoutAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(SpeedGearUpdate(
            status: .loaded,
            connection: .offline,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshAndStopReArm() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SpeedGearPanel.surfaceSlug, "SpeedGearPanel")
    }
}

// MARK: - View render smoke (every state builds + renders)

@MainActor
final class SpeedGearPanelViewStateTests: XCTestCase {
    private func renderSmoke(_ update: SpeedGearUpdate, file: StaticString = #filePath, line: UInt = #line) {
        let source = InMemorySpeedGearSource(initial: update)
        let model = SpeedGearPanelModel(source: source)
        model.start()
        let renderer = ImageRenderer(content: SpeedGearPanel(model: model).frame(width: 360, height: 280))
        XCTAssertNotNil(renderer.cgImage, file: file, line: line)
    }

    func testContentRenders() {
        renderSmoke(SpeedGearUpdate(status: .loaded, reading: sampleReading(), drives: sampleDrives()))
    }

    func testPartialRenders() {
        renderSmoke(SpeedGearUpdate(
            status: .loaded,
            reading: SpeedGearMotorReading(shiftState: "P", powerKW: nil),
            drives: [SpeedGearDriveSample(avgSpeedMps: nil, maxSpeedMps: 16)]
        ))
    }

    func testEmptyRenders() {
        renderSmoke(SpeedGearUpdate(status: .empty))
    }

    func testLoadingRenders() {
        renderSmoke(SpeedGearUpdate(status: .loading))
    }

    func testErrorRenders() {
        renderSmoke(SpeedGearUpdate(status: .failed("Network request timed out")))
    }

    func testStaleRenders() {
        renderSmoke(SpeedGearUpdate(
            status: .loaded,
            connection: .stale,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
    }

    func testOfflineRenders() {
        renderSmoke(SpeedGearUpdate(
            status: .loaded,
            connection: .offline,
            reading: sampleReading(),
            drives: sampleDrives()
        ))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySpeedGearTelemetry: SpeedGearTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
