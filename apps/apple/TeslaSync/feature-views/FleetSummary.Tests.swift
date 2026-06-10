//
//  FleetSummary.Tests.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  Unit coverage for the Fleet Summary adapter: web-parity number formatting
//  (`fmtNumber`), SI distance conversion (`convertDistanceFromSI`), the freshness age
//  label, and the projector (vehicle count, average battery, total-range conversion,
//  charging / online counts, the four tile descriptors). Pure Foundation logic — runs on
//  a plain host.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (web parity)

@MainActor final class FleetFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(FleetFormat.number(688, decimals: 0), "688")
        XCTAssertEqual(FleetFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(FleetFormat.number(1234.5, decimals: 1), "1,234.5")
    }

    func testNumberRoundsHalfUp() {
        XCTAssertEqual(FleetFormat.number(70.5, decimals: 0), "71")
        XCTAssertEqual(FleetFormat.number(1609.344, decimals: 0), "1,609")
        XCTAssertEqual(FleetFormat.number(687.993, decimals: 0), "688")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(FleetFormat.safeNumber(.nan), 0)
        XCTAssertEqual(FleetFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(FleetFormat.number(.nan, decimals: 0), "0")
    }

    func testLocaleAffectsSeparators() {
        XCTAssertEqual(FleetFormat.number(1234.5, decimals: 1, localeIdentifier: "de_DE"), "1.234,5")
    }
}

// MARK: - SI conversion (web parity)

@MainActor final class FleetConvertTests: XCTestCase {
    func testDistanceFromSIMatchesWeb() {
        XCTAssertEqual(FleetConvert.distanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(FleetConvert.distanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(FleetConvert.distanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
        // Unknown unit falls back to km (web switch is exhaustive; native is safe).
        XCTAssertEqual(FleetConvert.distanceFromSI(2000, to: "??"), 2, accuracy: 1e-9)
    }
}

// MARK: - Freshness age (web parity)

@MainActor final class FleetRelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testFormatAgeBuckets() {
        XCTAssertEqual(FleetRelativeTime.formatAge(nil, now: now), "—")
        XCTAssertEqual(FleetRelativeTime.formatAge(now.addingTimeInterval(-5), now: now), "just now")
        XCTAssertEqual(FleetRelativeTime.formatAge(now.addingTimeInterval(-30), now: now), "30s ago")
        XCTAssertEqual(FleetRelativeTime.formatAge(now.addingTimeInterval(-120), now: now), "2m ago")
        XCTAssertEqual(FleetRelativeTime.formatAge(now.addingTimeInterval(-7200), now: now), "2h ago")
    }
}

// MARK: - Projector (web aggregation parity)

@MainActor final class FleetSummaryProjectorTests: XCTestCase {
    private func update(
        vehicleCount: Int,
        states: [FleetVehicleState?],
        distance: String = "km",
        updatedAt: Date? = nil
    ) -> FleetSummaryUpdate {
        FleetSummaryUpdate(
            vehicles: (0 ..< vehicleCount).map { FleetVehicle(id: $0 + 1) },
            states: states,
            units: FleetUnitPrefs(distance: distance, localeIdentifier: "en_US"),
            updatedAt: updatedAt
        )
    }

    func testAveragesBatteryOverResolvedStatesOnly() {
        // [80, 60, nil] → resolved [80, 60] → avg 70.
        let projection = FleetSummaryProjector.project(
            update: update(
                vehicleCount: 3,
                states: [
                    FleetVehicleState(batteryLevel: 80),
                    FleetVehicleState(batteryLevel: 60),
                    nil
                ]
            )
        )
        XCTAssertEqual(projection.averageBattery, 70, accuracy: 1e-9)
        XCTAssertEqual(projection.metrics[1].value, "70%")
        XCTAssertEqual(projection.onlineCount, 2)
    }

    func testAverageBatteryRoundsHalfUpInTile() {
        // [81, 60] → 70.5 → tile "71%".
        let projection = FleetSummaryProjector.project(
            update: update(
                vehicleCount: 2,
                states: [FleetVehicleState(batteryLevel: 81), FleetVehicleState(batteryLevel: 60)]
            )
        )
        XCTAssertEqual(projection.metrics[1].value, "71%")
    }

    func testTotalRangeConvertsAndFormatsPerUnit() {
        // One state with 1,609,344 m == 1000 mi == 1609.344 km.
        let metersState = FleetVehicleState(ratedRangeMeters: 1_609_344)
        let km = FleetSummaryProjector.project(update: update(vehicleCount: 1, states: [metersState], distance: "km"))
        XCTAssertEqual(km.totalRangeMeters, 1_609_344, accuracy: 1e-6)
        XCTAssertEqual(km.metrics[2].value, "1,609")
        XCTAssertEqual(km.metrics[2].localizedLabel, "Total Range km")

        let mi = FleetSummaryProjector.project(update: update(vehicleCount: 1, states: [metersState], distance: "mi"))
        XCTAssertEqual(mi.metrics[2].value, "1,000")
        XCTAssertEqual(mi.metrics[2].localizedLabel, "Total Range mi")
    }

    func testChargingAndOnlineCounts() {
        let projection = FleetSummaryProjector.project(
            update: update(
                vehicleCount: 4,
                states: [
                    FleetVehicleState(isCharging: true),
                    FleetVehicleState(isCharging: true),
                    FleetVehicleState(isCharging: false),
                    nil
                ]
            )
        )
        XCTAssertEqual(projection.chargingCount, 2)
        XCTAssertEqual(projection.onlineCount, 3)
        XCTAssertEqual(projection.metrics[3].value, "2")
        XCTAssertEqual(projection.metrics[3].secondary, "/ 3")
        XCTAssertEqual(projection.metrics[3].accessibilityValue, "2 of 3")
    }

    func testVehicleCountIsIndependentOfResolvedStates() {
        // 5 vehicles, only 2 states resolved → Vehicles tile still shows 5.
        let projection = FleetSummaryProjector.project(
            update: update(
                vehicleCount: 5,
                states: [FleetVehicleState(batteryLevel: 50), nil, nil, FleetVehicleState(batteryLevel: 90), nil]
            )
        )
        XCTAssertEqual(projection.vehicleCount, 5)
        XCTAssertEqual(projection.metrics[0].value, "5")
    }

    func testEmptyStatesProduceZeroAggregates() {
        let projection = FleetSummaryProjector.project(update: update(vehicleCount: 2, states: [nil, nil]))
        XCTAssertEqual(projection.averageBattery, 0)
        XCTAssertEqual(projection.totalRangeMeters, 0)
        XCTAssertEqual(projection.chargingCount, 0)
        XCTAssertEqual(projection.onlineCount, 0)
        XCTAssertFalse(projection.hasResolvedStates)
        XCTAssertEqual(projection.metrics[1].value, "0%")
        XCTAssertEqual(projection.metrics[3].secondary, "/ 0")
    }

    func testMetricsExposeIdsLabelsAndTones() {
        let projection = FleetSummaryProjector.project(
            update: update(vehicleCount: 1, states: [FleetVehicleState(batteryLevel: 50)])
        )
        XCTAssertEqual(projection.metrics.map(\.id), ["vehicles", "avgBattery", "totalRange", "chargingOnline"])
        XCTAssertEqual(projection.metrics[0].localizedLabel, "Vehicles")
        XCTAssertEqual(projection.metrics[1].localizedLabel, "Avg Battery")
        XCTAssertEqual(projection.metrics[3].localizedLabel, "Charging / Online")
        XCTAssertEqual(projection.metrics.map(\.iconTone), [.vehicles, .battery, .range, .charging])
        XCTAssertTrue(projection.metrics[3].valueHighlighted)
        XCTAssertFalse(projection.metrics[0].valueHighlighted)
    }

    func testSpokenAccessibilityPhrases() {
        let projection = FleetSummaryProjector.project(
            update: update(
                vehicleCount: 3,
                states: [
                    FleetVehicleState(batteryLevel: 82, ratedRangeMeters: 1_609_344, isCharging: true)
                ],
                distance: "mi"
            )
        )
        XCTAssertEqual(projection.metrics[0].spoken, "Vehicles 3")
        XCTAssertEqual(projection.metrics[1].spoken, "Avg Battery 82%")
        XCTAssertEqual(projection.metrics[2].spoken, "Total Range mi 1,000")
        XCTAssertEqual(projection.metrics[3].spoken, "Charging / Online 1 of 1")
    }

    func testAgeLabelProjected() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        let projection = FleetSummaryProjector.project(
            update: update(
                vehicleCount: 1,
                states: [FleetVehicleState(batteryLevel: 1)],
                updatedAt: now.addingTimeInterval(-30)
            ),
            now: now
        )
        XCTAssertEqual(projection.ageLabel, "30s ago")
    }
}
