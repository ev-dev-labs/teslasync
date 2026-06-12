//
//  VehicleTwin.Tests.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  Unit coverage for the VehicleTwin surface: the projection phase selection (loading / empty / error
//  / content across the vehicle-in-scope rule, the cached-vehicle "stay rendered behind refresh /
//  errors" behavior), the state holder (wiring, the once-only `view.opened` telemetry, the stale
//  one-shot auto-refresh, and the refresh / setPaint / reset / stop delegation), and the resolved
//  content's accessibility. No network, no real store: the model is driven by
//  `InMemoryVehicleTwinSource` with an injected locale + a recording telemetry spy.
//

import Foundation
import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let scopeVehicle = 7

// MARK: - Telemetry spy

private final class RecordingVehicleTwinTelemetry: VehicleTwinTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

// MARK: - Projection: phases

final class VehicleTwinProjectionPhaseTests: XCTestCase {
    func testLoadingWithNoVehicleIsLoading() {
        let resolved = VehicleTwinProjection.resolve(VehicleTwinInput(loadStatus: .loading), locale: enUS)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.content)
    }

    func testLoadingWithCachedVehicleStaysContent() {
        let resolved = VehicleTwinProjection.resolve(
            VehicleTwinInput(loadStatus: .loading, vehicleID: scopeVehicle),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertNotNil(resolved.content)
    }

    func testEmptyStatusIsEmpty() {
        let resolved = VehicleTwinProjection.resolve(VehicleTwinInput(loadStatus: .empty), locale: enUS)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.content)
    }

    func testLoadedWithNoVehicleIsEmpty() {
        let resolved = VehicleTwinProjection.resolve(VehicleTwinInput(loadStatus: .loaded), locale: enUS)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLoadedWithVehicleIsContent() {
        let resolved = VehicleTwinProjection.resolve(
            VehicleTwinInput(loadStatus: .loaded, vehicleID: scopeVehicle),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertNotNil(resolved.content)
    }

    func testFailedWithNoVehicleIsError() {
        let resolved = VehicleTwinProjection.resolve(
            VehicleTwinInput(loadStatus: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testFailedWithCachedVehicleStaysContent() {
        let resolved = VehicleTwinProjection.resolve(
            VehicleTwinInput(loadStatus: .failed("boom"), vehicleID: scopeVehicle),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertNotNil(resolved.content)
    }
}

// MARK: - Projection: content

final class VehicleTwinProjectionContentTests: XCTestCase {
    private func content(
        state: VehicleTwinState = .empty,
        exterior: String? = nil,
        override: VehicleTwinPaintID? = nil,
        updatedAt: Date? = nil
    ) -> VehicleTwinContent {
        let resolved = VehicleTwinProjection.resolve(
            VehicleTwinInput(
                loadStatus: .loaded,
                state: state,
                vehicleID: scopeVehicle,
                exteriorColor: exterior,
                paintOverride: override,
                updatedAt: updatedAt
            ),
            locale: enUS
        )
        return resolved.content!
    }

    func testFigureAccessibilityLabelMatchesWebAria() {
        XCTAssertEqual(
            content().figureAccessibilityLabel,
            "Vehicle digital twin showing current physical state"
        )
    }

    func testLegendIsAlwaysComplete() {
        XCTAssertEqual(content().legend.count, VehicleTwinLegendItem.Kind.allCases.count)
    }

    func testPaintResolvesFromExteriorColor() {
        XCTAssertEqual(content(exterior: "RedMulticoat").paint.id, .redMulticoat)
    }

    func testPaintOverrideWins() {
        XCTAssertEqual(content(exterior: "PearlWhite", override: .solidBlack).paint.id, .solidBlack)
    }

    func testPaintAccessibilityLabelNamesThePaint() {
        XCTAssertEqual(content(exterior: "DeepBlue").paintAccessibilityLabel, "Finished in Deep Blue Metallic")
    }

    func testUpdatedTextUnknownWhenNoTimestamp() {
        XCTAssertEqual(content(updatedAt: nil).updatedText, "Awaiting telemetry")
    }

    func testUpdatedTextPrefixedWhenTimestampPresent() {
        XCTAssertTrue(content(updatedAt: Date(timeIntervalSinceNow: -120)).updatedText.hasPrefix("Updated "))
    }
}

// MARK: - Model: wiring + delegation

@MainActor
final class VehicleTwinModelWiringTests: XCTestCase {
    func testStartSubscribesAndAppliesInitial() {
        let source = InMemoryVehicleTwinSource(
            initial: VehicleTwinInput(loadStatus: .loaded, vehicleID: scopeVehicle)
        )
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .content)
    }

    func testPushUpdatesPhaseAndConnection() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.start()
        source.push(VehicleTwinInput(loadStatus: .loaded, connection: .stale, vehicleID: scopeVehicle))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertNotNil(model.content)
    }

    func testRefreshDelegates() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testSetPaintDelegatesWithID() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.setPaint(.deepBlue)
        XCTAssertEqual(source.setPaintCount, 1)
        XCTAssertEqual(source.lastSetPaint, .some(.some(.deepBlue)))
    }

    func testResetPaintDelegates() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.resetPaint()
        XCTAssertEqual(source.resetPaintCount, 1)
    }

    func testStopDelegates() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Model: telemetry

@MainActor
final class VehicleTwinTelemetryTests: XCTestCase {
    func testViewOpenedEmittedOnceWithSlug() {
        let telemetry = RecordingVehicleTwinTelemetry()
        let model = VehicleTwinSurfaceModel(source: InMemoryVehicleTwinSource(), telemetry: telemetry, locale: enUS)
        model.start()
        XCTAssertEqual(telemetry.opened, [VehicleTwin.surfaceSlug])
    }

    func testViewOpenedNotRepeatedAcrossRestart() {
        let telemetry = RecordingVehicleTwinTelemetry()
        let model = VehicleTwinSurfaceModel(source: InMemoryVehicleTwinSource(), telemetry: telemetry, locale: enUS)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.opened.count, 1)
    }
}

// MARK: - Model: stale one-shot auto-refresh

@MainActor
final class VehicleTwinAutoRefreshTests: XCTestCase {
    func testStaleTriggersOneRefresh() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.start()
        source.push(VehicleTwinInput(connection: .stale, vehicleID: scopeVehicle))
        source.push(VehicleTwinInput(connection: .stale, vehicleID: scopeVehicle))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveResetsStaleSoNextStaleRefreshesAgain() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.start()
        source.push(VehicleTwinInput(connection: .stale, vehicleID: scopeVehicle))
        source.push(VehicleTwinInput(connection: .live, vehicleID: scopeVehicle))
        source.push(VehicleTwinInput(connection: .stale, vehicleID: scopeVehicle))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let source = InMemoryVehicleTwinSource()
        let model = VehicleTwinSurfaceModel(source: source, locale: enUS)
        model.start()
        source.push(VehicleTwinInput(connection: .offline, vehicleID: scopeVehicle))
        XCTAssertEqual(source.refreshCount, 0)
    }
}
