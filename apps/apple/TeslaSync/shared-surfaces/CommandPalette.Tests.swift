//
//  CommandPalette.Tests.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The state-holder coverage (the @Observable model): the once-only `view.opened`, the snapshot → phase fold
//  (loading / content / error) + the freshness axis (stale auto-refreshes ONCE), open / close / goBack, the
//  controlled query + scope reconstruction, the debounced + scope-gated live search, the keyboard navigation
//  (web `handleInputKey` + Esc), and the activation routing (web action callbacks → the runner + the usage
//  record). The pure projection lives in CommandPalette.AdapterTests.swift + CommandPalette.ItemsTests.swift;
//  the views + strings live in CommandPalette.ViewTests.swift. These run in the TeslaSync(/-macOS) XCTest
//  targets; the only data source is the injected in-memory source.
//

import XCTest
@testable import TeslaSync

@MainActor
final class CommandPaletteModelTests: XCTestCase {
    private struct Harness {
        let model: CommandPaletteModel
        let source: InMemoryCommandPaletteSource
        let runner: InMemoryCommandPaletteRunner
        let spy: SpyCommandPaletteTelemetry
    }

    private func makeHarness(
        snapshot: CommandPaletteSnapshot = CommandPaletteTestSupport.snapshot(),
        searchProvider: @escaping (String) -> [PaletteSearchHit] = { _ in [] },
        debounce: Duration = .zero
    ) -> Harness {
        let source = InMemoryCommandPaletteSource(snapshot: snapshot, searchProvider: searchProvider)
        let runner = InMemoryCommandPaletteRunner()
        let spy = SpyCommandPaletteTelemetry()
        let model = CommandPaletteModel(
            source: source, runner: runner, telemetry: spy,
            copyProvider: { CommandPaletteTestSupport.copy() }, searchDebounce: debounce,
            now: { Date(timeIntervalSince1970: 1_000_000) }
        )
        return Harness(model: model, source: source, runner: runner, spy: spy)
    }

    private func navItem(_ path: String) -> PaletteItem {
        PaletteItem(id: path, label: path, section: "S", iconName: "c", kind: .navigate, action: .navigate(path: path))
    }

    private func commandItem(_ command: String) -> PaletteItem {
        PaletteItem(
            id: "cmd-\(command)",
            label: command,
            section: "",
            iconName: "c",
            kind: .command,
            action: .selectCommand(command: command)
        )
    }

    // MARK: Lifecycle

    func testViewOpenedEmittedOnceAcrossRestart() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.stop()
        harness.model.start()
        XCTAssertEqual(harness.spy.surfaces, ["CommandPalette"])
    }

    func testPhaseLoadingContentError() {
        let loading = makeHarness(snapshot: CommandPaletteSnapshot(isLoading: true))
        loading.model.start()
        XCTAssertEqual(loading.model.phase, .loading)

        let content = makeHarness()
        content.model.start()
        XCTAssertEqual(content.model.phase, .content)

        let failed = makeHarness(snapshot: CommandPaletteSnapshot(errorMessage: "boom"))
        failed.model.start()
        XCTAssertEqual(failed.model.phase, .error("boom"))
    }

    func testLoadingWithCachedDataShowsContent() {
        let snapshot = CommandPaletteSnapshot(vehicles: CommandPaletteTestSupport.vehicles, isLoading: true)
        let harness = makeHarness(snapshot: snapshot)
        harness.model.start()
        XCTAssertEqual(harness.model.phase, .content) // cached data → no skeleton flash
    }

    func testConnectionPassthrough() {
        let harness = makeHarness(snapshot: CommandPaletteTestSupport.snapshot(connection: .offline))
        harness.model.start()
        XCTAssertEqual(harness.model.connection, .offline)
    }

    func testStaleAutoRefreshesOnceThenResets() {
        let harness = makeHarness(snapshot: CommandPaletteTestSupport.snapshot(connection: .stale))
        harness.model.start()
        let afterFirstStale = harness.source.refreshCount
        XCTAssertGreaterThanOrEqual(afterFirstStale, 1)
        harness.source.push(CommandPaletteTestSupport.snapshot(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, afterFirstStale) // no second refresh while still stale
        harness.source.push(CommandPaletteTestSupport.snapshot(connection: .live))
        harness.source.push(CommandPaletteTestSupport.snapshot(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, afterFirstStale + 1) // re-armed after returning live
    }

    // MARK: Open / close / back

    func testOpenResetsToFreshSearch() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.setRawQuery("drives")
        harness.model.open()
        XCTAssertTrue(harness.model.isOpen)
        XCTAssertEqual(harness.model.query, "")
        XCTAssertEqual(harness.model.mode, .search)
        XCTAssertNil(harness.model.pendingCommand)
    }

    func testCloseResetsMode() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.open()
        harness.model.close()
        XCTAssertFalse(harness.model.isOpen)
        XCTAssertEqual(harness.model.mode, .search)
    }

    // MARK: Query + scope reconstruction

    func testSetScopedInputReconstructsRawQueryWithScope() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.setRawQuery("> ") // activate command scope
        XCTAssertEqual(harness.model.activeScope, .command)
        harness.model.setScopedInput("wake")
        XCTAssertEqual(harness.model.query, "> wake")
        XCTAssertEqual(harness.model.projection.scopedTerm, "wake")
    }

    func testClearScope() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.setRawQuery("> wake")
        harness.model.clearScope()
        XCTAssertEqual(harness.model.query, "")
        XCTAssertNil(harness.model.activeScope)
    }

    // MARK: Live search (debounce + scope gate)

    func testSearchGateClearsWhenScopeActive() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.setRawQuery("> wake")
        XCTAssertTrue(harness.source.searchedTerms.contains(""))
        XCTAssertFalse(harness.source.searchedTerms.contains("wake"))
    }

    func testPlainQueryTriggersDebouncedSearch() async throws {
        let harness = makeHarness()
        harness.model.start()
        harness.model.setRawQuery("wake")
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertTrue(harness.source.searchedTerms.contains("wake"))
    }

    // MARK: Keyboard

    func testKeyboardNavigationClamps() {
        let snapshot = CommandPaletteSnapshot(
            navEntries: [
                PaletteNavEntry(path: "/a", label: "A", sectionTitle: "S"),
                PaletteNavEntry(path: "/b", label: "B", sectionTitle: "S")
            ]
        )
        let harness = makeHarness(snapshot: snapshot)
        harness.model.start()
        XCTAssertEqual(harness.model.selectedIndex, 0)
        harness.model.moveDown()
        XCTAssertEqual(harness.model.selectedIndex, 1)
        harness.model.moveDown() // clamp at last
        XCTAssertEqual(harness.model.selectedIndex, 1)
        harness.model.moveUp()
        XCTAssertEqual(harness.model.selectedIndex, 0)
        harness.model.moveUp() // clamp at 0
        XCTAssertEqual(harness.model.selectedIndex, 0)
    }

    func testHandleBackspacePopsVehicleSelect() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.activate(commandItem("lock"))
        XCTAssertEqual(harness.model.mode, .vehicleSelect)
        XCTAssertTrue(harness.model.handleBackspace())
        XCTAssertEqual(harness.model.mode, .search)
    }

    func testHandleEscapeClearsScopeThenCloses() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.open()
        harness.model.setRawQuery("> wake")
        harness.model.handleEscape() // first esc clears scope
        XCTAssertNil(harness.model.activeScope)
        XCTAssertTrue(harness.model.isOpen)
        harness.model.handleEscape() // second esc closes
        XCTAssertFalse(harness.model.isOpen)
    }

    // MARK: Activation routing

    func testActivateNavigateRoutesAndRecords() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.activate(navItem("/drives"))
        XCTAssertEqual(harness.runner.activations, [.navigate("/drives")])
        XCTAssertTrue(harness.source.recordedIDs.contains("/drives"))
    }

    func testActivateSingleVehicleCommandExecutes() {
        let single = CommandPaletteSnapshot(vehicles: [PaletteVehicle(id: 9, displayName: "Solo")])
        let harness = makeHarness(snapshot: single)
        harness.model.start()
        harness.model.activate(commandItem("lock"))
        XCTAssertEqual(harness.runner.activations, [.command("lock", 9)])
        XCTAssertTrue(harness.source.recordedIDs.contains("cmd-lock"))
        XCTAssertEqual(harness.model.mode, .search) // never enters vehicle-select for a 1-vehicle fleet
    }

    func testActivateMultiVehicleCommandEntersVehicleSelect() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.activate(commandItem("lock"))
        XCTAssertEqual(harness.model.mode, .vehicleSelect)
        XCTAssertEqual(harness.model.pendingCommand, "lock")
        XCTAssertTrue(harness.runner.activations.isEmpty) // nothing runs until a vehicle is picked
    }

    func testActivateSwitchRegistryAndSearchResult() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.activate(PaletteItem(
            id: "switch-vehicle-2",
            label: "Switch",
            section: "",
            iconName: "c",
            kind: .vehicleSwitch,
            action: .switchVehicle(id: 2)
        ))
        harness.model.activate(PaletteItem(
            id: "toggle-theme",
            label: "Theme",
            section: "",
            iconName: "c",
            kind: .registry,
            action: .runRegistry(id: "toggle-theme")
        ))
        harness.model.activate(PaletteItem(
            id: "search-drive-1",
            label: "D",
            section: "",
            iconName: "c",
            kind: .searchHit,
            action: .openSearchResult(url: "/d/1")
        ))
        XCTAssertEqual(
            harness.runner.activations,
            [.switchVehicle(2), .registry("toggle-theme"), .searchResult("/d/1")]
        )
        XCTAssertTrue(harness.source.recordedIDs.contains("switch-vehicle-2"))
    }

    func testOpenAllResultsNavigatesToSearchPage() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.setRawQuery("super charge")
        harness.model.openAllResults()
        XCTAssertEqual(harness.runner.activations.count, 1)
        if case let .navigate(path) = harness.runner.activations.first {
            XCTAssertTrue(path.hasPrefix("/search?q="))
        } else {
            XCTFail("expected a navigate activation")
        }
    }
}

// MARK: - Spy telemetry

private final class SpyCommandPaletteTelemetry: CommandPaletteTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
