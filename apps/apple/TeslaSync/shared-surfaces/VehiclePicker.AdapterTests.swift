//
//  VehiclePicker.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the web name fallback chain
//  (`display_name || vin || `Vehicle ${id}``), the pin membership test (web `pins.some(...)`), the pin-aware
//  STABLE ordering (web comparator: pinned floated to the top by `position`, the rest in original fleet
//  order), the option mapping (incl. the pin + selection flags), the full projection (incl. the single-vs-
//  picker `isPickable` decision), and the value-type equality. Split from VehiclePicker.Tests.swift (the
//  SwiftUI / state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class VehiclePickerAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(VehiclePickerSurface.slug, "VehiclePicker")
    }
}

// MARK: - Name fallback (web `display_name || vin || `Vehicle ${id}``)

final class VehiclePickerNameTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    func testPrefersDisplayName() {
        let name = VehiclePickerProjector.name(displayName: "Lightning", vin: "VIN", id: 7, fallbackName: fallback)
        XCTAssertEqual(name, "Lightning")
    }

    func testFallsToVinWhenNameMissingOrEmpty() {
        XCTAssertEqual(
            VehiclePickerProjector.name(displayName: nil, vin: "5YJVIN", id: 7, fallbackName: fallback),
            "5YJVIN"
        )
        XCTAssertEqual(
            VehiclePickerProjector.name(displayName: "", vin: "5YJVIN", id: 7, fallbackName: fallback),
            "5YJVIN",
            "an empty display name is falsy (web `||`) and falls through to the VIN"
        )
    }

    func testFallsToFallbackNameWhenNoNameAndNoVin() {
        XCTAssertEqual(
            VehiclePickerProjector.name(displayName: nil, vin: nil, id: 42, fallbackName: fallback),
            "Vehicle 42"
        )
        XCTAssertEqual(
            VehiclePickerProjector.name(displayName: "", vin: "", id: 42, fallbackName: fallback),
            "Vehicle 42"
        )
    }
}

// MARK: - Pin membership (web `pins.some((p) => String(p.item_id) === String(v.id))`)

final class VehiclePickerPinTests: XCTestCase {
    private let pins = [VehiclePickerPin(itemId: "1", position: 0), VehiclePickerPin(itemId: "3", position: 1)]

    func testPinnedVehicleDetected() {
        XCTAssertTrue(VehiclePickerProjector.isPinned(vehicleId: 1, pins: pins))
        XCTAssertTrue(VehiclePickerProjector.isPinned(vehicleId: 3, pins: pins))
    }

    func testUnpinnedVehicleNotDetected() {
        XCTAssertFalse(VehiclePickerProjector.isPinned(vehicleId: 2, pins: pins))
        XCTAssertFalse(VehiclePickerProjector.isPinned(vehicleId: 1, pins: []))
    }
}

// MARK: - Pin-aware ordering (web comparator — pinned floated by position, rest original order, stable)

final class VehiclePickerSortTests: XCTestCase {
    private func fleet(_ count: Int) -> [VehiclePickerVehicle] {
        (1 ... count).map { VehiclePickerVehicle(id: $0, displayName: "Car \($0)") }
    }

    func testNoPinsReturnsFleetUnchanged() {
        let vehicles = fleet(3)
        XCTAssertEqual(
            VehiclePickerProjector.sortedVehicles(vehicles, pins: []).map(\.id),
            [1, 2, 3],
            "web: pins.length === 0 returns vehicles as-is"
        )
    }

    func testPinnedFloatToTopInPositionOrder() {
        let vehicles = fleet(4)
        let pins = [VehiclePickerPin(itemId: "3", position: 0), VehiclePickerPin(itemId: "1", position: 1)]
        XCTAssertEqual(
            VehiclePickerProjector.sortedVehicles(vehicles, pins: pins).map(\.id),
            [3, 1, 2, 4],
            "pinned #3 (pos 0) then #1 (pos 1) float up; #2 #4 follow in original order"
        )
    }

    func testUnpinnedPreserveOriginalOrderStably() {
        let vehicles = fleet(5)
        let pins = [VehiclePickerPin(itemId: "5", position: 0)]
        XCTAssertEqual(
            VehiclePickerProjector.sortedVehicles(vehicles, pins: pins).map(\.id),
            [5, 1, 2, 3, 4],
            "only #5 pinned → it leads; the rest keep their original relative order (stable)"
        )
    }

    func testPinForAbsentVehicleIsIgnored() {
        let vehicles = fleet(2)
        let pins = [VehiclePickerPin(itemId: "99", position: 0), VehiclePickerPin(itemId: "2", position: 1)]
        XCTAssertEqual(
            VehiclePickerProjector.sortedVehicles(vehicles, pins: pins).map(\.id),
            [2, 1],
            "a pin whose vehicle is not in the fleet simply has no row to float"
        )
    }
}

// MARK: - Options (web `sorted.map((v) => ({ value, label }))`)

final class VehiclePickerOptionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }

    private func fleet(_ count: Int) -> [VehiclePickerVehicle] {
        (1 ... count).map { VehiclePickerVehicle(id: $0, displayName: "Car \($0)") }
    }

    func testOptionsMapInPinOrderWithFlags() {
        let pins = [VehiclePickerPin(itemId: "2", position: 0)]
        let options = VehiclePickerProjector.options(
            vehicles: fleet(3),
            pins: pins,
            selectedId: 1,
            fallbackName: fallback
        )
        XCTAssertEqual(options.map(\.id), [2, 1, 3])
        XCTAssertEqual(options.map(\.label), ["Car 2", "Car 1", "Car 3"])
        XCTAssertEqual(options.map(\.isPinned), [true, false, false])
        XCTAssertEqual(options.map(\.isSelected), [false, true, false])
    }

    func testOptionUsesVinFallbackAndCarriesPin() {
        let option = VehiclePickerProjector.option(
            for: VehiclePickerVehicle(id: 7, displayName: nil, vin: "VIN7"),
            selectedId: 7,
            pins: [VehiclePickerPin(itemId: "7", position: 0)],
            fallbackName: fallback
        )
        XCTAssertEqual(option.label, "VIN7")
        XCTAssertTrue(option.isPinned)
        XCTAssertTrue(option.isSelected)
    }
}

// MARK: - Projection (full render-ready output)

final class VehiclePickerProjectionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle \($0)" }
    private var copy: VehiclePickerCopy {
        VehiclePickerCopy(fallbackName: fallback, placeholder: "Select vehicle")
    }

    private func fleet(_ count: Int) -> [VehiclePickerVehicle] {
        (1 ... count).map { VehiclePickerVehicle(id: $0, displayName: "Car \($0)") }
    }

    func testProjectionForMultiVehicleIsPickable() {
        let projection = VehiclePickerProjector.projection(
            vehicles: fleet(3),
            pins: [VehiclePickerPin(itemId: "2", position: 0)],
            selectedId: 2,
            copy: copy
        )
        XCTAssertTrue(projection.isPickable)
        XCTAssertEqual(projection.options.count, 3)
        XCTAssertEqual(projection.selectedId, 2)
        XCTAssertEqual(projection.selectedLabel, "Car 2")
        XCTAssertTrue(projection.selectedIsPinned, "the selected vehicle is pinned")
    }

    func testProjectionForSingleVehicleIsNotPickable() {
        let projection = VehiclePickerProjector.projection(
            vehicles: [VehiclePickerVehicle(id: 9, displayName: nil, vin: "VIN9")],
            pins: [],
            selectedId: 9,
            copy: copy
        )
        XCTAssertFalse(projection.isPickable, "web: vehicles.length <= 1 → hidden; native renders a static chip")
        XCTAssertEqual(projection.selectedLabel, "VIN9")
        XCTAssertFalse(projection.selectedIsPinned)
        XCTAssertEqual(projection.options.count, 1)
    }

    func testProjectionPlaceholderWhenNothingSelected() {
        let projection = VehiclePickerProjector.projection(
            vehicles: fleet(2),
            pins: [],
            selectedId: nil,
            copy: copy
        )
        XCTAssertEqual(projection.selectedLabel, "Select vehicle", "no matching row → the placeholder")
        XCTAssertFalse(projection.selectedIsPinned)
    }
}

// MARK: - Value-type equality

final class VehiclePickerValueTypeTests: XCTestCase {
    func testVehicleEquality() {
        let lhs = VehiclePickerVehicle(id: 1, displayName: "A", vin: "V")
        XCTAssertEqual(lhs, VehiclePickerVehicle(id: 1, displayName: "A", vin: "V"))
        XCTAssertNotEqual(lhs, VehiclePickerVehicle(id: 1, displayName: "A", vin: "X"))
    }

    func testPinEquality() {
        XCTAssertEqual(VehiclePickerPin(itemId: "1", position: 0), VehiclePickerPin(itemId: "1", position: 0))
        XCTAssertNotEqual(VehiclePickerPin(itemId: "1", position: 0), VehiclePickerPin(itemId: "1", position: 1))
    }

    func testOptionIdentityAndEquality() {
        let option = VehiclePickerOption(id: 9, label: "Nine", isPinned: true, isSelected: false)
        XCTAssertEqual(option.id, 9)
        XCTAssertEqual(option, VehiclePickerOption(id: 9, label: "Nine", isPinned: true, isSelected: false))
    }

    func testConnectionCases() {
        XCTAssertEqual(VehiclePickerConnection.allCases, [.live, .stale, .offline])
    }
}
