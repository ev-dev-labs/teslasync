//
//  ActiveVehicleSegment.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the SI distance conversion
//  (web `convertDistanceFromSI`), the web name fallback chain (`display_name || vin || `Vehicle ${id}``), the
//  active-vehicle label (web `… || (vehicleId != null ? `Vehicle ${id}` : 'No vehicle')`), the model
//  sublabel, the metrics line (`${battery ?? 0}% · ${round(convertDistanceFromSI(range ?? 0, unit))}
//  ${unit}`), the tooltip composition, the switcher option mapping (incl. the >1 gate + selection flag), the
//  full projection, and the value-type equality. Split from ActiveVehicleSegment.Tests.swift (the SwiftUI /
//  state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ActiveVehicleSegmentAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ActiveVehicleSegmentSurface.slug, "ActiveVehicleSegment")
    }
}

// MARK: - SI conversion (web `convertDistanceFromSI`)

final class ActiveVehicleSegmentConversionTests: XCTestCase {
    func testConvertsMetersToKilometers() {
        XCTAssertEqual(ActiveVehicleSegmentProjector.convertDistanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
    }

    func testConvertsMetersToMiles() {
        XCTAssertEqual(ActiveVehicleSegmentProjector.convertDistanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
    }

    func testConvertsMetersToFeet() {
        XCTAssertEqual(ActiveVehicleSegmentProjector.convertDistanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
    }

    func testUnknownUnitDefaultsToKilometers() {
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.convertDistanceFromSI(2000, to: "parsecs"),
            2,
            accuracy: 1e-9,
            "a stray unit defaults to the SI-adjacent km base rather than crashing"
        )
    }
}

// MARK: - Name fallback (web `display_name || vin || `Vehicle ${id}``)

final class ActiveVehicleSegmentNameTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    func testPrefersDisplayName() {
        let name = ActiveVehicleSegmentProjector.name(
            displayName: "Lightning",
            vin: "VIN",
            id: 7,
            fallbackName: fallback
        )
        XCTAssertEqual(name, "Lightning")
    }

    func testFallsToVinWhenNameMissingOrEmpty() {
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.name(displayName: nil, vin: "5YJVIN", id: 7, fallbackName: fallback),
            "5YJVIN"
        )
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.name(displayName: "", vin: "5YJVIN", id: 7, fallbackName: fallback),
            "5YJVIN",
            "an empty display name is falsy (web `||`) and falls through to the VIN"
        )
    }

    func testFallsToFallbackNameWhenNoNameAndNoVin() {
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.name(displayName: nil, vin: nil, id: 42, fallbackName: fallback),
            "Vehicle 42"
        )
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.name(displayName: "", vin: "", id: 42, fallbackName: fallback),
            "Vehicle 42"
        )
    }
}

// MARK: - Active-vehicle label (web `… || (vehicleId != null ? `Vehicle ${id}` : 'No vehicle')`)

final class ActiveVehicleSegmentLabelTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }
    private let none: () -> String = { "No vehicle" }

    func testLabelUsesSelectedVehicleName() {
        let vehicle = ActiveVehicleSegmentVehicle(id: 5, displayName: "Garage", vin: "V")
        let label = ActiveVehicleSegmentProjector.label(
            vehicle: vehicle,
            selectedId: 5,
            fallbackName: fallback,
            noneLabel: none
        )
        XCTAssertEqual(label, "Garage")
    }

    func testLabelFallsToVehicleIdWhenNoMatchingRow() {
        let label = ActiveVehicleSegmentProjector.label(
            vehicle: nil,
            selectedId: 9,
            fallbackName: fallback,
            noneLabel: none
        )
        XCTAssertEqual(label, "Vehicle 9", "web: vehicle row missing but id set → `Vehicle ${id}`")
    }

    func testLabelFallsToNoneWhenNothingSelected() {
        let label = ActiveVehicleSegmentProjector.label(
            vehicle: nil,
            selectedId: nil,
            fallbackName: fallback,
            noneLabel: none
        )
        XCTAssertEqual(label, "No vehicle")
    }

    func testSubLabelReadsModelOrEmpty() {
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.subLabel(vehicle: ActiveVehicleSegmentVehicle(id: 1, model: "Model 3")),
            "Model 3"
        )
        XCTAssertEqual(ActiveVehicleSegmentProjector.subLabel(vehicle: ActiveVehicleSegmentVehicle(id: 1)), "")
        XCTAssertEqual(ActiveVehicleSegmentProjector.subLabel(vehicle: nil), "")
    }
}

// MARK: - Metrics line (web `${battery ?? 0}% · ${round(convert(range ?? 0))} ${unit}`)

final class ActiveVehicleSegmentMetricsTests: XCTestCase {
    func testAbsentLiveStateYieldsNil() {
        XCTAssertNil(ActiveVehicleSegmentProjector.metricsLabel(metrics: .absent, distanceUnit: "mi"))
    }

    func testPresentMetricsFormatBatteryAndRoundedRangeInMiles() {
        // 418_400 m / 1609.344 = 260.0 mi
        let metrics = ActiveVehicleSegmentMetrics(present: true, batteryLevel: 72, ratedRangeMeters: 418_400)
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.metricsLabel(metrics: metrics, distanceUnit: "mi"),
            "72% · 260 mi"
        )
    }

    func testPresentMetricsFormatInKilometers() {
        let metrics = ActiveVehicleSegmentMetrics(present: true, batteryLevel: 80, ratedRangeMeters: 480_000)
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.metricsLabel(metrics: metrics, distanceUnit: "km"),
            "80% · 480 km"
        )
    }

    func testNilBatteryAndRangeRenderAsZero() {
        let metrics = ActiveVehicleSegmentMetrics(present: true, batteryLevel: nil, ratedRangeMeters: nil)
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.metricsLabel(metrics: metrics, distanceUnit: "mi"),
            "0% · 0 mi",
            "web `?? 0` on both fields"
        )
    }

    func testRangeRoundsHalfAwayFromZeroLikeJsMathRound() {
        // 805 m → 0.5003 mi → rounds to 1; pick a value that rounds up at .5.
        let metrics = ActiveVehicleSegmentMetrics(present: true, batteryLevel: 50, ratedRangeMeters: 804.672)
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.metricsLabel(metrics: metrics, distanceUnit: "mi"),
            "50% · 1 mi",
            "804.672 m == 0.5 mi → Math.round → 1"
        )
    }
}

// MARK: - Tooltip composition (web `prefix · label [· sub] [· metrics]`)

final class ActiveVehicleSegmentTooltipTests: XCTestCase {
    func testTooltipWithLabelOnly() {
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.tooltip(
                activeVehicleText: "Active vehicle",
                label: "Lightning",
                subLabel: "",
                metricsLabel: nil
            ),
            "Active vehicle · Lightning"
        )
    }

    func testTooltipWithSubAndMetrics() {
        XCTAssertEqual(
            ActiveVehicleSegmentProjector.tooltip(
                activeVehicleText: "Active vehicle",
                label: "Lightning",
                subLabel: "Model 3",
                metricsLabel: "72% · 260 mi"
            ),
            "Active vehicle · Lightning · Model 3 · 72% · 260 mi"
        )
    }
}

// MARK: - Options (web `vehicles.map` — gated by `vehicles.length > 1`)

final class ActiveVehicleSegmentOptionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    private func fleet(_ count: Int) -> [ActiveVehicleSegmentVehicle] {
        (1 ... count).map { ActiveVehicleSegmentVehicle(id: $0, displayName: "Car \($0)") }
    }

    func testOptionsEmptyForZeroOrOneVehicle() {
        let emptyOptions = ActiveVehicleSegmentProjector.options(
            vehicles: [],
            selectedId: nil,
            fallbackName: fallback
        )
        XCTAssertTrue(emptyOptions.isEmpty)
        XCTAssertTrue(
            ActiveVehicleSegmentProjector.options(vehicles: fleet(1), selectedId: 1, fallbackName: fallback).isEmpty,
            "web only renders the popover when vehicles.length > 1"
        )
    }

    func testOptionsMapAndPreserveOrderWithSelection() {
        let options = ActiveVehicleSegmentProjector.options(
            vehicles: fleet(3),
            selectedId: 2,
            fallbackName: fallback
        )
        XCTAssertEqual(options.map(\.id), [1, 2, 3])
        XCTAssertEqual(options.map(\.name), ["Car 1", "Car 2", "Car 3"])
        XCTAssertEqual(options.map(\.isSelected), [false, true, false])
    }

    func testOptionCarriesModelWhenPresent() {
        let option = ActiveVehicleSegmentProjector.option(
            for: ActiveVehicleSegmentVehicle(id: 7, displayName: nil, vin: "VIN7", model: "Model Y"),
            selectedId: 7,
            fallbackName: fallback
        )
        XCTAssertEqual(option.name, "VIN7")
        XCTAssertEqual(option.model, "Model Y")
        XCTAssertTrue(option.isSelected)
    }
}

// MARK: - Projection (full render-ready output)

final class ActiveVehicleSegmentProjectionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }
    private let none: () -> String = { "No vehicle" }
    private var copy: ActiveVehicleSegmentCopy {
        ActiveVehicleSegmentCopy(fallbackName: fallback, noneLabel: none, activeVehicleText: "Active vehicle")
    }

    func testProjectionForSwitchableFleetWithMetrics() {
        let projection = ActiveVehicleSegmentProjector.projection(
            vehicles: [
                ActiveVehicleSegmentVehicle(id: 1, displayName: "Lightning", model: "Model 3"),
                ActiveVehicleSegmentVehicle(id: 2, displayName: "Loaner")
            ],
            selectedId: 1,
            metrics: ActiveVehicleSegmentMetrics(present: true, batteryLevel: 72, ratedRangeMeters: 418_400),
            distanceUnit: "mi",
            copy: copy
        )
        XCTAssertEqual(projection.label, "Lightning")
        XCTAssertEqual(projection.subLabel, "Model 3")
        XCTAssertEqual(projection.metricsLabel, "72% · 260 mi")
        XCTAssertEqual(projection.tooltip, "Active vehicle · Lightning · Model 3 · 72% · 260 mi")
        XCTAssertTrue(projection.isSwitchable)
        XCTAssertEqual(projection.options.count, 2)
    }

    func testProjectionForSingleVehicleIsNotSwitchable() {
        let projection = ActiveVehicleSegmentProjector.projection(
            vehicles: [ActiveVehicleSegmentVehicle(id: 9, displayName: nil, vin: "VIN9")],
            selectedId: 9,
            metrics: .absent,
            distanceUnit: "mi",
            copy: copy
        )
        XCTAssertEqual(projection.label, "VIN9")
        XCTAssertNil(projection.metricsLabel)
        XCTAssertFalse(projection.isSwitchable)
        XCTAssertTrue(projection.options.isEmpty)
        XCTAssertEqual(projection.tooltip, "Active vehicle · VIN9")
    }
}

// MARK: - Value-type equality

final class ActiveVehicleSegmentValueTypeTests: XCTestCase {
    func testVehicleEquality() {
        let lhs = ActiveVehicleSegmentVehicle(id: 1, displayName: "A", vin: "V", model: "M")
        XCTAssertEqual(lhs, ActiveVehicleSegmentVehicle(id: 1, displayName: "A", vin: "V", model: "M"))
        XCTAssertNotEqual(lhs, ActiveVehicleSegmentVehicle(id: 1, displayName: "A", vin: "V", model: "X"))
    }

    func testOptionIdentityAndEquality() {
        let option = ActiveVehicleSegmentOption(id: 9, name: "Nine", model: nil, isSelected: true)
        XCTAssertEqual(option.id, 9)
        XCTAssertEqual(option, ActiveVehicleSegmentOption(id: 9, name: "Nine", model: nil, isSelected: true))
    }

    func testMetricsAbsentConstant() {
        XCTAssertFalse(ActiveVehicleSegmentMetrics.absent.present)
        XCTAssertNil(ActiveVehicleSegmentMetrics.absent.batteryLevel)
    }

    func testConnectionCases() {
        XCTAssertEqual(ActiveVehicleSegmentConnection.allCases, [.live, .stale, .offline])
    }
}
