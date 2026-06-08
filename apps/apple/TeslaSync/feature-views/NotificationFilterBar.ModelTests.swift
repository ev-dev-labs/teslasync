//
//  NotificationFilterBar.ModelTests.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  State-holder coverage for `NotificationFilterModel`, split from
//  NotificationFilterBar.Tests.swift for the lint length budget. Drives the model
//  through `InMemoryNotificationFilterSource` and the spies defined alongside the
//  adapter tests (same XCTest target): phase resolution, the P1/S11 `view.opened`
//  telemetry (once), the control intents (severity / vehicle / rule / query / dates),
//  chip removal, clear-all keeping the pass-through fields, the stale auto-refresh,
//  offline behavior, and adopting the parent's pushed filters. No network, no bundle.
//

import XCTest
@testable import TeslaSync

@MainActor final class NotificationFilterModelTests: XCTestCase {
    private struct Harness {
        let model: NotificationFilterModel
        let source: InMemoryNotificationFilterSource
        let telemetry: SpyNotificationFilterTelemetry
        let sink: SpyNotificationFilterChangeSink
    }

    private func vehicles() -> [NotificationVehicleOption] {
        [
            NotificationVehicleOption(id: 1, displayName: "Model 3"),
            NotificationVehicleOption(id: 2, displayName: "Model Y")
        ]
    }

    private func rules() -> [NotificationRuleOption] {
        [NotificationRuleOption(id: 10, name: "Low battery")]
    }

    private func makeHarness(initial: NotificationFilterUpdate?) -> Harness {
        let telemetry = SpyNotificationFilterTelemetry()
        let sink = SpyNotificationFilterChangeSink()
        let source = InMemoryNotificationFilterSource(initial: initial)
        let model = NotificationFilterModel(
            source: source,
            filters: initial?.filters ?? NotificationFilters(),
            telemetry: telemetry,
            changeSink: sink
        )
        return Harness(model: model, source: source, telemetry: telemetry, sink: sink)
    }

    private func loaded(
        connection: NotificationFilterConnection = .live,
        filters: NotificationFilters = NotificationFilters()
    ) -> NotificationFilterUpdate {
        NotificationFilterUpdate(
            status: .loaded,
            filters: filters,
            vehicles: vehicles(),
            rules: rules(),
            connection: connection
        )
    }

    // MARK: Lifecycle + phase

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces, ["NotificationFilterBar"])
        XCTAssertEqual(harness.source.startCount, 1)
        XCTAssertEqual(harness.model.phase, .content)
    }

    func testPhasesAcrossStatuses() {
        let content = makeHarness(initial: loaded())
        content.model.start()
        XCTAssertEqual(content.model.phase, .content)

        let empty = makeHarness(initial: NotificationFilterUpdate(status: .loaded))
        empty.model.start()
        XCTAssertEqual(empty.model.phase, .empty)

        let loading = makeHarness(initial: NotificationFilterUpdate(status: .loading))
        loading.model.start()
        XCTAssertEqual(loading.model.phase, .loading)

        let failed = makeHarness(initial: NotificationFilterUpdate(status: .failed("boom")))
        failed.model.start()
        XCTAssertEqual(failed.model.phase, .error("boom"))
    }

    // MARK: Control intents

    func testToggleSeverityUpdatesFiltersAndForwardsToSink() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.toggleSeverity(.warn)
        XCTAssertEqual(harness.model.filters.severity, [.warn])
        XCTAssertEqual(harness.sink.last?.severity, [.warn])
    }

    func testSetVehicleRuleAndQueryForwardToSink() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.setVehicle(2)
        XCTAssertEqual(harness.model.filters.selectedVehicleID, 2)
        harness.model.setRule(10)
        XCTAssertEqual(harness.model.filters.selectedRuleID, 10)
        harness.model.setQuery("sentry")
        XCTAssertEqual(harness.model.filters.query, "sentry")
        XCTAssertEqual(harness.sink.last?.query, "sentry")
    }

    func testSetDateRangeSetsBothEndpoints() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.setDateRange(from: "2026-01-01", to: "2026-03-01")
        XCTAssertEqual(harness.model.filters.from, "2026-01-01")
        XCTAssertEqual(harness.model.filters.to, "2026-03-01")
    }

    func testRemoveChipClearsBackingField() {
        let filters = NotificationFilters(
            severity: [.warn], vehicleIDs: [1], ruleIDs: [10], query: "x", from: "2026-01-01", to: "2026-02-01"
        )
        let harness = makeHarness(initial: loaded(filters: filters))
        harness.model.start()
        harness.model.removeChip(NotificationActiveChip(kind: .severity, label: "", value: ""))
        XCTAssertEqual(harness.model.filters.severity, [])
        harness.model.removeChip(NotificationActiveChip(kind: .vehicle, label: "", value: ""))
        XCTAssertEqual(harness.model.filters.vehicleIDs, [])
        harness.model.removeChip(NotificationActiveChip(kind: .query, label: "", value: ""))
        XCTAssertNil(harness.model.filters.query)
        harness.model.removeChip(NotificationActiveChip(kind: .to, label: "", value: ""))
        XCTAssertNil(harness.model.filters.to)
    }

    func testClearAllClearsBarFieldsKeepingPassThrough() {
        let filters = NotificationFilters(severity: [.warn], vehicleIDs: [1], query: "x", read: true, limit: 25)
        let harness = makeHarness(initial: loaded(filters: filters))
        harness.model.start()
        harness.model.clearAll()
        XCTAssertFalse(harness.model.filters.hasActiveBarFilters)
        XCTAssertEqual(harness.model.filters.read, true)
        XCTAssertEqual(harness.model.filters.limit, 25)
        XCTAssertEqual(harness.sink.last?.read, true)
    }

    // MARK: Freshness

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(loaded(connection: .live))
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineKeepsCachedOptionsAndDoesNotRefresh() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(connection: .offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
        XCTAssertEqual(harness.model.connection, .offline)
        XCTAssertEqual(harness.model.phase, .content)
    }

    func testApplyAdoptsParentPushedFilters() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(filters: NotificationFilters(severity: [.critical])))
        XCTAssertEqual(harness.model.filters.severity, [.critical])
        XCTAssertEqual(harness.model.activeChips.first?.kind, .severity)
    }

    func testStopAllowsTelemetryToReArm() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.stop()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces.count, 2)
        XCTAssertEqual(harness.source.stopCount, 1)
    }
}
