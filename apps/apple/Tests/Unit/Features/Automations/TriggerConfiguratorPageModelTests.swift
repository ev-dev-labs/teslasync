import XCTest
@testable import TeslaSync

/// State-machine + mutation tests for `TriggerConfiguratorPageModel` — the geofence data states the
/// page renders (loading / empty / success / error), the trigger-kind reseed, and every per-kind edit
/// rule ported from `web/src/features/automations/pages/TriggerConfigurator.tsx`. The web component is
/// a controlled editor, so these assert the form logic + the reused pure core directly.
@MainActor final class TriggerConfiguratorPageModelTests: XCTestCase {
    private struct StubGeofences: TriggerConfiguratorGeofenceProviding {
        let result: TriggerConfiguratorGeofenceLoad
        func load() async -> TriggerConfiguratorGeofenceLoad {
            result
        }
    }

    private func model(
        _ trigger: AutomationTrigger,
        geofences: TriggerConfiguratorGeofenceLoad = .success([])
    ) -> TriggerConfiguratorPageModel {
        TriggerConfiguratorPageModel(trigger: trigger, geofenceProvider: StubGeofences(result: geofences))
    }

    // MARK: - Geofence data states

    func testInitialGeofenceStateIsLoading() {
        let model = model(.createDefault(.geofence))
        XCTAssertEqual(model.geofenceState, .loading)
        XCTAssertTrue(model.geofences.isEmpty)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = model(.createDefault(.geofence), geofences: .success([]))
        await model.load()
        XCTAssertEqual(model.geofenceState, .empty)
        XCTAssertTrue(model.geofences.isEmpty)
    }

    func testLoadSuccessYieldsSuccessState() async {
        let model = model(.createDefault(.geofence), geofences: .success([
            Geofence(id: "1", name: "Home"),
            Geofence(id: "2", name: "Work")
        ]))
        await model.load()
        XCTAssertEqual(model.geofenceState, .success)
        XCTAssertEqual(model.geofences.count, 2)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = model(.createDefault(.geofence), geofences: .failure("boom"))
        await model.load()
        XCTAssertEqual(model.geofenceState, .error("boom"))
        XCTAssertTrue(model.geofences.isEmpty)
    }

    func testDefaultProviderLoadsRepresentativeGeofences() async {
        let model = TriggerConfiguratorPageModel(
            trigger: .createDefault(.geofence),
            geofenceProvider: DefaultTriggerConfiguratorGeofenceData()
        )
        await model.load()
        XCTAssertEqual(model.geofenceState, .success)
        XCTAssertEqual(model.geofences.count, 3)
    }

    func testRefreshReloads() async {
        let model = model(.createDefault(.geofence), geofences: .success([Geofence(id: "1", name: "Home")]))
        await model.load()
        XCTAssertEqual(model.geofenceState, .success)
        await model.refresh()
        XCTAssertEqual(model.geofenceState, .success)
        XCTAssertEqual(model.geofences.count, 1)
    }

    // MARK: - Trigger kind reseed (web createDefaultTrigger)

    func testSetTriggerKindReseedsDefaults() {
        let model = model(.createDefault(.schedule))
        model.setTriggerKind(.event)
        XCTAssertEqual(model.trigger, .event(.online))
        model.setTriggerKind(.signal)
        XCTAssertEqual(
            model.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(20)))
        )
        model.setTriggerKind(.geofence)
        XCTAssertEqual(model.trigger, .geofence(placeID: 0, event: .enter, dwellMinutes: nil))
        model.setTriggerKind(.schedule)
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
    }

    func testSetTriggerKindSameKindIsNoOp() {
        let model = model(.signal(SignalTrigger(signal: "speed", op: .greaterThan, value: .number(60))))
        model.setTriggerKind(.signal)
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "speed", op: .greaterThan, value: .number(60))))
    }

    // MARK: - Schedule edits

    func testSetScheduleTimeRebuildsCron() {
        let model = model(.createDefault(.schedule))
        model.setScheduleTime(hour: 9, minute: 30)
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "30 9 * * *", timezone: "UTC"))
    }

    func testToggleScheduleDaySelectsOthersFromEmpty() {
        let model = model(.createDefault(.schedule))
        model.toggleScheduleDay(1)
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "0 8 * * 0,2,3,4,5,6", timezone: "UTC"))
    }

    func testToggleScheduleModeKeepsSimpleResetsAdvanced() {
        let model = model(.createDefault(.schedule))
        // Simple stays verbatim.
        model.toggleScheduleMode()
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
        // Advanced (non-parseable) resets to the simple seed.
        model.setScheduleCron("*/5 * * * *")
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "*/5 * * * *", timezone: "UTC"))
        model.toggleScheduleMode()
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "0 8 * * *", timezone: "UTC"))
    }

    func testSetScheduleTimezone() {
        let model = model(.createDefault(.schedule))
        model.setScheduleTimezone("America/New_York")
        XCTAssertEqual(model.trigger, .schedule(cronExpr: "0 8 * * *", timezone: "America/New_York"))
    }

    // MARK: - Event edits

    func testSetEventType() {
        let model = model(.createDefault(.event))
        model.setEventType(.chargeStart)
        XCTAssertEqual(model.trigger, .event(.chargeStart))
    }

    // MARK: - Geofence edits

    func testSetGeofencePlace() {
        let model = model(.createDefault(.geofence))
        model.setGeofencePlace(42)
        XCTAssertEqual(model.trigger, .geofence(placeID: 42, event: .enter, dwellMinutes: nil))
    }

    func testSetGeofenceEventSeedsAndClearsDwell() {
        let model = model(.createDefault(.geofence))
        model.setGeofenceEvent(.dwell)
        XCTAssertEqual(model.trigger, .geofence(placeID: 0, event: .dwell, dwellMinutes: 5))
        model.setGeofenceEvent(.exit)
        XCTAssertEqual(model.trigger, .geofence(placeID: 0, event: .exit, dwellMinutes: nil))
    }

    func testSetDwellMinutesClampsToOne() {
        let model = model(.geofence(placeID: 1, event: .dwell, dwellMinutes: 5))
        model.setDwellMinutes(12)
        XCTAssertEqual(model.trigger, .geofence(placeID: 1, event: .dwell, dwellMinutes: 12))
        model.setDwellMinutes(0)
        XCTAssertEqual(model.trigger, .geofence(placeID: 1, event: .dwell, dwellMinutes: 1))
    }

    // MARK: - Signal edits

    func testSetSignalPicksTypedDefault() {
        let model = model(.createDefault(.signal))
        model.setSignal("is_locked")
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "is_locked", op: .equals, value: .bool(true))))
        model.setSignal("state")
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "state", op: .equals, value: .text("online"))))
        model.setSignal("speed")
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "speed", op: .lessThan, value: .number(20))))
    }

    func testSetOperatorChangedDropsValue() {
        let model = model(.createDefault(.signal))
        model.setOperator(.changed)
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "battery_level", op: .changed, value: .none)))
    }

    func testSetOperatorReCoercesValue() {
        let model = model(.createDefault(.signal))
        model.setOperator(.greaterThanOrEqual)
        XCTAssertEqual(
            model.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .greaterThanOrEqual, value: .number(20)))
        )
    }

    func testSetSignalValueCoercesByType() {
        let numeric = model(.createDefault(.signal))
        numeric.setSignalValue("55")
        XCTAssertEqual(
            numeric.trigger,
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(55)))
        )

        let boolean = model(.signal(SignalTrigger(signal: "is_locked", op: .equals, value: .bool(true))))
        boolean.setSignalValue("false")
        XCTAssertEqual(boolean.trigger, .signal(SignalTrigger(signal: "is_locked", op: .equals, value: .bool(false))))

        let text = model(.signal(SignalTrigger(signal: "state", op: .equals, value: .text("online"))))
        text.setSignalValue("driving")
        XCTAssertEqual(text.trigger, .signal(SignalTrigger(signal: "state", op: .equals, value: .text("driving"))))
    }

    func testSetChangedOnlyToggles() {
        let model = model(.signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(30))))
        model.setChangedOnly(true)
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "battery_level", op: .changed, value: .none)))
        // Web parity: switching to `changed` drops `value_num`, so toggling back re-derives the
        // default (`value_num ?? 20`), not the prior 30.
        model.setChangedOnly(false)
        XCTAssertEqual(model.trigger, .signal(SignalTrigger(signal: "battery_level", op: .equals, value: .number(20))))
    }

    // MARK: - Reused option catalogs (web TRIGGER_TYPES / SIGNAL_OPERATORS / SIGNAL_FIELDS)

    func testReusedCatalogsCoverWebOptions() {
        XCTAssertEqual(TriggerTypeCatalog.all.count, 4)
        XCTAssertEqual(VehicleEventCatalog.all.count, 9)
        XCTAssertEqual(GeofenceEventCatalog.all.count, 3)
        XCTAssertEqual(SignalOperatorCatalog.all.count, 9)
        XCTAssertEqual(SignalCatalog.options.count, 9)
        XCTAssertEqual(TimezoneCatalog.all.count, 11)
        XCTAssertTrue(SignalCatalog.boolFieldKeys.contains("is_locked"))
    }
}
