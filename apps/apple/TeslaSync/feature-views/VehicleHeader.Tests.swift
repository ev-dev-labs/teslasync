//
//  VehicleHeader.Tests.swift
//  TeslaSync — P4 feature view · 0301 · VehicleHeader (Apple)
//
//  Adapter + projection coverage for the VehicleHeader surface:
//    • StatusMap — the web `statusVariant` mapping across all seven states + the
//      VEHICLE_STATE_LABELS key/fallback pairs.
//    • Format — the "model + trim" badge composition (web template literal) and the VIN
//      fallback (web `?? ''`).
//    • Projection — the web render plus the P4 leaf contract across loading / empty /
//      error / data and the status / waking branches.
//    • Accessibility — the composed VoiceOver header label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store.
//

import XCTest
@testable import TeslaSync

private func makeVehicle(
    model: String = "Model S",
    trim: String = "Plaid",
    vin: String = "5YJSA1E26MF000000"
) -> VehicleHeaderVehicle {
    VehicleHeaderVehicle(model: model, trimBadging: trim, vin: vin)
}

// MARK: - Status variant (web `statusVariant`)

final class VehicleHeaderStatusVariantTests: XCTestCase {
    func testVariantForEveryState() {
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.online), .success)
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.driving), .success)
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.charging), .warning)
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.parked), .info)
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.updating), .info)
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.asleep), .neutral)
        XCTAssertEqual(VehicleHeaderStatusMap.variant(.offline), .danger)
    }

    func testEveryStateHasAVariant() {
        for status in VehicleHeaderStatus.allCases {
            // Exhaustive switch guarantees a value; assert it is one of the five tones.
            XCTAssertTrue(VehicleHeaderBadgeVariant.allCases.contains(VehicleHeaderStatusMap.variant(status)))
        }
    }
}

// MARK: - Status labels (web VEHICLE_STATE_LABELS)

final class VehicleHeaderStatusLabelTests: XCTestCase {
    func testLabelKeyIsNamespaced() {
        XCTAssertEqual(VehicleHeaderStatusMap.labelKey(.online), "status.online")
        XCTAssertEqual(VehicleHeaderStatusMap.labelKey(.offline), "status.offline")
    }

    func testLabelFallbackIsCapitalizedWebLabel() {
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.online), "Online")
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.driving), "Driving")
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.charging), "Charging")
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.parked), "Parked")
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.updating), "Updating")
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.asleep), "Asleep")
        XCTAssertEqual(VehicleHeaderStatusMap.labelFallback(.offline), "Offline")
    }
}

// MARK: - Model line (web `{model} {trim_badging}`)

final class VehicleHeaderModelLineTests: XCTestCase {
    func testJoinsModelAndTrimWithSpace() {
        XCTAssertEqual(
            VehicleHeaderFormat.modelLine(makeVehicle(model: "Model 3", trim: "Long Range")),
            "Model 3 Long Range"
        )
    }

    func testDropsEmptyTrimWithoutDanglingSpace() {
        XCTAssertEqual(VehicleHeaderFormat.modelLine(makeVehicle(model: "Model Y", trim: "")), "Model Y")
    }

    func testDropsEmptyModel() {
        XCTAssertEqual(VehicleHeaderFormat.modelLine(makeVehicle(model: "", trim: "Performance")), "Performance")
    }

    func testNilVehicleIsEmpty() {
        XCTAssertEqual(VehicleHeaderFormat.modelLine(nil), "")
    }
}

// MARK: - VIN (web `vehicle?.vin ?? ''`)

final class VehicleHeaderVINTests: XCTestCase {
    func testVINPassthrough() {
        XCTAssertEqual(VehicleHeaderFormat.vin(makeVehicle(vin: "ABC123")), "ABC123")
    }

    func testNilVehicleVINIsEmpty() {
        XCTAssertEqual(VehicleHeaderFormat.vin(nil), "")
    }
}

// MARK: - Projection (web render + P4 leaf contract)

final class VehicleHeaderProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = VehicleHeaderProjection.resolve(VehicleHeaderInput(
            vehicle: makeVehicle(),
            status: .driving,
            isLoading: true,
            errorMessage: "boom"
        ))
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = VehicleHeaderProjection.resolve(VehicleHeaderInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenResolvedWithoutVehicle() {
        let resolved = VehicleHeaderProjection.resolve(VehicleHeaderInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.vehicle)
    }

    func testDataComposesVariantModelLineAndVIN() {
        let resolved = VehicleHeaderProjection.resolve(VehicleHeaderInput(
            vehicle: makeVehicle(model: "Model X", trim: "Plaid", vin: "VIN9"),
            status: .charging,
            waking: true
        ))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.variant, .warning)
        XCTAssertEqual(resolved.modelLine, "Model X Plaid")
        XCTAssertEqual(resolved.vin, "VIN9")
        XCTAssertTrue(resolved.waking)
    }

    func testStatusDefaultsToOfflineVariant() {
        let resolved = VehicleHeaderProjection.resolve(VehicleHeaderInput())
        XCTAssertEqual(resolved.status, .offline)
        XCTAssertEqual(resolved.variant, .danger)
    }

    func testEmptyMessageDoesNotForceError() {
        let resolved = VehicleHeaderProjection.resolve(VehicleHeaderInput(
            vehicle: makeVehicle(),
            status: .online,
            errorMessage: ""
        ))
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility summary content

final class VehicleHeaderAccessibilityTests: XCTestCase {
    func testHeaderLabelJoinsParts() {
        XCTAssertEqual(
            VehicleHeaderAccessibility.headerLabel(
                statusLabel: "Driving",
                modelLine: "Model S Plaid",
                vinLabel: "VIN",
                vin: "ABC123"
            ),
            "Driving, Model S Plaid, VIN ABC123"
        )
    }

    func testHeaderLabelDropsEmptyParts() {
        XCTAssertEqual(
            VehicleHeaderAccessibility.headerLabel(
                statusLabel: "Offline",
                modelLine: "",
                vinLabel: "VIN",
                vin: ""
            ),
            "Offline"
        )
    }
}
