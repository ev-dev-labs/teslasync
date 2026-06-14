//
//  TelemetryGrid.ModelTests.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  State-holder model + accessibility + per-state view-render coverage for the telemetry
//  grid (the adapter / projection tests live in TelemetryGrid.Tests.swift). Pure-logic tests
//  use `InMemoryTelemetryGridSource`; the view tests render via `ImageRenderer` so every
//  state materializes its chrome (and its accessibility modifiers).
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder model

@MainActor final class TelemetryGridModelTests: XCTestCase {
    private func makeModel(
        _ initial: TelemetryGridUpdate?,
        telemetry: TelemetryGridTelemetry = OSLogTelemetryGridTelemetry()
    ) -> (TelemetryGridModel, InMemoryTelemetryGridSource) {
        let source = InMemoryTelemetryGridSource(initial: initial)
        let model = TelemetryGridModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func withVehicle(
        status: TGLoadStatus = .loaded,
        connection: TelemetryGridConnection = .live,
        isFetching: Bool = false,
        updatedAt: Date? = nil
    ) -> TelemetryGridUpdate {
        TelemetryGridUpdate(
            vehicle: TGVehicleSnapshot(batteryLevel: 64),
            status: status,
            connection: connection,
            isFetching: isFetching,
            updatedAt: updatedAt
        )
    }

    func testPhaseLoadingUntilFirstSnapshot() {
        let (model, _) = makeModel(nil)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPhaseDataAfterSnapshot() {
        let (model, _) = makeModel(withVehicle())
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.projection?.tiles.count, 6)
        XCTAssertTrue(model.projection?.hasData ?? false)
    }

    func testPhaseEmptyWhenResolvedWithNoVehicle() {
        let (model, _) = makeModel(TelemetryGridUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testPhaseErrorWhenFailedWithNoVehicle() {
        let (model, _) = makeModel(TelemetryGridUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error)
    }

    func testPhaseDataWhenFailedButHasVehicle() {
        let (model, _) = makeModel(withVehicle(status: .failed("partial")))
        model.start()
        XCTAssertEqual(model.phase, .data)
    }

    func testComputePhaseStaticMatrix() {
        XCTAssertEqual(TelemetryGridModel.computePhase(TelemetryGridUpdate(status: .loading)), .loading)
        XCTAssertEqual(TelemetryGridModel.computePhase(TelemetryGridUpdate(status: .loaded)), .empty)
        XCTAssertEqual(TelemetryGridModel.computePhase(TelemetryGridUpdate(status: .failed("x"))), .error)
        XCTAssertEqual(TelemetryGridModel.computePhase(withVehicle()), .data)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(withVehicle())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(withVehicle(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(withVehicle(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(withVehicle(connection: .live))
        source.push(withVehicle(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessDerivations() {
        let (stale, _) = makeModel(withVehicle(connection: .stale, updatedAt: Date()))
        stale.start()
        XCTAssertTrue(stale.isStale)
        XCTAssertFalse(stale.isOffline)
        XCTAssertTrue(stale.showsFreshnessChip)

        let (offline, _) = makeModel(withVehicle(connection: .offline))
        offline.start()
        XCTAssertTrue(offline.isOffline)
        XCTAssertTrue(offline.showsFreshnessChip)

        let (live, _) = makeModel(withVehicle(connection: .live))
        live.start()
        XCTAssertFalse(live.showsFreshnessChip)
    }

    func testFetchingShowsFreshnessChipEvenWhenLive() {
        let (model, _) = makeModel(withVehicle(connection: .live, isFetching: true))
        model.start()
        XCTAssertTrue(model.showsFreshnessChip)
    }

    func testAgeLabelReflectsSnapshotTimestamp() {
        let (model, _) = makeModel(withVehicle(connection: .stale, updatedAt: Date().addingTimeInterval(-120)))
        model.start()
        XCTAssertEqual(model.ageLabel, "2m ago")
    }

    func testRefreshAndStopForwardToSource() {
        let (model, source) = makeModel(withVehicle())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTelemetryGridTelemetry()
        let (model, source) = makeModel(withVehicle(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TelemetryGridSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility (the spoken phrase bound to each tile's a11y label)

@MainActor final class TelemetryGridAccessibilityTests: XCTestCase {
    func testEveryTileExposesACombinedSpokenLabel() {
        let update = TelemetryGridUpdate(
            vehicle: TGVehicleSnapshot(
                batteryLevel: 64,
                ratedRangeMeters: 412_000,
                speedMetersPerSecond: 0,
                insideTempC: 21.5,
                outsideTempC: 12,
                odometerMeters: 53_201_000,
                isCharging: false,
                sentryMode: true
            )
        )
        let projection = TelemetryGridProjector.project(update: update)
        let spoken = projection.tiles.map(\.spoken)
        XCTAssertEqual(spoken[0], "Battery, 64%, 412.0 km range")
        XCTAssertEqual(spoken[1], "Speed, 0 km/h, Parked")
        XCTAssertEqual(spoken[2], "Inside, 21.5°C, Outside: 12.0°C")
        XCTAssertEqual(spoken[3], "Odometer, 53,201 km")
        XCTAssertEqual(spoken[4], "Charger, Not charging")
        XCTAssertEqual(spoken[5], "Sentry, Active")
        XCTAssertFalse(spoken.contains { $0.contains("nil") || $0.isEmpty })
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class TelemetryGridViewStateTests: XCTestCase {
        private func loaded(connection: TelemetryGridConnection = .live) -> TelemetryGridUpdate {
            TelemetryGridUpdate(
                vehicle: TGVehicleSnapshot(
                    batteryLevel: 64,
                    ratedRangeMeters: 412_000,
                    speedMetersPerSecond: 29,
                    insideTempC: 21.5,
                    outsideTempC: 12,
                    odometerMeters: 53_201_000,
                    isCharging: true,
                    chargerPowerKw: 11,
                    timeToFullChargeHours: 1.5,
                    sentryMode: true
                ),
                status: .loaded,
                connection: connection,
                units: .imperial,
                updatedAt: Date()
            )
        }

        private func renders(_ update: TelemetryGridUpdate?) -> Bool {
            let source = InMemoryTelemetryGridSource(initial: update)
            let model = TelemetryGridModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: TelemetryGrid(model: model).frame(width: 600, height: 400))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        func testDataRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(nil))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(TelemetryGridUpdate(status: .loaded)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(TelemetryGridUpdate(status: .failed("net"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(loaded(connection: .stale)))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(loaded(connection: .offline)))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTelemetryGridTelemetry: TelemetryGridTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
