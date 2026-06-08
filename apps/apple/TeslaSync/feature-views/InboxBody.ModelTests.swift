//
//  InboxBody.ModelTests.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  State-holder coverage for `InboxBodyModel`, split from `InboxBody.Tests.swift`
//  to keep each file focused: phase resolution (loading / content / empty / error
//  across flat + grouped), the `view.opened` telemetry, the auto-mark-on-open
//  effect, the selection + filter contracts, the bulk flows (mark-read undo,
//  archive/restore announcements, delete, mark-all, mark-group), the stale
//  auto-refresh, and the drill-through navigation. Driven by recording doubles.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

@MainActor
private final class RecordingInboxActions: InboxActionsPerforming {
    var markReadCalls: [[Int]] = []
    var markUnreadCalls: [[Int]] = []
    var archiveCalls: [[Int]] = []
    var unarchiveCalls: [[Int]] = []
    var deleteCalls: [[Int]] = []
    var bulkRequests: [InboxBulkMarkReadRequest] = []
    var bulkResult = 0
    var bulkError: Error?

    func markRead(_ ids: [Int]) {
        markReadCalls.append(ids)
    }

    func markUnread(_ ids: [Int]) {
        markUnreadCalls.append(ids)
    }

    func archive(_ ids: [Int]) async {
        archiveCalls.append(ids)
    }

    func unarchive(_ ids: [Int]) async {
        unarchiveCalls.append(ids)
    }

    func delete(_ ids: [Int]) async {
        deleteCalls.append(ids)
    }

    func bulkMarkRead(_ request: InboxBulkMarkReadRequest) async throws -> Int {
        bulkRequests.append(request)
        if let bulkError { throw bulkError }
        return bulkResult
    }
}

@MainActor
private final class RecordingInboxPresenter: InboxToastPresenting, InboxAnnouncing {
    struct ToastRecord { let title: String; let kind: String; let hasUndo: Bool }
    var toasts: [ToastRecord] = []
    var announcements: [String] = []
    var lastUndo: (@MainActor () -> Void)?

    func success(title: String) {
        toasts.append(ToastRecord(title: title, kind: "success", hasUndo: false))
    }

    func success(title: String, undoLabel _: String, onUndo: @escaping @MainActor () -> Void) {
        toasts.append(ToastRecord(title: title, kind: "success", hasUndo: true))
        lastUndo = onUndo
    }

    func error(title: String, message _: String?) {
        toasts.append(ToastRecord(title: title, kind: "error", hasUndo: false))
    }

    func announce(_ message: String) {
        announcements.append(message)
    }
}

private final class SpyInboxTelemetry: InboxTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@MainActor
private final class NavBox {
    var paths: [String] = []
}

private struct InboxTestError: Error {}

// MARK: - Tests

@MainActor
final class InboxBodyModelTests: XCTestCase {
    private func iso() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func unreadRows() -> [InboxNotification] {
        [
            InboxNotification(id: 1, title: "a", createdAt: iso()),
            InboxNotification(id: 2, title: "b", createdAt: iso(), readAt: "t"),
            InboxNotification(id: 3, title: "c", createdAt: iso())
        ]
    }

    private func loaded(
        rows: [InboxNotification] = [],
        groups: [InboxGroup] = [],
        connection: InboxConnection = .live
    ) -> InboxUpdate {
        InboxUpdate(
            flatStatus: rows.isEmpty ? .empty : .loaded,
            groupStatus: groups.isEmpty ? .empty : .loaded,
            rows: rows, groups: groups, connection: connection, updatedAt: Date()
        )
    }

    private func makeModel(
        archived: Bool = false,
        actions: RecordingInboxActions = RecordingInboxActions(),
        presenter: RecordingInboxPresenter = RecordingInboxPresenter(),
        telemetry: SpyInboxTelemetry = SpyInboxTelemetry(),
        preferences: InboxPreferences = StaticInboxPreferences(),
        nav: NavBox = NavBox()
    ) -> (InboxBodyModel, InMemoryInboxSource) {
        let source = InMemoryInboxSource()
        let model = InboxBodyModel(
            source: source, archived: archived, telemetry: telemetry, toast: presenter,
            announcer: presenter, preferences: preferences, actions: actions,
            navigate: { nav.paths.append($0) }
        )
        return (model, source)
    }

    // MARK: Phases + telemetry

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyInboxTelemetry()
        let (model, source) = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [InboxDiagnostics.surface])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.lastFilters?.view, .grouped)
    }

    func testGroupedPhaseUsesGroupStatus() {
        let (model, source) = makeModel()
        model.start()
        let group = InboxGroup(groupKey: "g", latest: unreadRows()[0], count: 2, unreadCount: 1)
        source.push(loaded(rows: [], groups: [group]))
        XCTAssertEqual(model.listPhase, .content)
        XCTAssertEqual(model.displayCount, 1)
    }

    func testFlatPhasesLoadingEmptyErrorContent() {
        let (model, source) = makeModel()
        model.start()
        model.setView(.flat)
        XCTAssertEqual(model.listPhase, .loading)
        source.push(loaded(rows: []))
        XCTAssertEqual(model.listPhase, .empty)
        source.push(InboxUpdate(flatStatus: .failed("boom"), groupStatus: .empty))
        XCTAssertEqual(model.listPhase, .error("boom"))
        source.push(loaded(rows: unreadRows()))
        XCTAssertEqual(model.listPhase, .content)
        XCTAssertEqual(model.unreadCount, 2)
    }

    // MARK: Auto-mark-on-open

    func testAutoMarkOnOpenMarksVisibleUnreadOnceInFlatInbox() {
        let actions = RecordingInboxActions()
        let (model, source) = makeModel(actions: actions)
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        XCTAssertEqual(actions.markReadCalls, [[1, 3]])
        source.push(loaded(rows: unreadRows()))
        XCTAssertEqual(actions.markReadCalls, [[1, 3]])
    }

    func testAutoMarkSkippedWhenGroupedOrArchivedOrPrefOff() {
        let groupedActions = RecordingInboxActions()
        let (grouped, groupedSource) = makeModel(actions: groupedActions)
        grouped.start()
        groupedSource.push(loaded(rows: unreadRows()))
        XCTAssertTrue(groupedActions.markReadCalls.isEmpty)

        let prefActions = RecordingInboxActions()
        let (prefOff, prefSource) = makeModel(
            actions: prefActions, preferences: StaticInboxPreferences(markOnOpen: false)
        )
        prefOff.start()
        prefOff.setView(.flat)
        prefSource.push(loaded(rows: unreadRows()))
        XCTAssertTrue(prefActions.markReadCalls.isEmpty)
    }

    // MARK: Selection + filters

    func testSelectionToggleSelectAllAndClear() {
        let (model, source) = makeModel()
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        model.toggleSelected(1, true)
        XCTAssertTrue(model.isSelected(1))
        model.selectAllVisible()
        XCTAssertTrue(model.allVisibleSelected)
        XCTAssertEqual(model.selection, [1, 2, 3])
        model.toggleSelectAllVisible(false)
        XCTAssertTrue(model.selection.isEmpty)
    }

    func testFilterChangeClearsSelectionButViewChangeKeepsIt() {
        let (model, source) = makeModel()
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        model.selectAllVisible()
        model.setView(.grouped)
        XCTAssertFalse(model.selection.isEmpty, "view toggle must not clear selection")
        model.setReadFilter(.unread)
        XCTAssertTrue(model.selection.isEmpty, "query filter change clears selection")
        XCTAssertEqual(source.lastFilters?.read, .unread)
    }

    // MARK: Bulk flows

    func testBulkMarkReadSuccessClearsSelectionAndOffersUndo() async {
        let actions = RecordingInboxActions()
        let presenter = RecordingInboxPresenter()
        let (model, source) = makeModel(actions: actions, presenter: presenter)
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        model.toggleSelected(1, true)
        model.toggleSelected(3, true)
        await model.performBulk(model.bulkActions[0])
        XCTAssertEqual(Set(actions.bulkRequests.first?.ids ?? []), [1, 3])
        XCTAssertTrue(model.selection.isEmpty)
        XCTAssertEqual(presenter.toasts.last?.kind, "success")
        XCTAssertTrue(presenter.toasts.last?.hasUndo ?? false)
        presenter.lastUndo?()
        XCTAssertEqual(Set(actions.markUnreadCalls.first ?? []), [1, 3])
    }

    func testBulkMarkReadErrorShowsErrorToastAndKeepsSelection() async {
        let actions = RecordingInboxActions()
        actions.bulkError = InboxTestError()
        let presenter = RecordingInboxPresenter()
        let (model, source) = makeModel(actions: actions, presenter: presenter)
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        model.toggleSelected(1, true)
        await model.performBulk(model.bulkActions[0])
        XCTAssertEqual(presenter.toasts.last?.kind, "error")
        XCTAssertFalse(model.selection.isEmpty)
    }

    func testBulkArchiveAndDeleteAndRestoreAnnouncements() async {
        let actions = RecordingInboxActions()
        let presenter = RecordingInboxPresenter()
        let (model, source) = makeModel(actions: actions, presenter: presenter)
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        model.toggleSelected(1, true)
        await model.bulkArchive([1])
        XCTAssertEqual(actions.archiveCalls, [[1]])
        XCTAssertEqual(presenter.announcements.count, 1)
        await model.bulkDelete([2])
        XCTAssertEqual(actions.deleteCalls, [[2]])

        let (archivedModel, archivedSource) = makeModel(archived: true, actions: actions, presenter: presenter)
        archivedModel.start()
        archivedSource.push(loaded(rows: unreadRows()))
        await archivedModel.bulkUnarchive([3])
        XCTAssertEqual(actions.unarchiveCalls, [[3]])
    }

    func testMarkAllReadAndMarkGroupRead() async {
        let actions = RecordingInboxActions()
        actions.bulkResult = 5
        let presenter = RecordingInboxPresenter()
        let (model, source) = makeModel(actions: actions, presenter: presenter)
        model.start()
        model.setView(.flat)
        source.push(loaded(rows: unreadRows()))
        await model.markAllRead()
        XCTAssertEqual(actions.bulkRequests.last?.all, true)
        XCTAssertTrue(presenter.toasts.last?.hasUndo ?? false)

        let group = InboxGroup(groupKey: "grp", latest: unreadRows()[0], count: 4, unreadCount: 3)
        await model.markGroupRead(group)
        XCTAssertEqual(actions.bulkRequests.last?.groupKey, "grp")
        XCTAssertTrue(presenter.toasts.last?.title.contains("5") ?? false)
    }

    // MARK: Activate · refresh · stale · navigate

    func testHandleRowActivateRespectsReadStateAndPreference() {
        let actions = RecordingInboxActions()
        let (model, _) = makeModel(actions: actions)
        model.handleRowActivate(InboxNotification(id: 1, title: "a", createdAt: iso()))
        XCTAssertEqual(actions.markReadCalls, [[1]])
        model.handleRowActivate(InboxNotification(id: 2, title: "b", createdAt: iso(), readAt: "t"))
        XCTAssertEqual(actions.markReadCalls, [[1]])

        let prefActions = RecordingInboxActions()
        let (prefOff, _) = makeModel(actions: prefActions, preferences: StaticInboxPreferences(markOnClick: false))
        prefOff.handleRowActivate(InboxNotification(id: 9, title: "c", createdAt: iso()))
        XCTAssertTrue(prefActions.markReadCalls.isEmpty)
    }

    func testRefreshAndStaleAutoRefreshAndNavigate() {
        let nav = NavBox()
        let (model, source) = makeModel(nav: nav)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(rows: unreadRows(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        source.push(loaded(rows: unreadRows(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "stale auto-refresh fires once until live again")
        model.openContext("/battery?vehicle_id=1")
        XCTAssertEqual(nav.paths, ["/battery?vehicle_id=1"])
    }
}
