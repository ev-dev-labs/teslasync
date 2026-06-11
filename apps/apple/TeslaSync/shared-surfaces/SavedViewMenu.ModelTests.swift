//
//  SavedViewMenu.ModelTests.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  State-holder coverage for the SavedViewMenu surface:
//    • Lifecycle — `view.opened` emitted exactly once (P1/S11); start / stop delegation.
//    • Auto-apply — the default view applied once when the URL has no query (web auto-apply effect),
//      never overriding a deep-link, never re-applying, and retried when no default is present yet.
//    • Apply / clear — re-apply through the snapshot `onApply`, close the popover, announce.
//    • Mutations — save / rename / delete / pin / default route through the seam with the right
//      arguments, close their dialog on success, keep it open on failure / blank / unchanged input.
//    • Connection — the stale one-shot auto-refresh (re-armed on live) + offline never refreshes.
//
//  These run in the TeslaSync(/-macOS) XCTest targets; the source + mutation seams are in-memory.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

@MainActor private final class Recorder {
    var messages: [String] = []
}

private final class SpyTelemetry: SavedViewMenuTelemetry, @unchecked Sendable {
    private(set) var count = 0
    func viewOpened(surface _: String) {
        count += 1
    }
}

@MainActor private final class CountingSource: SavedViewMenuSource {
    var onUpdate: (@MainActor (SavedViewMenuInput) -> Void)?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var refreshCount = 0

    func start() {
        startCount += 1
    }

    func stop() {
        stopCount += 1
    }

    func refresh() {
        refreshCount += 1
    }

    func push(_ input: SavedViewMenuInput) {
        onUpdate?(input)
    }
}

private func modelView(
    _ id: Int,
    _ name: String,
    query: String = "",
    isDefault: Bool = false,
    isPinned: Bool = false
) -> SavedView {
    SavedView(
        id: id, name: name, route: "/drives", query: query,
        isDefault: isDefault, isPinned: isPinned, sortOrder: id
    )
}

@MainActor
private func snapshot(_ views: [SavedView], connection: SavedViewMenuConnection) -> SavedViewMenuInput {
    SavedViewMenuInput(views: views, route: "/drives", currentQuery: "", connection: connection)
}

// MARK: - Lifecycle + auto-apply

@MainActor
final class SavedViewMenuLifecycleTests: XCTestCase {
    func testViewOpenedEmittedOnce() {
        let store = InMemorySavedViewMenuStore(views: [modelView(1, "A")])
        let telemetry = SpyTelemetry()
        let model = SavedViewMenuModel(source: store, mutations: store, telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(telemetry.count, 1)
    }

    func testStartStopDelegates() {
        let source = CountingSource()
        let model = SavedViewMenuModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testAutoAppliesDefaultWhenNoQuery() {
        let store = InMemorySavedViewMenuStore(
            views: [modelView(1, "A", query: "q=1", isDefault: true)],
            currentQuery: ""
        )
        let model = SavedViewMenuModel(source: store, mutations: store)
        model.start()
        XCTAssertEqual(store.appliedQueries, ["q=1"])
    }

    func testDoesNotOverrideDeepLink() {
        let store = InMemorySavedViewMenuStore(
            views: [modelView(1, "A", query: "q=1", isDefault: true)],
            currentQuery: "q=existing"
        )
        let model = SavedViewMenuModel(source: store, mutations: store)
        model.start()
        XCTAssertEqual(store.appliedQueries, [])
    }

    func testDoesNotAutoApplyWithoutDefault() {
        let store = InMemorySavedViewMenuStore(views: [modelView(1, "A", query: "q=1")], currentQuery: "")
        let model = SavedViewMenuModel(source: store, mutations: store)
        model.start()
        XCTAssertEqual(store.appliedQueries, [])
    }

    func testAutoApplyHappensOnlyOnce() {
        let store = InMemorySavedViewMenuStore(
            views: [modelView(1, "A", query: "q=1", isDefault: true)],
            currentQuery: ""
        )
        let model = SavedViewMenuModel(source: store, mutations: store)
        model.start()
        model.refresh()
        XCTAssertEqual(store.appliedQueries, ["q=1"])
    }
}

// MARK: - Apply / clear

@MainActor
final class SavedViewMenuApplyTests: XCTestCase {
    func testApplyClosesMenuAndAnnounces() {
        let store = InMemorySavedViewMenuStore(views: [modelView(1, "Trips", query: "q=1")])
        let model = SavedViewMenuModel(source: store, mutations: store)
        let recorder = Recorder()
        model.bindAnnouncer { recorder.messages.append($0) }
        model.start()
        model.isMenuPresented = true
        let row = model.resolved.rows[0]
        model.apply(row)
        XCTAssertEqual(store.appliedQueries.last, "q=1")
        XCTAssertFalse(model.isMenuPresented)
        XCTAssertEqual(recorder.messages.last, "View Trips applied")
    }

    func testClearAppliedAnnounces() {
        let store = InMemorySavedViewMenuStore(views: [modelView(1, "Trips", query: "q=1")], currentQuery: "q=1")
        let model = SavedViewMenuModel(source: store, mutations: store)
        let recorder = Recorder()
        model.bindAnnouncer { recorder.messages.append($0) }
        model.start()
        model.clearApplied()
        XCTAssertEqual(store.appliedQueries.last, "")
        XCTAssertEqual(recorder.messages.last, "Saved view cleared")
    }
}

// MARK: - Mutations (save / rename / delete / pin / default)

@MainActor
final class SavedViewMenuMutationTests: XCTestCase {
    private func loadedModel(_ spy: SpySavedViewMenuMutations) -> (SavedViewMenuModel, SavedViewRow) {
        let store = InMemorySavedViewMenuStore(views: [modelView(1, "Trips", query: "q=1")], currentQuery: "")
        let model = SavedViewMenuModel(source: store, mutations: spy)
        model.start()
        return (model, model.resolved.rows[0])
    }

    func testSaveCreatesAndCloses() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let store = InMemorySavedViewMenuStore(views: [], currentQuery: "range=month")
        let model = SavedViewMenuModel(source: store, mutations: spy)
        model.start()
        model.presentSaveDialog()
        await model.save(name: "  New  ", makeDefault: true)
        XCTAssertEqual(spy.calls.count, 1)
        XCTAssertEqual(spy.calls.first?.kind, "create")
        XCTAssertEqual(spy.calls.first?.detail, "New|default=true")
        XCTAssertFalse(model.isSaveDialogPresented)
        XCTAssertFalse(model.isSaving)
    }

    func testSaveBlankNameIsNoop() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let store = InMemorySavedViewMenuStore(views: [], currentQuery: "")
        let model = SavedViewMenuModel(source: store, mutations: spy)
        model.start()
        model.presentSaveDialog()
        await model.save(name: "   ", makeDefault: false)
        XCTAssertTrue(spy.calls.isEmpty)
        XCTAssertTrue(model.isSaveDialogPresented)
    }

    func testSaveFailureKeepsDialogOpen() async {
        let spy = SpySavedViewMenuMutations(result: false)
        let store = InMemorySavedViewMenuStore(views: [], currentQuery: "")
        let model = SavedViewMenuModel(source: store, mutations: spy)
        model.start()
        model.presentSaveDialog()
        await model.save(name: "New", makeDefault: false)
        XCTAssertEqual(spy.calls.count, 1)
        XCTAssertTrue(model.isSaveDialogPresented)
    }

    func testRenameUpdatesAndCloses() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let (model, row) = loadedModel(spy)
        model.presentRename(row)
        XCTAssertNotNil(model.renameTarget)
        await model.rename(row, to: "Renamed")
        XCTAssertEqual(spy.calls.first?.kind, "update")
        XCTAssertEqual(spy.calls.first?.id, row.id)
        XCTAssertNil(model.renameTarget)
    }

    func testRenameUnchangedIsNoop() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let (model, row) = loadedModel(spy)
        model.presentRename(row)
        await model.rename(row, to: row.name)
        XCTAssertTrue(spy.calls.isEmpty)
        XCTAssertNil(model.renameTarget)
    }

    func testConfirmDeleteDeletesAndCloses() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let (model, row) = loadedModel(spy)
        model.requestDelete(row)
        await model.confirmDelete()
        XCTAssertEqual(spy.calls.first?.kind, "delete")
        XCTAssertEqual(spy.calls.first?.id, row.id)
        XCTAssertNil(model.deleteTarget)
    }

    func testTogglePinSendsToggledFlag() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let (model, row) = loadedModel(spy)
        await model.togglePin(row)
        XCTAssertEqual(spy.calls.first?.kind, "update")
        XCTAssertEqual(spy.calls.first?.detail, "name=|pin=true")
    }

    func testToggleDefaultSendsToggledFlag() async {
        let spy = SpySavedViewMenuMutations(result: true)
        let (model, row) = loadedModel(spy)
        await model.toggleDefault(row)
        XCTAssertEqual(spy.calls.first?.kind, "setDefault")
        XCTAssertEqual(spy.calls.first?.detail, "default=true")
    }
}

// MARK: - Connection (stale auto-refresh + offline)

@MainActor
final class SavedViewMenuConnectionTests: XCTestCase {
    func testStaleAutoRefreshesOnceAndReArms() {
        let source = CountingSource()
        let model = SavedViewMenuModel(source: source)
        model.start()
        source.push(snapshot([modelView(1, "A")], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(snapshot([modelView(1, "A")], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(snapshot([modelView(1, "A")], connection: .live))
        source.push(snapshot([modelView(1, "A")], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = CountingSource()
        let model = SavedViewMenuModel(source: source)
        model.start()
        source.push(snapshot([modelView(1, "A")], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
