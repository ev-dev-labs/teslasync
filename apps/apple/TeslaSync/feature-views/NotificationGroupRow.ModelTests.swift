//
//  NotificationGroupRow.ModelTests.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  Observable state-holder coverage for `NotificationGroupRowModel`: phase across
//  loading / loaded / empty / failed, the P1/S11 `view.opened` telemetry (once),
//  lazy member load on expand (once, gated) + the member region phases, singleton
//  inertness, the group mark-read toast paths (success / failure / singleton no-op),
//  the stale auto-refresh (once, re-armed), and offline keeping the cached thread.
//  Driven through the in-memory source — no network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum NotificationGroupRowFixture {
    static let date = Date(timeIntervalSince1970: 1_733_600_000)

    static func log(_ identifier: Int, read: Bool = false) -> NotificationLogInput {
        NotificationLogInput(
            id: identifier,
            title: "Battery temperature high",
            message: "Details",
            severityRaw: "critical",
            createdAt: date,
            isRead: read,
            isArchived: false,
            vehicleName: "Model 3",
            ruleName: "Battery high"
        )
    }

    static func group(
        key: String? = "abc",
        count: Int = 5,
        unread: Int = 3,
        vehicles: Int = 2
    ) -> NotificationGroupInput {
        NotificationGroupInput(
            groupKey: key,
            latest: log(1),
            count: count,
            unreadCount: unread,
            vehicleAffectedCount: vehicles
        )
    }
}

// MARK: - Model

@MainActor final class NotificationGroupRowModelTests: XCTestCase {
    private func makeModel(
        initial: NotificationGroupUpdate?,
        members: NotificationMembersUpdate? = nil,
        markRead: NotificationGroupMarkReadResult = .success(updated: 3),
        telemetry: NotificationGroupRowTelemetry = NotificationGroupRowSpyTelemetry()
    ) -> (NotificationGroupRowModel, InMemoryNotificationGroupRowSource) {
        let source = InMemoryNotificationGroupRowSource(
            initial: initial,
            membersResult: members,
            markReadResult: markRead
        )
        let model = NotificationGroupRowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsGroup() {
        let (model, source) = makeModel(
            initial: NotificationGroupUpdate(
                status: .loaded,
                group: NotificationGroupRowFixture.group(),
                connection: .live
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.group?.count, 5)
        XCTAssertEqual(model.group?.unreadCount, 3)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedNoGroupResolvesEmpty() {
        let (model, _) = makeModel(initial: NotificationGroupUpdate(status: .loaded, group: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.group)
    }

    func testLoadingThenFailed() {
        let (model, source) = makeModel(initial: NotificationGroupUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(NotificationGroupUpdate(status: .failed("timeout")))
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testArchivedModeSuppressesMarkRead() {
        let (model, _) = makeModel(
            initial: NotificationGroupUpdate(
                status: .loaded,
                group: NotificationGroupRowFixture.group(),
                archived: true
            )
        )
        model.start()
        XCTAssertEqual(model.group?.canMarkGroupRead, false)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = NotificationGroupRowSpyTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [NotificationGroupRowSurface.slug])
    }

    func testExpandTriggersLazyMemberLoadOnce() {
        let members = NotificationMembersUpdate(
            status: .loaded,
            members: [
                NotificationGroupRowFixture.log(1),
                NotificationGroupRowFixture.log(2),
                NotificationGroupRowFixture.log(3)
            ]
        )
        let (model, source) = makeModel(
            initial: NotificationGroupUpdate(status: .loaded, group: NotificationGroupRowFixture.group()),
            members: members
        )
        model.start()
        model.toggleExpanded()
        XCTAssertTrue(model.expanded)
        XCTAssertEqual(source.loadMembersCount, 1)
        guard case let .loaded(rows) = model.membersPhase else {
            XCTFail("expected loaded")
            return
        }
        XCTAssertEqual(rows.map(\.id), [2, 3]) // latest (id 1) filtered out
        // collapse + re-expand must NOT refetch
        model.toggleExpanded()
        model.toggleExpanded()
        XCTAssertEqual(source.loadMembersCount, 1)
    }

    func testExpandShowsLoadingWhenMembersPending() {
        let (model, source) = makeModel(
            initial: NotificationGroupUpdate(status: .loaded, group: NotificationGroupRowFixture.group()),
            members: nil
        )
        model.start()
        model.toggleExpanded()
        XCTAssertEqual(model.membersPhase, .loading)
        source.pushMembers(NotificationMembersUpdate(status: .failed("nope"), members: []))
        XCTAssertEqual(model.membersPhase, .error("nope"))
    }

    func testSingletonCannotExpand() {
        let (model, source) = makeModel(
            initial: NotificationGroupUpdate(
                status: .loaded,
                group: NotificationGroupRowFixture.group(key: nil, count: 1, unread: 1)
            )
        )
        model.start()
        model.toggleExpanded()
        XCTAssertFalse(model.expanded)
        XCTAssertEqual(source.loadMembersCount, 0)
        XCTAssertEqual(model.membersPhase, .idle)
    }

    func testMarkGroupReadSuccessRaisesToast() async {
        let (model, source) = makeModel(
            initial: NotificationGroupUpdate(status: .loaded, group: NotificationGroupRowFixture.group()),
            markRead: .success(updated: 4)
        )
        model.start()
        await model.markGroupRead()
        XCTAssertEqual(source.markReadCount, 1)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.message, "Marked 4 thread members as read")
        XCTAssertFalse(model.marking)
    }

    func testMarkGroupReadFailureRaisesErrorToast() async {
        let (model, _) = makeModel(
            initial: NotificationGroupUpdate(status: .loaded, group: NotificationGroupRowFixture.group()),
            markRead: .failure(message: "500")
        )
        model.start()
        await model.markGroupRead()
        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertTrue(model.toast?.message.contains("Could not mark group as read") ?? false)
        XCTAssertTrue(model.toast?.message.contains("500") ?? false)
    }

    func testMarkGroupReadNoOpForSingleton() async {
        let (model, source) = makeModel(
            initial: NotificationGroupUpdate(
                status: .loaded,
                group: NotificationGroupRowFixture.group(key: nil, count: 1, unread: 1)
            )
        )
        model.start()
        await model.markGroupRead()
        XCTAssertEqual(source.markReadCount, 0)
        XCTAssertNil(model.toast)
    }

    func testDismissToastClears() async {
        let (model, _) = makeModel(initial: NotificationGroupUpdate(
            status: .loaded,
            group: NotificationGroupRowFixture.group()
        ))
        model.start()
        await model.markGroupRead()
        XCTAssertNotNil(model.toast)
        model.dismissToast()
        XCTAssertNil(model.toast)
    }

    func testStaleAutoRefreshesExactlyOnceAndReArms() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(NotificationGroupUpdate(
            status: .loaded,
            group: NotificationGroupRowFixture.group(),
            connection: .stale
        ))
        source.push(NotificationGroupUpdate(
            status: .loaded,
            group: NotificationGroupRowFixture.group(),
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(NotificationGroupUpdate(
            status: .loaded,
            group: NotificationGroupRowFixture.group(),
            connection: .live
        ))
        source.push(NotificationGroupUpdate(
            status: .loaded,
            group: NotificationGroupRowFixture.group(),
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(model.connection, .stale)
    }

    func testOfflineKeepsCachedThreadWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(NotificationGroupUpdate(
            status: .loaded,
            group: NotificationGroupRowFixture.group(),
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRetryRefreshesAndStopStops() {
        let (model, source) = makeModel(initial: NotificationGroupUpdate(status: .failed("x")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Test doubles

/// Records the surfaces a model reports as opened.
private final class NotificationGroupRowSpyTelemetry: NotificationGroupRowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
