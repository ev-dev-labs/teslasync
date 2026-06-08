//
//  ConditionBuilder.Tests.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  Unit coverage for the ConditionBuilder surface:
//    • Adapter — the web transform ports: createDefaultCondition, the signal/operator
//      change handlers, conditionValueFromInput + the `value` getter, numericValue /
//      parseFloat||0 / parseInt||0 / String(Number), the operator filter, the value
//      setters, toggleDay, timezoneSelection, the geofence value/onChange, + catalogs.
//    • State holder — GeofencePresentation.resolve across every branch (loading / empty
//      / error / stale / offline / content), the web-prop → load-state mapping, and the
//      GeofenceOptionsModel wiring.
//    • Telemetry — the P1/S11 `view.opened` reporter emits the surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (and the isolated SwiftPM
//  harness). They have no network and no real store: the model is driven by
//  InMemoryGeofenceOptionsSource.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: web transform ports

final class ConditionBuilderAdapterTests: XCTestCase {
    func testDefaultConditions() {
        XCTAssertEqual(
            ConditionBuilderAdapter.defaultCondition(kind: .signal),
            .signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20))
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.defaultCondition(kind: .timeWindow),
            .timeWindow(TimeWindowCondition(
                startTime: "06:00", endTime: "09:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5]
            ))
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.defaultCondition(kind: .geofence),
            .geofence(GeofenceCondition(placeId: 0, state: .inside))
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.defaultCondition(kind: .otherAutomation),
            .otherAutomation(OtherAutomationCondition(otherAutomationId: 0, state: .enabled))
        )
    }

    func testSignalChanged() {
        XCTAssertEqual(
            ConditionBuilderAdapter.signalChanged(to: "is_locked"),
            SignalCondition(signal: "is_locked", op: .equals, valueBool: true)
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.signalChanged(to: "state"),
            SignalCondition(signal: "state", op: .equals, valueText: "online")
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.signalChanged(to: "speed"),
            SignalCondition(signal: "speed", op: .lessThan, valueNum: 20)
        )
    }

    func testSignalValueFromInputBranches() {
        let boolField = SignalCondition(signal: "sentry_mode", op: .equals)
        XCTAssertEqual(ConditionBuilderAdapter.signalValueFromInput(boolField, value: "true").valueBool, true)
        XCTAssertEqual(ConditionBuilderAdapter.signalValueFromInput(boolField, value: "false").valueBool, false)

        let stateField = SignalCondition(signal: "state", op: .equals)
        XCTAssertEqual(ConditionBuilderAdapter.signalValueFromInput(stateField, value: "asleep").valueText, "asleep")

        let inField = SignalCondition(signal: "speed", op: .inList)
        XCTAssertEqual(ConditionBuilderAdapter.signalValueFromInput(inField, value: "1,2,3").valueText, "1,2,3")

        let numField = SignalCondition(signal: "battery_level", op: .lessThan)
        XCTAssertEqual(ConditionBuilderAdapter.signalValueFromInput(numField, value: "42").valueNum, 42)
        // parseFloat || 0 — non-numeric → 0.
        XCTAssertEqual(ConditionBuilderAdapter.signalValueFromInput(numField, value: "abc").valueNum, 0)
    }

    func testSignalValueString() {
        XCTAssertEqual(
            ConditionBuilderAdapter.signalValueString(SignalCondition(
                signal: "is_locked",
                op: .equals,
                valueBool: false
            )),
            "false"
        )
        // Bool default is true (web `String(value_bool ?? true)`).
        XCTAssertEqual(
            ConditionBuilderAdapter.signalValueString(SignalCondition(signal: "is_locked", op: .equals)),
            "true"
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.signalValueString(SignalCondition(
                signal: "state",
                op: .equals,
                valueText: "online"
            )),
            "online"
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.signalValueString(SignalCondition(signal: "speed", op: .lessThan, valueNum: 65)),
            "65"
        )
        // Numeric default is 20 (web `String(value_num ?? 20)`).
        XCTAssertEqual(
            ConditionBuilderAdapter.signalValueString(SignalCondition(signal: "speed", op: .lessThan)),
            "20"
        )
    }

    func testOperatorFilterForBool() {
        XCTAssertEqual(
            ConditionBuilderAdapter.operators(isBool: true),
            [.equals, .notEquals, .inList]
        )
        XCTAssertEqual(
            ConditionBuilderAdapter.operators(isBool: false),
            [.equals, .notEquals, .lessThan, .lessThanOrEqual, .greaterThan, .greaterThanOrEqual, .between, .inList]
        )
    }

    func testOperatorChangedToBetweenSeedsRange() {
        let condition = SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 30)
        let next = ConditionBuilderAdapter.operatorChanged(condition, to: .between)
        XCTAssertEqual(next.op, .between)
        XCTAssertEqual(next.valueMin, 30) // numericValue(value_min ?? value_num, 0)
        XCTAssertEqual(next.valueMax, 100) // numericValue(value_max, 100)
        XCTAssertNil(next.valueNum)
    }

    func testOperatorChangedToNonBetweenRecoercesValue() {
        let condition = SignalCondition(signal: "battery_level", op: .between, valueMin: 10, valueMax: 90)
        // signalValueString of a between numeric reads value_num ?? 20 → "20"; re-coerced to value_num 20.
        let next = ConditionBuilderAdapter.operatorChanged(condition, to: .greaterThan)
        XCTAssertEqual(next.op, .greaterThan)
        XCTAssertEqual(next.valueNum, 20)
        XCTAssertNil(next.valueMin)
        XCTAssertNil(next.valueMax)
    }

    func testValueSetters() {
        let base = SignalCondition(signal: "battery_level", op: .between, valueMin: 5, valueMax: 50)
        XCTAssertEqual(ConditionBuilderAdapter.withMin(base, 12).valueMin, 12)
        XCTAssertEqual(ConditionBuilderAdapter.withMin(base, 12).valueMax, 50) // keeps the rest (web spread)
        XCTAssertEqual(ConditionBuilderAdapter.withMax(base, 77).valueMax, 77)
        let numeric = ConditionBuilderAdapter.withNumber(base, 33)
        XCTAssertEqual(numeric.valueNum, 33)
        XCTAssertNil(numeric.valueMin) // single-Value edit is exclusive
        XCTAssertEqual(ConditionBuilderAdapter.withBool(base, true).valueBool, true)
        XCTAssertEqual(ConditionBuilderAdapter.withText(base, "x").valueText, "x")
    }

    func testNumericCoercion() {
        XCTAssertEqual(ConditionBuilderAdapter.numericValue(nil, fallback: 5), 5)
        XCTAssertEqual(ConditionBuilderAdapter.numericValue(.nan, fallback: 5), 5)
        XCTAssertEqual(ConditionBuilderAdapter.numericValue(3, fallback: 5), 3)
        XCTAssertEqual(ConditionBuilderAdapter.parseFloatOrZero("12.5abc"), 12.5)
        XCTAssertEqual(ConditionBuilderAdapter.parseFloatOrZero("  7 "), 7)
        XCTAssertEqual(ConditionBuilderAdapter.parseFloatOrZero("abc"), 0)
        XCTAssertEqual(ConditionBuilderAdapter.parseFloatOrZero(""), 0)
        XCTAssertEqual(ConditionBuilderAdapter.parseIntOrZero("5abc"), 5)
        XCTAssertEqual(ConditionBuilderAdapter.parseIntOrZero("abc"), 0)
        XCTAssertEqual(ConditionBuilderAdapter.numberString(20), "20")
        XCTAssertEqual(ConditionBuilderAdapter.numberString(20.5), "20.5")
    }

    func testToggleDay() {
        XCTAssertEqual(ConditionBuilderAdapter.toggleDay([1, 2, 3], 2), [1, 3])
        XCTAssertEqual(ConditionBuilderAdapter.toggleDay([1, 3], 2), [1, 2, 3]) // appended + sorted
        XCTAssertEqual(ConditionBuilderAdapter.toggleDay([], 0), [0])
    }

    func testTimezoneSelection() {
        // The default "UTC" is not a COMMON_TIMEZONES value → maps to the "" UTC-Default option.
        XCTAssertEqual(ConditionBuilderAdapter.timezoneSelection("UTC"), "")
        XCTAssertEqual(ConditionBuilderAdapter.timezoneSelection(""), "")
        XCTAssertEqual(ConditionBuilderAdapter.timezoneSelection("America/New_York"), "America/New_York")
        XCTAssertEqual(ConditionBuilderAdapter.timezoneSelection("Mars/Olympus"), "")
    }

    func testGeofenceValueMapping() {
        XCTAssertEqual(ConditionBuilderAdapter.geofenceSelection(placeId: 0), "")
        XCTAssertEqual(ConditionBuilderAdapter.geofenceSelection(placeId: 7), "7")
        XCTAssertEqual(ConditionBuilderAdapter.geofencePlaceId(from: ""), 0)
        XCTAssertEqual(ConditionBuilderAdapter.geofencePlaceId(from: "7"), 7)
    }

    func testCatalogs() {
        XCTAssertEqual(ConditionBuilderAdapter.signalFields.count, 9)
        XCTAssertEqual(ConditionBuilderAdapter.signalFields.first?.key, "battery_level")
        XCTAssertEqual(
            ConditionBuilderAdapter.boolFieldKeys,
            ["is_locked", "is_charging", "is_climate_on", "sentry_mode"]
        )
        XCTAssertEqual(ConditionBuilderAdapter.dayShortNames, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
        XCTAssertEqual(ConditionBuilderAdapter.timezones.count, 11)
        XCTAssertEqual(ConditionBuilderAdapter.timezones.first?.value, "")
        XCTAssertTrue(ConditionBuilderAdapter.isBoolSignal("sentry_mode"))
        XCTAssertFalse(ConditionBuilderAdapter.isBoolSignal("speed"))
    }
}

// MARK: - Presentation: geofence-source state resolution (every branch)

final class GeofencePresentationTests: XCTestCase {
    private let one = [GeofenceOption(id: "1", name: "Home")]

    func testLoadingBranches() {
        XCTAssertEqual(GeofencePresentation.resolve(.idle), .loading)
        XCTAssertEqual(GeofencePresentation.resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(
            GeofencePresentation.resolve(.loading(cached: one, stale: false)),
            .content(one, .live, refreshing: true)
        )
        XCTAssertEqual(
            GeofencePresentation.resolve(.loading(cached: one, stale: true)),
            .content(one, .stale, refreshing: true)
        )
    }

    func testLoadedAndEmptyBranches() {
        XCTAssertEqual(
            GeofencePresentation.resolve(.loaded(one, stale: false)),
            .content(one, .live, refreshing: false)
        )
        XCTAssertEqual(GeofencePresentation.resolve(.loaded([], stale: false)), .empty(.live))
        XCTAssertEqual(
            GeofencePresentation.resolve(.loaded(one, stale: true)),
            .content(one, .stale, refreshing: false)
        )
        XCTAssertEqual(GeofencePresentation.resolve(.empty(stale: false)), .empty(.live))
        XCTAssertEqual(GeofencePresentation.resolve(.empty(stale: true)), .empty(.stale))
    }

    func testFailedBranches() {
        XCTAssertEqual(
            GeofencePresentation.resolve(.failed(.offline, cached: one, stale: true)),
            .content(one, .offline, refreshing: false)
        )
        XCTAssertEqual(GeofencePresentation.resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(
            GeofencePresentation.resolve(.failed(.network(message: "x"), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            GeofencePresentation.resolve(.failed(.decode(message: "x"), cached: nil, stale: false)),
            .error(retryable: false)
        )
        XCTAssertEqual(
            GeofencePresentation.resolve(.failed(.network(message: "x"), cached: one, stale: false)),
            .content(one, .stale, refreshing: false)
        )
    }
}

// MARK: - State holder: web-prop mapping + wiring

@MainActor
final class GeofenceOptionsModelTests: XCTestCase {
    private let one = [GeofenceOption(id: "1", name: "Home")]

    func testLoadStateMapping() {
        XCTAssertEqual(
            GeofenceOptionsModel.loadState(geofences: [], loading: true),
            .loading(cached: nil, stale: false)
        )
        XCTAssertEqual(
            GeofenceOptionsModel.loadState(geofences: one, loading: true),
            .loading(cached: one, stale: false)
        )
        XCTAssertEqual(GeofenceOptionsModel.loadState(geofences: [], loading: false), .empty(stale: false))
        XCTAssertEqual(
            GeofenceOptionsModel.loadState(geofences: one, loading: false),
            .loaded(one, stale: false)
        )
    }

    func testStartAppliesInitialOnce() {
        let source = InMemoryGeofenceOptionsSource(initial: .loaded(one, stale: false))
        let model = GeofenceOptionsModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(model.state, .loaded(one, stale: false))
        XCTAssertEqual(model.presentation, .content(one, .live, refreshing: false))
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegate() {
        let source = InMemoryGeofenceOptionsSource(initial: .empty(stale: false))
        let model = GeofenceOptionsModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testPushUpdatesStateAndPresentation() {
        let source = InMemoryGeofenceOptionsSource(initial: .loading(cached: nil, stale: false))
        let model = GeofenceOptionsModel(source: source)
        model.start()
        XCTAssertEqual(model.presentation, .loading)
        source.push(.loaded(one, stale: false))
        XCTAssertEqual(model.state, .loaded(one, stale: false))
        XCTAssertEqual(model.presentation, .content(one, .live, refreshing: false))
    }

    func testWebPropInit() {
        let model = GeofenceOptionsModel(geofences: one, loading: false)
        XCTAssertEqual(model.state, .loaded(one, stale: false))
    }
}

// MARK: - Telemetry: P1/S11 view.opened

final class ConditionBuilderTelemetryTests: XCTestCase {
    func testReporterEmitsSurfaceSlug() {
        let spy = SpyConditionBuilderTelemetry()
        ConditionBuilderOpenReporter.report(using: spy)
        XCTAssertEqual(spy.surfaces, ["ConditionBuilder"])
        XCTAssertEqual(ConditionBuilderDiagnostics.surface, "ConditionBuilder")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyConditionBuilderTelemetry: ConditionBuilderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
