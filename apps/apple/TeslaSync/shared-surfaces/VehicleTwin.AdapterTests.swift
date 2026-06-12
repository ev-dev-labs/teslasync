//
//  VehicleTwin.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the paint model (the `inferPaintFromTesla` matcher
//  across Tesla's inconsistent code variants, the `useVehiclePaint` override > inferred > fallback
//  resolution, the canonical `exterior_color` codes, the stored-id round-trip) and the pure per-
//  subsystem legend / summary derivation (the port of the web `windowLabel` / `stateLabel` / security
//  / charge label helpers). No SwiftUI, no store: pure value logic against the English fallbacks.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Paint inference (web `inferPaintFromTesla`)

final class VehicleTwinPaintInferenceTests: XCTestCase {
    func testPearlWhiteVariants() {
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "PearlWhite"), .pearlWhite)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "PearlWhiteMultiCoat"), .pearlWhite)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "pearl white multi-coat"), .pearlWhite)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "white"), .pearlWhite)
    }

    func testMidnightSilverVariants() {
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "MidnightSilver"), .midnightSilver)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "MidnightSilverMetallic"), .midnightSilver)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "silver"), .midnightSilver)
    }

    func testDeepBlueVariants() {
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "DeepBlue"), .deepBlue)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "DeepBlueMetallic"), .deepBlue)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "blue"), .deepBlue)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "darkblue"), .deepBlue)
    }

    func testSolidBlackVariants() {
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "SolidBlack"), .solidBlack)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "black"), .solidBlack)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "ObsidianBlack"), .solidBlack)
    }

    func testRedMulticoatVariants() {
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "RedMulticoat"), .redMulticoat)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "Red Multi-Coat"), .redMulticoat)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "red"), .redMulticoat)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "MultiCoatRed"), .redMulticoat)
    }

    func testUnknownEmptyAndNilFallBackToPearlWhite() {
        XCTAssertEqual(VehicleTwinPaint.inferID(from: "Chartreuse"), .pearlWhite)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: ""), .pearlWhite)
        XCTAssertEqual(VehicleTwinPaint.inferID(from: nil), .pearlWhite)
        XCTAssertEqual(VehicleTwinPaint.fallback, .pearlWhite)
    }
}

// MARK: - Paint resolution (web `useVehiclePaint`: override > inferred > fallback)

final class VehicleTwinPaintResolveTests: XCTestCase {
    func testOverrideWinsOverInferred() {
        let resolved = VehicleTwinPaint.resolve(override: .deepBlue, exteriorColor: "PearlWhite")
        XCTAssertEqual(resolved.id, .deepBlue)
    }

    func testInferredUsedWhenNoOverride() {
        let resolved = VehicleTwinPaint.resolve(override: nil, exteriorColor: "RedMulticoat")
        XCTAssertEqual(resolved.id, .redMulticoat)
    }

    func testFallbackWhenNoOverrideAndNoColor() {
        let resolved = VehicleTwinPaint.resolve(override: nil, exteriorColor: nil)
        XCTAssertEqual(resolved.id, .pearlWhite)
    }
}

// MARK: - Paint catalog (codes, names, stored-id round-trip)

final class VehicleTwinPaintCatalogTests: XCTestCase {
    func testCatalogHasFiveOptionsInDisplayOrder() {
        XCTAssertEqual(
            VehicleTwinPaint.all.map(\.id),
            [.pearlWhite, .midnightSilver, .deepBlue, .solidBlack, .redMulticoat]
        )
    }

    func testCanonicalExteriorCodesReInferToSameID() {
        // Each option's canonical code must round-trip through the matcher so the resolved paint and
        // the rendered body color stay in lockstep with the override.
        for option in VehicleTwinPaint.all {
            XCTAssertEqual(VehicleTwinPaint.inferID(from: option.exteriorColorCode), option.id)
        }
    }

    func testOptionForIDIsTotal() {
        for id in VehicleTwinPaintID.allCases {
            XCTAssertEqual(VehicleTwinPaint.option(for: id).id, id)
        }
    }

    func testStoredIDRoundTrip() {
        XCTAssertEqual(VehicleTwinPaint.id(fromStored: "deep-blue"), .deepBlue)
        XCTAssertEqual(VehicleTwinPaint.id(fromStored: "pearl-white"), .pearlWhite)
        XCTAssertNil(VehicleTwinPaint.id(fromStored: "chartreuse"))
        XCTAssertNil(VehicleTwinPaint.id(fromStored: nil))
    }

    func testEveryOptionHasALocalizableName() {
        for option in VehicleTwinPaint.all {
            XCTAssertTrue(option.labelKey.hasPrefix("paint."))
            XCTAssertFalse(option.defaultLabel.isEmpty)
        }
    }
}

// MARK: - Legend derivation (web `C`-intent labels)

final class VehicleTwinLegendTests: XCTestCase {
    private func legend(_ state: VehicleTwinState) -> [VehicleTwinLegendItem.Kind: VehicleTwinLegendItem] {
        Dictionary(uniqueKeysWithValues: VehicleTwinProjection.legend(for: state).map { ($0.kind, $0) })
    }

    func testLegendHasOneChipPerSubsystem() {
        let items = VehicleTwinProjection.legend(for: .empty)
        XCTAssertEqual(items.count, VehicleTwinLegendItem.Kind.allCases.count)
        XCTAssertEqual(Set(items.map(\.kind)).count, items.count)
    }

    func testCalmLockedState() {
        let state = VehicleTwinState(
            doors: DigitalTwinWidgetTwinDoorStates(
                driverFront: false,
                passengerFront: false,
                driverRear: false,
                passengerRear: false
            ),
            windowFD: .closed,
            windowFP: .closed,
            windowRD: .closed,
            windowRP: .closed,
            frunkOpen: false,
            trunkOpen: false,
            chargePortOpen: false,
            isCharging: false,
            isDriving: false,
            locked: true,
            sentryMode: false,
            headlights: false,
            hazards: false,
            turnSignal: .off,
            driverSeatOccupied: false
        )
        let map = legend(state)
        XCTAssertEqual(map[.lock]?.value, "Locked")
        XCTAssertEqual(map[.lock]?.tone, .success)
        XCTAssertEqual(map[.windows]?.value, "All closed")
        XCTAssertEqual(map[.doors]?.value, "All closed")
        XCTAssertEqual(map[.charge]?.value, "Idle")
        XCTAssertEqual(map[.lights]?.value, "Off")
        XCTAssertEqual(map[.turnSignal]?.value, "Off")
        XCTAssertEqual(map[.sentry]?.value, "Off")
        XCTAssertEqual(map[.seat]?.value, "Empty")
        XCTAssertEqual(map[.motion]?.value, "Parked")
        XCTAssertEqual(map[.frunkTrunk]?.value, "Closed")
    }

    func testRichActiveState() {
        let state = VehicleTwinState(
            doors: DigitalTwinWidgetTwinDoorStates(
                driverFront: true,
                passengerFront: false,
                driverRear: false,
                passengerRear: false,
                trunkFront: true,
                trunkRear: false
            ),
            windowFD: .open,
            windowFP: .closed,
            windowRD: .partial,
            windowRP: .closed,
            frunkOpen: true,
            trunkOpen: false,
            chargePortOpen: true,
            isCharging: true,
            isDriving: false,
            locked: false,
            sentryMode: true,
            headlights: true,
            hazards: false,
            turnSignal: .left,
            driverSeatOccupied: true
        )
        let map = legend(state)
        XCTAssertEqual(map[.lock]?.value, "Unlocked")
        XCTAssertEqual(map[.lock]?.tone, .danger)
        XCTAssertEqual(map[.windows]?.value, "2 open")
        XCTAssertEqual(map[.windows]?.tone, .warning)
        XCTAssertEqual(map[.doors]?.value, "1 open")
        XCTAssertEqual(map[.charge]?.value, "Charging")
        XCTAssertEqual(map[.charge]?.tone, .success)
        XCTAssertEqual(map[.lights]?.value, "On")
        XCTAssertEqual(map[.turnSignal]?.value, "Left")
        XCTAssertEqual(map[.sentry]?.value, "On")
        XCTAssertEqual(map[.sentry]?.tone, .danger)
        XCTAssertEqual(map[.seat]?.value, "Occupied")
        XCTAssertEqual(map[.frunkTrunk]?.value, "Frunk open")
    }

    func testHazardsOverrideHeadlightsInLights() {
        let state = VehicleTwinState(headlights: true, hazards: true)
        XCTAssertEqual(legend(state)[.lights]?.value, "Hazards")
        XCTAssertEqual(legend(state)[.lights]?.tone, .warning)
    }

    func testUnknownState() {
        let map = legend(.empty)
        XCTAssertEqual(map[.lock]?.value, "Unknown")
        XCTAssertEqual(map[.lock]?.tone, .neutral)
        XCTAssertEqual(map[.windows]?.value, "Unknown")
        XCTAssertEqual(map[.doors]?.value, "Unknown")
        XCTAssertEqual(map[.lights]?.value, "Unknown")
        XCTAssertEqual(map[.turnSignal]?.value, "—")
        XCTAssertEqual(map[.sentry]?.value, "Unknown")
        XCTAssertEqual(map[.seat]?.value, "Unknown")
        XCTAssertEqual(map[.frunkTrunk]?.value, "—")
        XCTAssertEqual(map[.charge]?.value, "Idle")
        XCTAssertEqual(map[.motion]?.value, "Parked")
    }

    func testChargePortOpenWithoutCharging() {
        let state = VehicleTwinState(chargePortOpen: true)
        XCTAssertEqual(legend(state)[.charge]?.value, "Port open")
        XCTAssertEqual(legend(state)[.charge]?.tone, .info)
    }

    func testTrunkOnlyOpen() {
        let state = VehicleTwinState(frunkOpen: false, trunkOpen: true)
        XCTAssertEqual(legend(state)[.frunkTrunk]?.value, "Trunk open")
    }

    func testBothCargoOpen() {
        let state = VehicleTwinState(frunkOpen: true, trunkOpen: true)
        XCTAssertEqual(legend(state)[.frunkTrunk]?.value, "Both open")
    }
}

// MARK: - Region detail rows (web hover-tooltip peer)

final class VehicleTwinRegionsTests: XCTestCase {
    private func rows(_ state: VehicleTwinState) -> [String: String] {
        Dictionary(uniqueKeysWithValues: VehicleTwinRegionsBuilder.rows(for: state).map { ($0.id, $0.value) })
    }

    func testRegionsCoverEverySubsystem() {
        let ids = VehicleTwinRegionsBuilder.rows(for: .empty).map(\.id)
        XCTAssertEqual(ids.count, 13)
        XCTAssertTrue(ids.contains("windowFrontDriver"))
        XCTAssertTrue(ids.contains("doorPassengerRear"))
        XCTAssertTrue(ids.contains("chargePort"))
    }

    func testWindowLabelsUseWebStrings() {
        let state = VehicleTwinState(windowFD: .open, windowFP: .partial, windowRD: .closed, windowRP: nil)
        let map = rows(state)
        XCTAssertEqual(map["windowFrontDriver"], "Open")
        XCTAssertEqual(map["windowFrontPassenger"], "Partially open")
        XCTAssertEqual(map["windowRearDriver"], "Closed")
        XCTAssertEqual(map["windowRearPassenger"], "Unknown")
    }

    func testDoorAndCargoStateLabels() {
        let state = VehicleTwinState(
            doors: DigitalTwinWidgetTwinDoorStates(driverFront: true, passengerFront: false),
            frunkOpen: true,
            trunkOpen: false
        )
        let map = rows(state)
        XCTAssertEqual(map["doorDriverFront"], "Open")
        XCTAssertEqual(map["doorPassengerFront"], "Closed")
        XCTAssertEqual(map["doorDriverRear"], "Unknown")
        XCTAssertEqual(map["frunk"], "Open")
        XCTAssertEqual(map["trunk"], "Closed")
    }

    func testLockSentryAndChargePortText() {
        XCTAssertEqual(rows(VehicleTwinState(locked: true))["lock"], "Locked")
        XCTAssertEqual(rows(VehicleTwinState(locked: false))["lock"], "Unlocked")
        XCTAssertEqual(rows(.empty)["lock"], "Lock unknown")
        XCTAssertEqual(rows(VehicleTwinState(sentryMode: true))["sentry"], "Sentry mode active")
        XCTAssertEqual(rows(VehicleTwinState(sentryMode: false))["sentry"], "Sentry off")
        XCTAssertEqual(rows(VehicleTwinState(chargePortOpen: true, isCharging: true))["chargePort"], "Charging")
        XCTAssertEqual(rows(VehicleTwinState(chargePortOpen: true))["chargePort"], "Open")
    }
}

// MARK: - VoiceOver summary (localized)

final class VehicleTwinSummaryTests: XCTestCase {
    func testSummaryListsActiveStates() {
        let state = VehicleTwinState(
            doors: DigitalTwinWidgetTwinDoorStates(driverFront: true),
            frunkOpen: true,
            trunkOpen: true,
            isCharging: true,
            isDriving: true,
            locked: false,
            sentryMode: true,
            headlights: true,
            hazards: true
        )
        let summary = VehicleTwinProjection.stateSummary(for: state)
        XCTAssertTrue(summary.contains("Unlocked"))
        XCTAssertTrue(summary.contains("1 open"))
        XCTAssertTrue(summary.contains("Driving"))
        XCTAssertTrue(summary.contains("Charging"))
        XCTAssertTrue(summary.contains("Sentry mode active"))
        XCTAssertTrue(summary.contains("Hazards"))
        XCTAssertTrue(summary.contains("Frunk open"))
        XCTAssertTrue(summary.contains("Trunk open"))
    }

    func testSummaryForUnknownStateIsNotEmpty() {
        let summary = VehicleTwinProjection.stateSummary(for: .empty)
        XCTAssertFalse(summary.isEmpty)
        XCTAssertTrue(summary.contains("Unknown"))
    }
}
