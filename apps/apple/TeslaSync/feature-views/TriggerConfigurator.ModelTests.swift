//
//  TriggerConfigurator.ModelTests.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  State-holder coverage for the TriggerConfigurator surface: the `TriggerConfiguratorModel`
//  edit rules across every kind (each emitting `onChange`), the geofence-source wiring +
//  refresh, the projection push, and the P1/S11 `view.opened` telemetry. Split from
//  `TriggerConfigurator.Tests.swift` to keep each file within the house length budget.
//
//  Runs in the TeslaSync(/-macOS) XCTest targets — no network, no real store; the model is
//  driven by `InMemoryGeofenceSource`.
//

import XCTest
@testable import TeslaSync

@MainActor
final class TriggerConfiguratorModelTests: XCTestCase {
    /// A bound model plus the test doubles driving it (a struct, not a tuple, to stay within
    /// the house large-tuple lint budget).
    private struct Harness {
        let model: TriggerConfiguratorModel
        let source: InMemoryGeofenceSource
        let recorder: TriggerRecorder
    }

    private func makeHarness(
        _ trigger: AutomationTrigger,
        input: GeofenceInput = GeofenceInput(geofences: [Geofence(id: "1", name: "Home")]),
        telemetry: TriggerConfiguratorTelemetry = OSLogTriggerConfiguratorTelemetry()
    ) -> Harness {
        let source = InMemoryGeofenceSource(initial: input)
        let recorder = TriggerRecorder()
        let model = TriggerConfiguratorModel(
            trigger: trigger,
            source: source,
            telemetry: telemetry,
            onChange: { recorder.record($0) }
        )
        return Harness(model: model, source: source, recorder: recorder)
    }

    func testStartEmitsTelemetryOnceAndStartsSource() {
        let spy = SpyTriggerTelemetry()
        let harness = makeHarness(.event(.online), telemetry: spy)
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(spy.surfaces, [TriggerConfiguratorSurface.slug])
        XCTAssertEqual(harness.source.startCount, 1)
        XCTAssertEqual(harness.model.geofences.count, 1)
    }

    func testScheduleTimeAndDayEdits() {
        let harness = makeHarness(.schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
        harness.model.setScheduleTime(hour: 9, minute: 30)
        XCTAssertEqual(harness.model.trigger, .schedule(cronExpr: "30 9 * * *", timezone: "UTC"))
        harness.model.toggleScheduleDay(1)
        XCTAssertEqual(harness.model.trigger, .schedule(cronExpr: "30 9 * * 0,2,3,4,5,6", timezone: "UTC"))
        XCTAssertEqual(harness.recorder.changes.count, 2)
    }

    func testScheduleModeToggle() {
        let simple = makeHarness(.schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
        simple.model.toggleScheduleMode()
        XCTAssertEqual(simple.model.trigger, .schedule(cronExpr: "0 8 * * *", timezone: "UTC"))

        let advanced = makeHarness(.schedule(cronExpr: "*/15 9 * * *", timezone: "UTC"))
        advanced.model.toggleScheduleMode()
        XCTAssertEqual(advanced.model.trigger, .schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
    }

    func testScheduleCronAndTimezoneEdits() {
        let harness = makeHarness(.schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
        harness.model.setScheduleCron("*/5 * * * *")
        XCTAssertEqual(harness.model.trigger, .schedule(cronExpr: "*/5 * * * *", timezone: "UTC"))
        harness.model.setScheduleTimezone("Europe/London")
        XCTAssertEqual(harness.model.trigger, .schedule(cronExpr: "*/5 * * * *", timezone: "Europe/London"))
    }

    func testEventEdit() {
        let harness = makeHarness(.event(.online))
        harness.model.setEventType(.driveStart)
        XCTAssertEqual(harness.model.trigger, .event(.driveStart))
        XCTAssertEqual(harness.recorder.last, .event(.driveStart))
    }

    func testGeofenceEditsSeedAndClearDwell() {
        let harness = makeHarness(.geofence(placeID: 0, event: .enter, dwellMinutes: nil))
        harness.model.setGeofencePlace(5)
        XCTAssertEqual(harness.model.trigger, .geofence(placeID: 5, event: .enter, dwellMinutes: nil))
        harness.model.setGeofenceEvent(.dwell)
        XCTAssertEqual(harness.model.trigger, .geofence(placeID: 5, event: .dwell, dwellMinutes: 5))
        harness.model.setDwellMinutes(12)
        XCTAssertEqual(harness.model.trigger, .geofence(placeID: 5, event: .dwell, dwellMinutes: 12))
        harness.model.setGeofenceEvent(.exit)
        XCTAssertEqual(harness.model.trigger, .geofence(placeID: 5, event: .exit, dwellMinutes: nil))
    }

    func testSignalSignalChangeSeedsTypeDefault() {
        let harness = makeHarness(
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(20)))
        )
        harness.model.setSignal("is_locked")
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "is_locked", op: .equals, value: .bool(true)))
        )
        harness.model.setSignal("state")
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "state", op: .equals, value: .text("online")))
        )
        harness.model.setSignal("speed")
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "speed", op: .lessThan, value: .number(20)))
        )
    }

    func testSignalOperatorValueAndChangedEdits() {
        let harness = makeHarness(
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(20)))
        )
        harness.model.setOperator(.greaterThanOrEqual)
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .greaterThanOrEqual, value: .number(20)))
        )
        harness.model.setSignalValue("55")
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .greaterThanOrEqual, value: .number(55)))
        )
        harness.model.setChangedOnly(true)
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .changed, value: .none))
        )
        harness.model.setChangedOnly(false)
        XCTAssertEqual(
            harness.model.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .equals, value: .number(20)))
        )
    }

    func testRefreshDelegatesAndPushUpdatesProjection() {
        let harness = makeHarness(
            .geofence(placeID: 0, event: .enter, dwellMinutes: nil),
            input: GeofenceInput(isLoading: true)
        )
        harness.model.start()
        XCTAssertEqual(harness.model.geofencePhase, .loading)
        harness.model.refreshGeofences()
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(GeofenceInput(
            isFetching: true,
            geofences: [Geofence(id: "1", name: "Home")],
            isStale: true
        ))
        XCTAssertEqual(harness.model.geofencePhase, .data)
        XCTAssertTrue(harness.model.geofencesFetching)
        XCTAssertTrue(harness.model.geofencesStale)
    }

    func testApplyPushesExternalTrigger() {
        let harness = makeHarness(.event(.online))
        harness.model.apply(trigger: .event(.offline))
        XCTAssertEqual(harness.model.trigger, .event(.offline))
        XCTAssertTrue(harness.recorder.changes.isEmpty)
    }
}

// MARK: - Test doubles

@MainActor
private final class TriggerRecorder {
    private(set) var changes: [AutomationTrigger] = []
    var last: AutomationTrigger? {
        changes.last
    }

    func record(_ trigger: AutomationTrigger) {
        changes.append(trigger)
    }
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTriggerTelemetry: TriggerConfiguratorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
