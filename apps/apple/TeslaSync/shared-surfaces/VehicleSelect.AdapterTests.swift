//
//  VehicleSelect.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the web option-label fallback
//  chain (`display_name || vin || `Vehicle ${id}``, with an empty string treated as falsy), the option
//  mapping (`{ value: String(v.id), label }`), the controlled value (`vehicleId != null ? String : ''`), the
//  `onChange` parser (`Number(value); isFinite && > 0 ? n : null` — blank / zero / negative / non-numeric /
//  overflow → nil), the full projection, and the value-type equality. Split from VehicleSelect.Tests.swift
//  (the SwiftUI / state-holder half) to keep each file within the SwiftLint file-length budget. These run in
//  the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class VehicleSelectAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(VehicleSelectSurface.slug, "VehicleSelect")
    }
}

// MARK: - Label fallback (web `display_name || vin || `Vehicle ${id}``)

final class VehicleSelectLabelTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    func testPrefersDisplayName() {
        let label = VehicleSelectProjector.label(displayName: "Lightning", vin: "VIN1", id: 7, fallbackName: fallback)
        XCTAssertEqual(label, "Lightning")
    }

    func testFallsToVinWhenDisplayNameMissingOrEmpty() {
        XCTAssertEqual(
            VehicleSelectProjector.label(displayName: nil, vin: "5YJVIN", id: 7, fallbackName: fallback),
            "5YJVIN"
        )
        XCTAssertEqual(
            VehicleSelectProjector.label(displayName: "", vin: "5YJVIN", id: 7, fallbackName: fallback),
            "5YJVIN",
            "an empty display name is falsy (web `||`) and falls through to the VIN"
        )
    }

    func testFallsToFallbackNameWhenNoNameAndNoVin() {
        XCTAssertEqual(
            VehicleSelectProjector.label(displayName: nil, vin: nil, id: 42, fallbackName: fallback),
            "Vehicle 42"
        )
        XCTAssertEqual(
            VehicleSelectProjector.label(displayName: "", vin: "", id: 42, fallbackName: fallback),
            "Vehicle 42",
            "both empty → the localized fallback name"
        )
    }
}

// MARK: - Options + controlled value

final class VehicleSelectOptionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    func testOptionMapsIdValueLabel() {
        let option = VehicleSelectProjector.option(
            for: VehicleSelectVehicle(id: 3, displayName: "Garage", vin: nil),
            fallbackName: fallback
        )
        XCTAssertEqual(option.id, 3)
        XCTAssertEqual(option.value, "3")
        XCTAssertEqual(option.label, "Garage")
    }

    func testOptionsPreserveFleetOrder() {
        let vehicles = [
            VehicleSelectVehicle(id: 10, displayName: "A"),
            VehicleSelectVehicle(id: 4, displayName: "B"),
            VehicleSelectVehicle(id: 7, displayName: nil, vin: "VIN7")
        ]
        let options = VehicleSelectProjector.options(from: vehicles, fallbackName: fallback)
        XCTAssertEqual(options.map(\.value), ["10", "4", "7"])
        XCTAssertEqual(options.map(\.label), ["A", "B", "VIN7"])
    }

    func testSelectedValueReflectsSelection() {
        XCTAssertEqual(VehicleSelectProjector.selectedValue(for: 5), "5")
        XCTAssertEqual(VehicleSelectProjector.selectedValue(for: nil), "", "web: vehicleId == null → ''")
    }
}

// MARK: - Change parser (web `onChange` body)

final class VehicleSelectParseTests: XCTestCase {
    func testParsesPositiveInteger() {
        XCTAssertEqual(VehicleSelectProjector.parseSelection("12"), 12)
        XCTAssertEqual(VehicleSelectProjector.parseSelection(" 7 "), 7, "surrounding whitespace is trimmed")
    }

    func testBlankResolvesToNil() {
        XCTAssertNil(VehicleSelectProjector.parseSelection(""), "web Number('') === 0 → not > 0 → null")
        XCTAssertNil(VehicleSelectProjector.parseSelection("   "))
    }

    func testZeroAndNegativeResolveToNil() {
        XCTAssertNil(VehicleSelectProjector.parseSelection("0"))
        XCTAssertNil(VehicleSelectProjector.parseSelection("-5"))
    }

    func testNonNumericResolvesToNil() {
        XCTAssertNil(VehicleSelectProjector.parseSelection("abc"))
        XCTAssertNil(VehicleSelectProjector.parseSelection("3x"))
    }

    func testOverflowingMagnitudeResolvesToNil() {
        XCTAssertNil(
            VehicleSelectProjector.parseSelection("99999999999999999999999"),
            "an out-of-range magnitude is rejected rather than trapped"
        )
    }
}

// MARK: - Projection

final class VehicleSelectProjectionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    func testProjectionBuildsOptionsAndSelectedValue() {
        let projection = VehicleSelectProjector.projection(
            vehicles: [
                VehicleSelectVehicle(id: 1, displayName: "One"),
                VehicleSelectVehicle(id: 2, displayName: "Two")
            ],
            selectedId: 2,
            fallbackName: fallback
        )
        XCTAssertEqual(projection.options.count, 2)
        XCTAssertEqual(projection.selectedValue, "2")
        XCTAssertFalse(projection.isEmpty)
    }

    func testProjectionIsEmptyForEmptyFleet() {
        let projection = VehicleSelectProjector.projection(vehicles: [], selectedId: nil, fallbackName: fallback)
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.options.isEmpty)
        XCTAssertEqual(projection.selectedValue, "")
    }
}

// MARK: - Value-type equality

final class VehicleSelectValueTypeTests: XCTestCase {
    func testVehicleEquality() {
        let lhs = VehicleSelectVehicle(id: 1, displayName: "A", vin: "V")
        XCTAssertEqual(lhs, VehicleSelectVehicle(id: 1, displayName: "A", vin: "V"))
        XCTAssertNotEqual(lhs, VehicleSelectVehicle(id: 1, displayName: "A", vin: "W"))
    }

    func testOptionIdentity() {
        let option = VehicleSelectOption(id: 9, value: "9", label: "Nine")
        XCTAssertEqual(option.id, 9)
        XCTAssertEqual(option, VehicleSelectOption(id: 9, value: "9", label: "Nine"))
    }

    func testConnectionCases() {
        XCTAssertEqual(VehicleSelectConnection.allCases, [.live, .stale, .offline])
    }
}
