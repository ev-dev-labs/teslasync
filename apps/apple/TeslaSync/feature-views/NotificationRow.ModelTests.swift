//
//  NotificationRow.ModelTests.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  Observable state-holder coverage for `NotificationRowModel`: phase across loading /
//  loaded / empty / failed, the P1/S11 `view.opened` telemetry (once), the selection
//  toggle (optimistic + source-notified, and snapshot-driven), the capability-gated
//  activation, the drill-through navigation intent, the per-row mark-read / mark-unread
//  / archive / restore actions (routing + busy clear + failure toast), the stale
//  auto-refresh (once, re-armed), and offline keeping the cached row. Driven through
//  the in-memory source — no network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum NotificationRowFixture {
    static let date = Date(timeIntervalSince1970: 1_733_600_000)

    static func input(
        id: Int = 1,
        read: Bool = false,
        archived: Bool = false,
        hasRule: Bool = true,
        signal: String? = "BatteryLevel"
    ) -> NotificationRowInput {
        NotificationRowInput(
            id: id,
            title: "Battery temperature high",
            message: "Details",
            severityRaw: "critical",
            createdAt: date,
            isRead: read,
            isArchived: archived,
            vehicleName: "Model 3",
            ruleName: hasRule ? "Battery high" : nil,
            hasRule: hasRule,
            ruleSignal: signal,
            drillVehicleID: 7,
            createdAtISO: "2024-12-07T18:13:20Z"
        )
    }
}

// MARK: - Model

@MainActor final class NotificationRowModelTests: XCTestCase {
    private func makeModel(
        initial: NotificationRowUpdate?,
        actionResult: NotificationRowActionResult = .success,
        telemetry: NotificationRowTelemetry = NotificationRowSpyTelemetry()
    ) -> (NotificationRowModel, InMemoryNotificationRowSource) {
        let source = InMemoryNotificationRowSource(initial: initial, actionResult: actionResult)
        let model = NotificationRowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsRow() {
        let (model, source) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(), connection: .live)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.row?.id, 1)
        XCTAssertEqual(model.row?.severity, .critical)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedNoRowResolvesEmpty() {
        let (model, _) = makeModel(initial: NotificationRowUpdate(status: .loaded, row: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.row)
    }

    func testLoadingThenFailed() {
        let (model, source) = makeModel(initial: NotificationRowUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(NotificationRowUpdate(status: .failed("timeout")))
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = NotificationRowSpyTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [NotificationRowSurface.slug])
    }

    func testSelectionTogglesOptimisticallyAndNotifiesSource() {
        let (model, source) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input())
        )
        model.start()
        XCTAssertFalse(model.selected)
        model.setSelected(true)
        XCTAssertTrue(model.selected)
        XCTAssertEqual(source.lastSelection, true)
    }

    func testSelectionReflectsSnapshot() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(), selected: true))
        XCTAssertTrue(model.selected)
    }

    func testCapabilitiesReflectSnapshot() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(NotificationRowUpdate(
            status: .loaded,
            row: NotificationRowFixture.input(),
            capabilities: NotificationRowCapabilities(markRead: false, activate: false)
        ))
        XCTAssertFalse(model.capabilities.markRead)
        XCTAssertFalse(model.capabilities.activate)
    }

    func testActivateGatedByCapability() {
        let (model, source) = makeModel(initial: NotificationRowUpdate(
            status: .loaded,
            row: NotificationRowFixture.input(),
            capabilities: NotificationRowCapabilities(activate: true)
        ))
        model.start()
        model.activate()
        XCTAssertEqual(source.activateCount, 1)
    }

    func testActivateNoOpWhenCapabilityDisabled() {
        let (model, source) = makeModel(initial: NotificationRowUpdate(
            status: .loaded,
            row: NotificationRowFixture.input(),
            capabilities: NotificationRowCapabilities(activate: false)
        ))
        model.start()
        model.activate()
        XCTAssertEqual(source.activateCount, 0)
    }

    func testOpenContextUsesResolvedDrillthrough() {
        let (model, source) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(signal: "ChargeState"))
        )
        model.start()
        model.openContext()
        XCTAssertEqual(source.openedContext?.path, "/charging")
    }

    func testOpenContextNoOpWithoutRule() {
        let (model, source) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(hasRule: false))
        )
        model.start()
        model.openContext()
        XCTAssertNil(source.openedContext)
    }

    func testMarkReadRoutesAndClearsBusy() async {
        let (model, source) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input())
        )
        model.start()
        await model.markRead()
        XCTAssertEqual(source.actionCounts[.markRead], 1)
        XCTAssertNil(model.busy)
        XCTAssertNil(model.toast)
    }

    func testMarkUnreadArchiveAndRestoreRouteToSource() async {
        let (model, source) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(read: true))
        )
        model.start()
        await model.markUnread()
        await model.archive()
        await model.unarchive()
        XCTAssertEqual(source.actionCounts[.markUnread], 1)
        XCTAssertEqual(source.actionCounts[.archive], 1)
        XCTAssertEqual(source.actionCounts[.unarchive], 1)
    }

    func testActionFailureRaisesErrorToast() async {
        let (model, _) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input()),
            actionResult: .failure(message: "500")
        )
        model.start()
        await model.markRead()
        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertTrue(model.toast?.message.contains("Couldn't update notification") ?? false)
        XCTAssertTrue(model.toast?.message.contains("500") ?? false)
    }

    func testDismissToastClears() async {
        let (model, _) = makeModel(
            initial: NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input()),
            actionResult: .failure(message: nil)
        )
        model.start()
        await model.markRead()
        XCTAssertNotNil(model.toast)
        model.dismissToast()
        XCTAssertNil(model.toast)
    }

    func testStaleAutoRefreshesExactlyOnceAndReArms() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(), connection: .stale))
        source.push(NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(), connection: .live))
        source.push(NotificationRowUpdate(status: .loaded, row: NotificationRowFixture.input(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(model.connection, .stale)
    }

    func testOfflineKeepsCachedRowWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(NotificationRowUpdate(
            status: .loaded,
            row: NotificationRowFixture.input(),
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRetryRefreshesAndStopStops() {
        let (model, source) = makeModel(initial: NotificationRowUpdate(status: .failed("x")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Test doubles

/// Records the surfaces a model reports as opened.
private final class NotificationRowSpyTelemetry: NotificationRowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
