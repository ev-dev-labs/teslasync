//
//  VehicleMultiSelect.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the web `lastFourVin`, the web
//  `vehicleLabel` fallback chain (`display_name || model || `Vehicle #${id}`` with the `— model` / `(VIN
//  ...last4)` augmentations), the web `dedupSort` (drop `<= 0`, de-dupe, sort), the trigger-summary branch
//  (all / none / one / partial / count), the unknown-id derivation (web Decision D10), the All-sentinel /
//  per-vehicle toggles (incl. D13 restore), the full projection, and the `hydrateVehicleSelection` /
//  `buildVehiclePayload` codec (web Decisions D11 / D12 / D14). Split from VehicleMultiSelect.Tests.swift (the
//  SwiftUI / state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class VehicleMultiSelectAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(VehicleMultiSelectSurface.slug, "VehicleMultiSelect")
    }
}

// MARK: - lastFourVin (web `lastFourVin`)

final class VehicleMultiSelectVINTests: XCTestCase {
    func testReturnsLastFourWhenLongEnough() {
        XCTAssertEqual(VehicleMultiSelectProjector.lastFourVIN("5YJ3E1EA7KF000123"), "0123")
        XCTAssertEqual(VehicleMultiSelectProjector.lastFourVIN("ABCD"), "ABCD")
    }

    func testReturnsNilWhenAbsentOrTooShort() {
        XCTAssertNil(VehicleMultiSelectProjector.lastFourVIN(nil))
        XCTAssertNil(VehicleMultiSelectProjector.lastFourVIN(""))
        XCTAssertNil(VehicleMultiSelectProjector.lastFourVIN("ABC"))
    }
}

// MARK: - vehicleLabel (web `vehicleLabel`)

final class VehicleMultiSelectLabelTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle #\($0)" }

    private func label(_ displayName: String?, _ model: String?, _ vin: String?, id: Int = 7) -> String {
        VehicleMultiSelectProjector.vehicleLabel(
            displayName: displayName,
            model: model,
            vin: vin,
            id: id,
            fallbackName: fallback
        )
    }

    func testNameModelAndVinProduceFullLabel() {
        XCTAssertEqual(label("Plaid", "Model S", "5YJSA1E26HF000002"), "Plaid — Model S (VIN ...0002)")
    }

    func testDisplayNameEqualToModelDropsTheDash() {
        XCTAssertEqual(
            label("Model 3", "Model 3", "5YJ3E1EA7KF000003"),
            "Model 3 (VIN ...0003)",
            "web `display_name === v.model` collapses to `base (VIN ...last4)`"
        )
    }

    func testNoModelWithVin() {
        XCTAssertEqual(label("Garage", nil, "5YJ000000000AAAA"), "Garage (VIN ...AAAA)")
    }

    func testNoVinWithModel() {
        XCTAssertEqual(label("Plaid", "Model S", nil), "Plaid — Model S")
    }

    func testNoVinNoModel() {
        XCTAssertEqual(label("Plaid", nil, nil), "Plaid")
    }

    func testEmptyDisplayNameFallsToModel() {
        XCTAssertEqual(label("", "Model 3", nil), "Model 3 — Model 3", "empty name is falsy (web `||`)")
    }

    func testNoNameNoModelUsesFallback() {
        XCTAssertEqual(label(nil, nil, nil, id: 42), "Vehicle #42")
        XCTAssertEqual(label("", "", "AB"), "Vehicle #7", "short VIN is ignored; both names empty → fallback")
    }
}

// MARK: - dedupSort (web `dedupSort`)

final class VehicleMultiSelectDedupSortTests: XCTestCase {
    func testDeDupesAndSorts() {
        XCTAssertEqual(VehicleMultiSelectProjector.dedupSort([3, 1, 1, 2]), [1, 2, 3])
    }

    func testDropsZeroAndNegative() {
        XCTAssertEqual(VehicleMultiSelectProjector.dedupSort([0, -1, 5]), [5])
    }

    func testEmptyStaysEmpty() {
        XCTAssertEqual(VehicleMultiSelectProjector.dedupSort([]), [])
    }
}

// MARK: - Summary (web `triggerSummary`)

final class VehicleMultiSelectSummaryTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle #\($0)" }
    private let fleet = [
        VehicleMultiSelectVehicle(id: 1, displayName: "Roadster"),
        VehicleMultiSelectVehicle(id: 2, displayName: "Plaid"),
        VehicleMultiSelectVehicle(id: 3, displayName: "Cybertruck")
    ]

    private func summary(_ value: VehicleMultiSelectValue) -> VehicleMultiSelectSummary {
        VehicleMultiSelectProjector.summary(value: value, vehicles: fleet, fallbackName: fallback)
    }

    func testAllStickyIsAll() {
        XCTAssertEqual(summary(.allSticky), .all)
    }

    func testEmptySpecificIsNone() {
        XCTAssertEqual(summary(.specific([])), .none)
    }

    func testSingleIsOneByName() {
        XCTAssertEqual(summary(.specific([2])), .one(name: "Plaid"))
    }

    func testSingleUnknownUsesFallbackName() {
        XCTAssertEqual(summary(.specific([99])), .one(name: "Vehicle #99"))
    }

    func testPartialSubset() {
        XCTAssertEqual(summary(.specific([1, 3])), .partial(count: 2, total: 3))
    }

    func testAllKnownIndividuallyIsCount() {
        XCTAssertEqual(summary(.specific([1, 2, 3])), .count(3))
    }
}

// MARK: - Unknown ids (web Decision D10)

final class VehicleMultiSelectUnknownTests: XCTestCase {
    func testUnknownIDsArePreservedInSelectionOrder() {
        let known: Set = [1, 2, 3]
        XCTAssertEqual(
            VehicleMultiSelectProjector.unknownIDs(value: .specific([2, 99, 1, 50]), knownIDs: known),
            [99, 50]
        )
    }

    func testAllStickyHasNoUnknowns() {
        XCTAssertEqual(VehicleMultiSelectProjector.unknownIDs(value: .allSticky, knownIDs: [1]), [])
    }
}

// MARK: - Toggles (web `handleToggleAll` / `handleToggleVehicle`)

final class VehicleMultiSelectToggleTests: XCTestCase {
    func testToggleAllFromSpecificMovesToSentinel() {
        XCTAssertEqual(VehicleMultiSelectProjector.toggleAll(.specific([1, 3]), previousSpecific: [1, 3]), .allSticky)
    }

    func testToggleAllFromSentinelRestoresPreviousSubset() {
        XCTAssertEqual(
            VehicleMultiSelectProjector.toggleAll(.allSticky, previousSpecific: [1, 3]),
            .specific([1, 3]),
            "web Decision D13 — toggle OFF restores the remembered subset"
        )
    }

    func testToggleAllFromSentinelWithNoMemoryIsEmptySpecific() {
        XCTAssertEqual(VehicleMultiSelectProjector.toggleAll(.allSticky, previousSpecific: []), .specific([]))
    }

    func testToggleVehicleFromSentinelStartsFreshSubset() {
        XCTAssertEqual(VehicleMultiSelectProjector.toggleVehicle(.allSticky, id: 2), .specific([2]))
    }

    func testToggleVehicleAddsDedupedSorted() {
        XCTAssertEqual(VehicleMultiSelectProjector.toggleVehicle(.specific([3]), id: 1), .specific([1, 3]))
    }

    func testToggleVehicleRemovesWhenPresent() {
        XCTAssertEqual(VehicleMultiSelectProjector.toggleVehicle(.specific([1, 2, 3]), id: 2), .specific([1, 3]))
    }
}

// MARK: - Projection

final class VehicleMultiSelectProjectionTests: XCTestCase {
    private let fallback: (Int) -> String = { "Vehicle #\($0)" }
    private let unknown: (Int) -> String = { "Vehicle #\($0)" }
    private let fleet = [
        VehicleMultiSelectVehicle(id: 1, displayName: "Roadster", model: "Roadster"),
        VehicleMultiSelectVehicle(id: 2, displayName: "Plaid", model: "Model S")
    ]

    private func projection(_ value: VehicleMultiSelectValue) -> VehicleMultiSelectProjection {
        VehicleMultiSelectProjector.projection(
            value: value,
            vehicles: fleet,
            fallbackName: fallback,
            unknownLabel: unknown
        )
    }

    func testRowsReflectSpecificSelection() {
        let projection = projection(.specific([2]))
        XCTAssertFalse(projection.allSelected)
        XCTAssertEqual(projection.rows.map(\.id), [1, 2])
        XCTAssertEqual(projection.rows.map(\.checked), [false, true])
        XCTAssertFalse(projection.isFleetEmpty)
        XCTAssertFalse(projection.hasUnknown)
    }

    func testAllStickyChecksSentinelNotRows() {
        let projection = projection(.allSticky)
        XCTAssertTrue(projection.allSelected)
        XCTAssertEqual(projection.rows.map(\.checked), [false, false])
    }

    func testUnknownRowsAppendedAndChecked() {
        let projection = projection(.specific([2, 99]))
        XCTAssertEqual(projection.unknownRows.map(\.id), [99])
        XCTAssertEqual(projection.unknownRows.first?.label, "Vehicle #99")
        XCTAssertTrue(projection.hasUnknown)
    }

    func testEmptyFleetIsFlagged() {
        let projection = VehicleMultiSelectProjector.projection(
            value: .allSticky,
            vehicles: [],
            fallbackName: fallback,
            unknownLabel: unknown
        )
        XCTAssertTrue(projection.isFleetEmpty)
        XCTAssertTrue(projection.rows.isEmpty)
    }
}

// MARK: - Codec (web `hydrateVehicleSelection` / `buildVehiclePayload`)

final class VehicleMultiSelectCodecTests: XCTestCase {
    func testHydrateAllVehiclesTrue() {
        XCTAssertEqual(
            VehicleMultiSelectProjector.hydrate(allVehicles: true, vehicleIDs: [], vehicleID: nil),
            .allSticky
        )
    }

    func testHydrateAllVehiclesFalseDedupsSorts() {
        XCTAssertEqual(
            VehicleMultiSelectProjector.hydrate(allVehicles: false, vehicleIDs: [3, 1, 1, 2], vehicleID: nil),
            .specific([1, 2, 3])
        )
    }

    func testHydrateLegacyVehicleIDPresent() {
        XCTAssertEqual(
            VehicleMultiSelectProjector.hydrate(allVehicles: nil, vehicleIDs: nil, vehicleID: 5),
            .specific([5])
        )
    }

    func testHydrateLegacyVehicleIDNullIsSentinel() {
        XCTAssertEqual(
            VehicleMultiSelectProjector.hydrate(allVehicles: nil, vehicleIDs: nil, vehicleID: nil),
            .allSticky
        )
    }

    func testBuildPayloadSentinel() {
        let payload = VehicleMultiSelectProjector.buildPayload(.allSticky)
        XCTAssertTrue(payload.allVehicles)
        XCTAssertEqual(payload.vehicleIDs, [])
    }

    func testBuildPayloadSpecificDedupsSorts() {
        let payload = VehicleMultiSelectProjector.buildPayload(.specific([3, 1, 2, 1]))
        XCTAssertFalse(payload.allVehicles)
        XCTAssertEqual(payload.vehicleIDs, [1, 2, 3])
    }

    func testBuildPayloadDropsZeroAndNegative() {
        let payload = VehicleMultiSelectProjector.buildPayload(.specific([0, -1, 5]))
        XCTAssertEqual(payload.vehicleIDs, [5])
    }
}

// MARK: - Value-type equality

final class VehicleMultiSelectValueTypeTests: XCTestCase {
    func testValueEquality() {
        XCTAssertEqual(VehicleMultiSelectValue.specific([1, 2]), .specific([1, 2]))
        XCTAssertNotEqual(VehicleMultiSelectValue.specific([1, 2]), .specific([2, 1]))
        XCTAssertNotEqual(VehicleMultiSelectValue.allSticky, .specific([]))
    }

    func testSelectedIDsAccessor() {
        XCTAssertEqual(VehicleMultiSelectValue.specific([4, 5]).selectedIDs, [4, 5])
        XCTAssertEqual(VehicleMultiSelectValue.allSticky.selectedIDs, [])
        XCTAssertTrue(VehicleMultiSelectValue.allSticky.isAllSticky)
    }

    func testVehicleEquality() {
        let lhs = VehicleMultiSelectVehicle(id: 1, displayName: "A", model: "M", vin: "V")
        XCTAssertEqual(lhs, VehicleMultiSelectVehicle(id: 1, displayName: "A", model: "M", vin: "V"))
        XCTAssertNotEqual(lhs, VehicleMultiSelectVehicle(id: 1, displayName: "A", model: "M", vin: "W"))
    }

    func testRowIdentity() {
        let row = VehicleMultiSelectRow(id: 9, label: "Nine", checked: true)
        XCTAssertEqual(row.id, 9)
        XCTAssertEqual(row, VehicleMultiSelectRow(id: 9, label: "Nine", checked: true))
    }

    func testConnectionCases() {
        XCTAssertEqual(VehicleMultiSelectConnection.allCases, [.live, .stale, .offline])
    }
}
