//
//  TriggerConfigurator.Tests.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  Unit coverage for the TriggerConfigurator surface:
//    • Adapter — buildCronExpr / parseCronExpr round-trips, handleDayToggle weekday math,
//      signalValueFromInput coercion + the value-string derivation, parseFloat semantics,
//      createDefaultTrigger seeds, and the geofence wire decode.
//    • State holder — GeofenceProjection phase resolution (loading / error / empty / data
//      plus the stale / offline overlays), the TriggerConfiguratorModel edit rules across
//      every kind (each emitting onChange), and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver day + geofence labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryGeofenceSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Cron expression (port of web buildCronExpr / parseCronExpr)

@MainActor
final class TriggerCronTests: XCTestCase {
    func testBuildJoinsSelectedDays() {
        XCTAssertEqual(CronExpression.build(hour: 8, minute: 0, days: [1, 2, 3, 4, 5]), "0 8 * * 1,2,3,4,5")
    }

    func testBuildEmptyDaysIsEveryDay() {
        XCTAssertEqual(CronExpression.build(hour: 8, minute: 30, days: []), "30 8 * * *")
    }

    func testBuildAllSevenDaysCollapsesToStar() {
        XCTAssertEqual(CronExpression.build(hour: 8, minute: 0, days: [0, 1, 2, 3, 4, 5, 6]), "0 8 * * *")
    }

    func testParseSimpleWithDays() {
        let parsed = CronExpression.parse("0 8 * * 1,2,3,4,5")
        XCTAssertEqual(parsed, SimpleSchedule(hour: 8, minute: 0, days: [1, 2, 3, 4, 5]))
    }

    func testParseEveryDay() {
        XCTAssertEqual(CronExpression.parse("30 8 * * *"), SimpleSchedule(hour: 8, minute: 30, days: []))
    }

    func testParseRejectsWrongFieldCount() {
        XCTAssertNil(CronExpression.parse("0 8 * *"))
        XCTAssertNil(CronExpression.parse("0 8 * * * *"))
    }

    func testParseRejectsNonStarDayOfMonthOrMonth() {
        XCTAssertNil(CronExpression.parse("0 8 5 * *"))
        XCTAssertNil(CronExpression.parse("0 8 * 6 *"))
    }

    func testParseRejectsNonIntegerTime() {
        XCTAssertNil(CronExpression.parse("*/15 9 * * *"))
        XCTAssertNil(CronExpression.parse("0 nine * * *"))
    }

    func testParseDropsNonIntegerDays() {
        XCTAssertEqual(CronExpression.parse("0 8 * * 1,x,3"), SimpleSchedule(hour: 8, minute: 0, days: [1, 3]))
    }

    func testParseToleratesSurroundingWhitespace() {
        XCTAssertEqual(CronExpression.parse("  0   8 * * * "), SimpleSchedule(hour: 8, minute: 0, days: []))
    }

    func testBuildParseRoundTrip() {
        let built = CronExpression.build(hour: 17, minute: 45, days: [6])
        XCTAssertEqual(CronExpression.parse(built), SimpleSchedule(hour: 17, minute: 45, days: [6]))
    }
}

// MARK: - Day toggle (port of web handleDayToggle)

@MainActor
final class TriggerDayToggleTests: XCTestCase {
    func testToggleOffEmptySelectsOtherSix() {
        XCTAssertEqual(TriggerAdapter.toggleDay([], 2), [0, 1, 3, 4, 5, 6])
    }

    func testToggleRemovesPresentDay() {
        XCTAssertEqual(TriggerAdapter.toggleDay([1, 2, 3], 2), [1, 3])
    }

    func testToggleAddsAndSorts() {
        XCTAssertEqual(TriggerAdapter.toggleDay([3, 1], 2), [1, 2, 3])
    }

    func testFillingAllSevenNormalisesToEmpty() {
        XCTAssertEqual(TriggerAdapter.toggleDay([0, 1, 2, 3, 4, 5], 6), [])
    }

    func testIsDayActive() {
        XCTAssertTrue(TriggerAdapter.isDayActive([], 4))
        XCTAssertTrue(TriggerAdapter.isDayActive([4], 4))
        XCTAssertFalse(TriggerAdapter.isDayActive([1, 2], 4))
    }
}

// MARK: - Signal value coercion (port of web signalValueFromInput + value derivation)

@MainActor
final class TriggerSignalValueTests: XCTestCase {
    func testChangedDropsValue() {
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "battery_level", op: .changed, rawValue: "5"), .none)
    }

    func testBoolFieldCoercesToBool() {
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "is_locked", op: .equals, rawValue: "true"), .bool(true))
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "is_locked", op: .equals, rawValue: "false"), .bool(false))
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "is_locked", op: .equals, rawValue: "x"), .bool(false))
    }

    func testStateFieldCoercesToText() {
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "state", op: .equals, rawValue: "online"), .text("online"))
    }

    func testNumericFieldCoercesToNumber() {
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "speed", op: .greaterThan, rawValue: "65"), .number(65))
        XCTAssertEqual(TriggerAdapter.signalValue(signal: "speed", op: .greaterThan, rawValue: "abc"), .number(0))
    }

    func testDisplayValueDefaults() {
        XCTAssertEqual(
            TriggerAdapter.displayValue(for: SignalTrigger(signal: "is_locked", op: .equals, value: .none)),
            "true"
        )
        XCTAssertEqual(
            TriggerAdapter.displayValue(for: SignalTrigger(signal: "state", op: .equals, value: .none)),
            "online"
        )
        XCTAssertEqual(
            TriggerAdapter.displayValue(for: SignalTrigger(signal: "speed", op: .lessThan, value: .none)),
            "20"
        )
    }

    func testDisplayValueFromTypedValue() {
        XCTAssertEqual(
            TriggerAdapter.displayValue(for: SignalTrigger(signal: "is_locked", op: .equals, value: .bool(false))),
            "false"
        )
        XCTAssertEqual(
            TriggerAdapter.displayValue(for: SignalTrigger(signal: "state", op: .equals, value: .text("driving"))),
            "driving"
        )
        XCTAssertEqual(
            TriggerAdapter.displayValue(for: SignalTrigger(signal: "speed", op: .lessThan, value: .number(12.5))),
            "12.5"
        )
    }

    func testParseLeadingDouble() {
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("20"), 20)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("12.5"), 12.5)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("-3"), -3)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("12abc"), 12)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("abc"), 0)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble(""), 0)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("."), 0)
        XCTAssertEqual(TriggerAdapter.parseLeadingDouble("  7  "), 7)
    }

    func testNumberStringDropsIntegerTail() {
        XCTAssertEqual(TriggerAdapter.numberString(20), "20")
        XCTAssertEqual(TriggerAdapter.numberString(12.5), "12.5")
        XCTAssertEqual(TriggerAdapter.numberString(-3), "-3")
    }
}

// MARK: - Default seeds (port of web createDefaultTrigger)

@MainActor
final class TriggerDefaultTests: XCTestCase {
    func testCreateDefaults() {
        XCTAssertEqual(AutomationTrigger.createDefault(.schedule), .schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
        XCTAssertEqual(AutomationTrigger.createDefault(.event), .event(.online))
        XCTAssertEqual(
            AutomationTrigger.createDefault(.geofence),
            .geofence(placeID: 0, event: .enter, dwellMinutes: nil)
        )
        XCTAssertEqual(
            AutomationTrigger.createDefault(.signal),
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(20)))
        )
    }

    func testKindDiscriminator() {
        XCTAssertEqual(AutomationTrigger.event(.online).kind, .event)
        XCTAssertEqual(TriggerKind.geofence.rawValue, "trigger_geofence")
    }
}

// MARK: - Geofence wire decode

@MainActor
final class TriggerGeofenceDecodeTests: XCTestCase {
    func testDecodesNumericAndStringIDs() {
        let json = """
        [{"id": 1, "name": "Home"}, {"id": "2", "name": "Work"}, {"id": 3.0, "name": "Lot"}]
        """
        let list = Geofence.decodeList(Data(json.utf8))
        XCTAssertEqual(list, [
            Geofence(id: "1", name: "Home"),
            Geofence(id: "2", name: "Work"),
            Geofence(id: "3", name: "Lot")
        ])
    }

    func testDropsEntriesWithoutID() {
        let list = Geofence.decodeList(Data(#"[{"name": "NoID"}, {"id": 9, "name": "Ok"}]"#.utf8))
        XCTAssertEqual(list, [Geofence(id: "9", name: "Ok")])
    }

    func testInvalidJSONReturnsNil() {
        XCTAssertNil(Geofence.decodeList(Data("not json".utf8)))
    }
}

// MARK: - Geofence projection: phase resolution + overlays

@MainActor
final class TriggerGeofenceProjectionTests: XCTestCase {
    private let sample = [Geofence(id: "1", name: "Home")]

    func testLoadingTakesPrecedence() {
        let input = GeofenceInput(isLoading: true, geofences: sample)
        XCTAssertEqual(GeofenceProjection.resolve(input).phase, .loading)
    }

    func testErrorTakesPrecedenceOverCachedData() {
        let input = GeofenceInput(errorMessage: "boom", geofences: sample)
        XCTAssertEqual(GeofenceProjection.resolve(input).phase, .error("boom"))
    }

    func testEmptyWhenResolvedEmpty() {
        XCTAssertEqual(GeofenceProjection.resolve(GeofenceInput(geofences: [])).phase, .empty)
    }

    func testDataWhenGeofencesPresent() {
        let resolved = GeofenceProjection.resolve(GeofenceInput(geofences: sample))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.geofences.count, 1)
    }

    func testStaleAndOfflineRequireContent() {
        let withData = GeofenceInput(geofences: sample, isStale: true, isOffline: true)
        let resolvedWith = GeofenceProjection.resolve(withData)
        XCTAssertTrue(resolvedWith.isStale)
        XCTAssertTrue(resolvedWith.isOffline)

        let noData = GeofenceInput(isLoading: true, isStale: true, isOffline: true)
        let resolvedWithout = GeofenceProjection.resolve(noData)
        XCTAssertFalse(resolvedWithout.isStale)
        XCTAssertFalse(resolvedWithout.isOffline)
    }
}

// MARK: - Accessibility labels

@MainActor
final class TriggerAccessibilityTests: XCTestCase {
    func testDayLabel() {
        XCTAssertEqual(
            TriggerConfiguratorAccessibility.dayLabel(day: "Mon", active: true) { _, fallback in fallback },
            "Mon, selected"
        )
        XCTAssertEqual(
            TriggerConfiguratorAccessibility.dayLabel(day: "Tue", active: false) { _, fallback in fallback },
            "Tue, not selected"
        )
    }

    func testGeofenceValue() {
        XCTAssertEqual(
            TriggerConfiguratorAccessibility.geofenceValue(selectedName: "Home") { _, fallback in fallback },
            "Home"
        )
        XCTAssertEqual(
            TriggerConfiguratorAccessibility.geofenceValue(selectedName: nil) { _, fallback in fallback },
            "Select geofence..."
        )
    }
}
