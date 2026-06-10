//
//  FleetSummary.ModelTests.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  State-holder model + accessibility + per-state view-render coverage for the Fleet
//  Summary (the adapter / format / convert / projector tests live in
//  FleetSummary.Tests.swift). Pure-logic tests use `InMemoryFleetSummarySource`; the view
//  tests render via `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder model

@MainActor final class FleetSummaryModelTests: XCTestCase {
    private func vehicles(_ count: Int) -> [FleetVehicle] {
        (0 ..< count).map { FleetVehicle(id: $0 + 1) }
    }

    private func update(
        vehicleCount: Int = 3,
        states: [FleetVehicleState?]? = nil,
        status: FleetLoadStatus = .loaded,
        connection: FleetSummaryConnection = .live,
        isFetching: Bool = false,
        updatedAt: Date? = nil
    ) -> FleetSummaryUpdate {
        FleetSummaryUpdate(
            vehicles: vehicles(vehicleCount),
            states: states ?? [FleetVehicleState(batteryLevel: 80, ratedRangeMeters: 300_000, isCharging: true)],
            status: status,
            connection: connection,
            isFetching: isFetching,
            updatedAt: updatedAt
        )
    }

    private func makeModel(
        _ initial: FleetSummaryUpdate?,
        telemetry: FleetSummaryTelemetry = OSLogFleetSummaryTelemetry()
    ) -> (FleetSummaryModel, InMemoryFleetSummarySource) {
        let source = InMemoryFleetSummarySource(initial: initial)
        let model = FleetSummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testPhaseLoadingUntilFirstSnapshot() {
        let (model, _) = makeModel(nil)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPhaseContentAfterSnapshot() {
        let (model, _) = makeModel(update())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.metrics.count, 4)
        XCTAssertEqual(model.projection?.vehicleCount, 3)
    }

    func testPhaseEmptyWhenNoVehicles() {
        let (model, _) = makeModel(update(vehicleCount: 0, states: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testPhaseErrorWhenFailedWithNoStates() {
        let (model, _) = makeModel(update(states: [], status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error)
    }

    func testPhaseContentWhenFailedButHasStates() {
        // A partial failure that still resolved some readings keeps showing them.
        let (model, _) = makeModel(
            update(states: [FleetVehicleState(batteryLevel: 50), nil], status: .failed("partial"))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testPhaseLoadingWhenLoadingWithNoStates() {
        let (model, _) = makeModel(update(states: [], status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testComputePhaseStaticMatrix() {
        XCTAssertEqual(FleetSummaryModel.computePhase(update(vehicleCount: 0, states: [])), .empty)
        XCTAssertEqual(FleetSummaryModel.computePhase(update(states: [], status: .loading)), .loading)
        XCTAssertEqual(FleetSummaryModel.computePhase(update(states: [], status: .failed("x"))), .error)
        XCTAssertEqual(FleetSummaryModel.computePhase(update(status: .loaded)), .content)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(update())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(update(connection: .live))
        source.push(update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessDerivations() {
        let (model, _) = makeModel(update(connection: .stale, updatedAt: Date()))
        model.start()
        XCTAssertTrue(model.isStale)
        XCTAssertFalse(model.isOffline)
        XCTAssertTrue(model.showsFreshnessChip)

        let (offlineModel, _) = makeModel(update(connection: .offline))
        offlineModel.start()
        XCTAssertTrue(offlineModel.isOffline)
        XCTAssertTrue(offlineModel.showsFreshnessChip)

        let (liveModel, _) = makeModel(update(connection: .live))
        liveModel.start()
        XCTAssertFalse(liveModel.showsFreshnessChip)
    }

    func testFetchingShowsFreshnessChipEvenWhenLive() {
        let (model, _) = makeModel(update(connection: .live, isFetching: true))
        model.start()
        XCTAssertTrue(model.showsFreshnessChip)
    }

    func testRefreshForwardsToSource() {
        let (model, source) = makeModel(update())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopForwardsToSource() {
        let (model, source) = makeModel(update())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyFleetTelemetry()
        let (model, source) = makeModel(update(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FleetSummarySurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility

@MainActor final class FleetSummaryAccessibilityTests: XCTestCase {
    func testTileSpokenPhrasesIncludeLabelAndValue() {
        let projection = FleetSummaryProjector.project(
            update: FleetSummaryUpdate(
                vehicles: [FleetVehicle(id: 1), FleetVehicle(id: 2)],
                states: [FleetVehicleState(batteryLevel: 82, ratedRangeMeters: 300_000, isCharging: true)],
                units: FleetUnitPrefs(distance: "km", localeIdentifier: "en_US")
            )
        )
        XCTAssertEqual(projection.metrics[0].spoken, "Vehicles 2")
        XCTAssertEqual(projection.metrics[1].spoken, "Avg Battery 82%")
        XCTAssertTrue(projection.metrics[2].spoken.hasPrefix("Total Range km"))
        XCTAssertEqual(projection.metrics[3].spoken, "Charging / Online 1 of 1")
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class FleetSummaryViewStateTests: XCTestCase {
        private func loaded(connection: FleetSummaryConnection = .live) -> FleetSummaryUpdate {
            FleetSummaryUpdate(
                vehicles: [FleetVehicle(id: 1), FleetVehicle(id: 2), FleetVehicle(id: 3)],
                states: [
                    FleetVehicleState(batteryLevel: 82, ratedRangeMeters: 386_243, isCharging: false),
                    FleetVehicleState(batteryLevel: 60, ratedRangeMeters: 300_000, isCharging: true),
                    nil
                ],
                status: .loaded,
                connection: connection,
                units: FleetUnitPrefs(distance: "mi", localeIdentifier: "en_US"),
                updatedAt: Date()
            )
        }

        private func renders(_ update: FleetSummaryUpdate?) -> Bool {
            let source = InMemoryFleetSummarySource(initial: update)
            let model = FleetSummaryModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: FleetSummary(model: model).frame(width: 420, height: 360))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        func testContentRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(nil))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(FleetSummaryUpdate(vehicles: [], status: .loaded)))
        }

        func testErrorRenders() {
            XCTAssertTrue(
                renders(FleetSummaryUpdate(vehicles: [FleetVehicle(id: 1)], states: [], status: .failed("net")))
            )
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
private final class SpyFleetTelemetry: FleetSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
