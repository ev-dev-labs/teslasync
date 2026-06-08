//
//  OdometerCounterWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0070 · OdometerCounterWidget (Apple)
//
//  Unit coverage for the OdometerCounterWidget surface:
//    • Adapter (cached → projection) — distance conversion (port parity with
//      lib/unitConversion.convertDistanceFromSI) + locale number formatting.
//    • Layout — the web isCompact / isWide resolution.
//    • State holder — `OdometerCounterModel` phase resolution across loading /
//      empty / error / content, plus P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `odometer-counter` metadata + size clamping.
//    • Accessibility — the VoiceOver label content for the readout + empty state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryOdometerSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with convertDistanceFromSI)

@MainActor
final class OdometerProjectionTests: XCTestCase {
    func testKilometerConversionAndFormatting() {
        let input = OdometerInput(odometerMeters: 28_452_000, totalDistanceMeters: 19_804_000, distanceUnit: "km")
        let projection = OdometerProjectionBuilder.build(from: input, localeIdentifier: "en_US")

        XCTAssertEqual(projection.odometer ?? .nan, 28452, accuracy: 0.0001)
        XCTAssertEqual(projection.totalDriven ?? .nan, 19804, accuracy: 0.0001)
        XCTAssertTrue(projection.hasOdometer)
        XCTAssertEqual(projection.odometerText, "28,452")
        XCTAssertEqual(projection.odometerWithUnit, "28,452 km")
        XCTAssertEqual(projection.totalDrivenText, "19,804 km")
    }

    func testMileConversionRoundsForDisplay() {
        let input = OdometerInput(odometerMeters: 28_452_000, distanceUnit: "mi")
        let projection = OdometerProjectionBuilder.build(from: input, localeIdentifier: "en_US")

        XCTAssertEqual(projection.odometer ?? 0, 17679.25, accuracy: 0.01)
        XCTAssertEqual(projection.odometerText, "17,679")
        XCTAssertEqual(projection.unit, "mi")
    }

    func testFootConversion() {
        let input = OdometerInput(odometerMeters: 100, distanceUnit: "ft")
        let projection = OdometerProjectionBuilder.build(from: input, localeIdentifier: "en_US")
        XCTAssertEqual(projection.odometer ?? 0, 328.0839, accuracy: 0.001)
    }

    func testMissingValuesProjectEmptyAndDash() {
        let projection = OdometerProjectionBuilder.build(
            from: OdometerInput(distanceUnit: "km"),
            localeIdentifier: "en_US"
        )
        XCTAssertNil(projection.odometer)
        XCTAssertNil(projection.totalDriven)
        XCTAssertFalse(projection.hasOdometer)
        XCTAssertEqual(projection.totalDrivenText, OdometerProjection.emptyDisplay)
        XCTAssertEqual(projection.odometerText, "0")
    }

    func testUnknownUnitFallsBackToKilometers() {
        XCTAssertEqual(OdometerDistance.fromSI(5000, to: "parsecs"), 5, accuracy: 0.0001)
        XCTAssertEqual(OdometerDistance.fromSI(1000, to: "km"), 1, accuracy: 0.0001)
        XCTAssertEqual(OdometerDistance.fromSI(1609.344, to: "mi"), 1, accuracy: 0.0001)
    }
}

// MARK: - Responsive layout (web isCompact / isWide)

@MainActor
final class OdometerLayoutTests: XCTestCase {
    func testLayoutResolution() {
        XCTAssertEqual(OdometerLayout.resolve(for: DashboardWidgetSize(cols: 1, rows: 1)), .compact)
        XCTAssertEqual(OdometerLayout.resolve(for: DashboardWidgetSize(cols: 1, rows: 2)), .expanded(wide: false))
        XCTAssertEqual(OdometerLayout.resolve(for: DashboardWidgetSize(cols: 2, rows: 4)), .expanded(wide: true))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class OdometerCounterModelTests: XCTestCase {
    private func makeModel(
        _ update: OdometerUpdate,
        telemetry: OdometerTelemetry = OSLogOdometerTelemetry()
    ) -> (OdometerCounterModel, InMemoryOdometerSource) {
        let source = InMemoryOdometerSource(initial: update)
        let model = OdometerCounterModel(source: source, telemetry: telemetry, localeIdentifier: "en_US")
        return (model, source)
    }

    private var reading: OdometerInput {
        OdometerInput(odometerMeters: 28_452_000, totalDistanceMeters: 19_804_000, distanceUnit: "km")
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(OdometerUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(OdometerUpdate(status: .loaded, input: OdometerInput(distanceUnit: "km")))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(OdometerUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testReadingPresentShowsContentEvenWhenFailed() {
        let (loaded, _) = makeModel(OdometerUpdate(status: .loaded, input: reading))
        loaded.start()
        XCTAssertEqual(loaded.phase, .content)
        XCTAssertEqual(loaded.projection.odometerText, "28,452")

        let (failed, _) = makeModel(OdometerUpdate(status: .failed("net"), input: reading))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyOdometerTelemetry()
        let (model, source) = makeModel(OdometerUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [OdometerCounterWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(OdometerUpdate(status: .loaded, input: reading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(OdometerUpdate(status: .loading))
        model.start()
        source.push(
            OdometerUpdate(
                status: .loaded,
                connection: .offline,
                input: OdometerInput(odometerMeters: 16_093_440, distanceUnit: "mi"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.odometerText, "10,000")
        XCTAssertEqual(model.projection.unit, "mi")
    }
}

// MARK: - Registry parity

@MainActor
final class OdometerRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = OdometerCounterWidget.registration
        XCTAssertEqual(registration.id, "odometer-counter")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
        XCTAssertEqual(OdometerCounterWidget.surfaceSlug, "OdometerCounterWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = OdometerCounterWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }
}

// MARK: - Accessibility label content

@MainActor
final class OdometerAccessibilityTests: XCTestCase {
    func testReadoutLabelIncludesTitleValueAndUnit() {
        let input = OdometerInput(odometerMeters: 28_452_000, distanceUnit: "km")
        let projection = OdometerProjectionBuilder.build(from: input, localeIdentifier: "en_US")
        let label = OdometerAccessibility.readoutLabel(for: projection)
        XCTAssertTrue(label.contains("Total Odometer"))
        XCTAssertTrue(label.contains("28,452"))
        XCTAssertTrue(label.contains("km"))
    }

    func testEmptyLabelIsLocalizedNoData() {
        XCTAssertEqual(OdometerAccessibility.emptyLabel(), "No odometer data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyOdometerTelemetry: OdometerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
