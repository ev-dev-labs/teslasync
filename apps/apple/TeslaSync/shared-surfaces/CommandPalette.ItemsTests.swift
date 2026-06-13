//
//  CommandPalette.ItemsTests.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The item-builder coverage (the pure web `useMemo` factories): the nav pages (auth filter + sublabel), the
//  vehicle commands (empty-fleet gate + single/multi sublabel), the vehicle-switch rows (>=2 gate + active
//  exclusion + keywords), the registry rows (section mapping), the frecency "Most Used" ranking + re-key, the
//  recent-page re-key + relative-time, the server search rows, the vehicle-select rows (pending-command
//  action), the `allItems` concatenation order + empty-query gating, and the `{model} · {state}` sublabel.
//  Split from CommandPalette.AdapterTests.swift to keep each file within the SwiftLint file-length budget.
//

import XCTest
@testable import TeslaSync

final class CommandPaletteItemsTests: XCTestCase {
    private let copy = CommandPaletteTestSupport.copy()

    // MARK: navItems

    func testNavItemsAuthFilterAndSublabel() {
        let hidden = CommandPaletteItems.navItems(CommandPaletteTestSupport.nav, isForwardAuth: false, copy: copy)
        XCTAssertEqual(hidden.map(\.id), ["/drives"]) // /me requiresAuth hidden
        let shown = CommandPaletteItems.navItems(CommandPaletteTestSupport.nav, isForwardAuth: true, copy: copy)
        XCTAssertEqual(shown.map(\.id), ["/drives", "/me"])
        XCTAssertEqual(shown[0].sublabel, "Fleet · trips, routes")
        XCTAssertEqual(shown[1].sublabel, "Account") // no keywords → bare section title
        XCTAssertEqual(shown[0].section, "Pages")
        XCTAssertEqual(shown[0].kind, .navigate)
        XCTAssertEqual(shown[0].action, .navigate(path: "/drives"))
    }

    // MARK: commandItems

    func testCommandItemsEmptyFleet() {
        XCTAssertTrue(CommandPaletteItems.commandItems(vehicles: [], copy: copy).isEmpty)
    }

    func testCommandItemsSingleVehicleTargetSublabel() {
        let single = [PaletteVehicle(id: 9, displayName: "Bolt", vin: "V")]
        let items = CommandPaletteItems.commandItems(vehicles: single, copy: copy)
        XCTAssertEqual(items.count, PaletteCommandConfig.all.count)
        XCTAssertEqual(items.first?.id, "cmd-wake_up")
        XCTAssertEqual(items.first?.sublabel, "-> Bolt")
        XCTAssertEqual(items.first?.kind, .command)
        XCTAssertEqual(items.first?.action, .selectCommand(command: "wake_up"))
    }

    func testCommandItemsMultiVehiclePrompt() {
        let items = CommandPaletteItems.commandItems(vehicles: CommandPaletteTestSupport.vehicles, copy: copy)
        XCTAssertEqual(items.first?.sublabel, "Select vehicle…")
    }

    func testCommandItemsEmptyNameFallsThroughToVin() {
        let single = [PaletteVehicle(id: 9, displayName: "", vin: "5YJ-VIN")]
        let items = CommandPaletteItems.commandItems(vehicles: single, copy: copy)
        XCTAssertEqual(items.first?.sublabel, "-> 5YJ-VIN")
    }

    // MARK: vehicleSwitchItems

    func testVehicleSwitchHiddenForSingleVehicle() {
        let one = [PaletteVehicle(id: 1, displayName: "A")]
        XCTAssertTrue(CommandPaletteItems.vehicleSwitchItems(vehicles: one, activeID: 1, copy: copy).isEmpty)
    }

    func testVehicleSwitchExcludesActiveAndLabels() {
        let items = CommandPaletteItems.vehicleSwitchItems(
            vehicles: CommandPaletteTestSupport.vehicles, activeID: 1, copy: copy
        )
        XCTAssertEqual(items.map(\.id), ["switch-vehicle-2"])
        XCTAssertEqual(items.first?.label, "Switch to Loaner")
        XCTAssertEqual(items.first?.kind, .vehicleSwitch)
        XCTAssertEqual(items.first?.sublabel, "Model S · asleep")
        XCTAssertEqual(items.first?.action, .switchVehicle(id: 2))
        XCTAssertTrue(items.first?.keywords.contains("Loaner") ?? false)
    }

    // MARK: registryItems

    func testRegistrySectionMapping() {
        let entries = [
            PaletteRegistryEntry(id: "p", label: "P", section: .preferences),
            PaletteRegistryEntry(id: "a", label: "A", section: .actions),
            PaletteRegistryEntry(id: "g", label: "G", section: .pages),
            PaletteRegistryEntry(id: "v", label: "V", section: .vehicles, shortcut: "g v")
        ]
        let items = CommandPaletteItems.registryItems(entries, copy: copy)
        XCTAssertEqual(items.map(\.section), ["Preferences", "Actions", "Pages", "Vehicles"])
        XCTAssertEqual(items.last?.shortcut, "g v")
        XCTAssertEqual(items.first?.action, .runRegistry(id: "p"))
        XCTAssertTrue(items.allSatisfy { $0.kind == .registry })
    }

    // MARK: mostUsedItems

    func testMostUsedRanksAndReKeys() {
        let candidates = [
            PaletteItem(
                id: "a",
                label: "A",
                section: "S",
                iconName: "c",
                kind: .navigate,
                action: .navigate(path: "a")
            ),
            PaletteItem(
                id: "b",
                label: "B",
                section: "S",
                iconName: "c",
                kind: .navigate,
                action: .navigate(path: "b")
            ),
            PaletteItem(id: "z", label: "Z", section: "S", iconName: "c", kind: .navigate, action: .navigate(path: "z"))
        ]
        let items = CommandPaletteItems.mostUsedItems(
            candidates: candidates, scores: ["a": 1, "b": 9, "z": 0], copy: copy
        )
        XCTAssertEqual(items.map(\.id), ["most-used-b", "most-used-a"]) // z (0) dropped, b > a
        XCTAssertEqual(items.first?.section, "Most Used")
        XCTAssertEqual(items.first?.action, .navigate(path: "b")) // action preserved
    }

    // MARK: recentPageItems

    func testRecentPageItemsReKeyAndAgo() {
        let now = Date()
        let pages = [PaletteRecentPage(
            path: "/d/1",
            title: "Drive",
            kind: .drive,
            visitedAt: now.addingTimeInterval(-120)
        )]
        let items = CommandPaletteItems.recentPageItems(pages: pages, now: now, copy: copy)
        XCTAssertEqual(items.first?.id, "recent-page-/d/1")
        XCTAssertEqual(items.first?.section, "Recent")
        XCTAssertEqual(items.first?.sublabel, "2m ago")
        XCTAssertEqual(items.first?.keywords, ["/d/1", "drive"])
        XCTAssertEqual(items.first?.action, .navigate(path: "/d/1"))
    }

    // MARK: searchResultItems

    func testSearchResultItems() {
        let hits = [PaletteSearchHit(type: .charging, id: 7, title: "Charge", subtitle: "42 kWh", url: "/c/7")]
        let items = CommandPaletteItems.searchResultItems(hits, copy: copy)
        XCTAssertEqual(items.first?.id, "search-charging-7")
        XCTAssertEqual(items.first?.kind, .searchHit)
        XCTAssertEqual(items.first?.sublabel, "42 kWh")
        XCTAssertEqual(items.first?.action, .openSearchResult(url: "/c/7"))
    }

    // MARK: vehicleItems

    func testVehicleItemsExecutePendingCommand() {
        let items = CommandPaletteItems.vehicleItems(
            vehicles: CommandPaletteTestSupport.vehicles, pendingCommand: "lock", copy: copy
        )
        XCTAssertEqual(items.map(\.id), ["vehicle-1", "vehicle-2"])
        XCTAssertEqual(items.first?.section, "Select Vehicle")
        XCTAssertEqual(items.first?.action, .executeCommand(command: "lock", vehicleID: 1))
    }

    func testVehicleItemsNoopWithoutPendingCommand() {
        let items = CommandPaletteItems.vehicleItems(
            vehicles: CommandPaletteTestSupport.vehicles, pendingCommand: nil, copy: copy
        )
        XCTAssertEqual(items.first?.action, .noop)
    }

    // MARK: allItems ordering + empty-query gating

    func testAllItemsEmptyQueryIncludesMostUsedAndRecent() {
        let snapshot = CommandPaletteSnapshot(
            vehicles: CommandPaletteTestSupport.vehicles, selectedVehicleID: 1, isForwardAuth: true,
            navEntries: CommandPaletteTestSupport.nav, registryEntries: CommandPaletteTestSupport.registry,
            recentPages: [PaletteRecentPage(path: "/r", title: "R", kind: .page, visitedAt: Date())],
            commandScores: ["/drives": 5], searchHits: []
        )
        let items = CommandPaletteProjector.allItems(
            snapshot: snapshot, mode: .search, rawQuery: "", now: Date(), copy: copy
        )
        XCTAssertTrue(items.contains { $0.section == "Most Used" })
        XCTAssertTrue(items.contains { $0.section == "Recent" })
    }

    func testAllItemsNonEmptyQueryExcludesMostUsedAndRecent() {
        let snapshot = CommandPaletteSnapshot(
            vehicles: CommandPaletteTestSupport.vehicles, navEntries: CommandPaletteTestSupport.nav,
            recentPages: [PaletteRecentPage(path: "/r", title: "R", kind: .page, visitedAt: Date())],
            commandScores: ["/drives": 5]
        )
        let items = CommandPaletteProjector.allItems(
            snapshot: snapshot, mode: .search, rawQuery: "drive", now: Date(), copy: copy
        )
        XCTAssertFalse(items.contains { $0.section == "Most Used" })
        XCTAssertFalse(items.contains { $0.section == "Recent" })
    }

    func testAllItemsGatesSearchHitsByScopeAndMode() {
        let hits = [PaletteSearchHit(type: .drive, id: 1, title: "D", url: "/d/1")]
        let snapshot = CommandPaletteSnapshot(searchHits: hits)
        let withScope = CommandPaletteProjector.allItems(
            snapshot: snapshot, mode: .search, rawQuery: "> ", now: Date(), copy: copy
        )
        XCTAssertFalse(withScope.contains { $0.kind == .searchHit }) // scope active → no search hits
        let noScope = CommandPaletteProjector.allItems(
            snapshot: snapshot, mode: .search, rawQuery: "drive", now: Date(), copy: copy
        )
        XCTAssertTrue(noScope.contains { $0.kind == .searchHit })
    }

    func testVehicleSublabelTrimsEmptyModel() {
        let vehicle = PaletteVehicle(id: 1, displayName: "A", model: nil, state: "online")
        let items = CommandPaletteItems.vehicleItems(vehicles: [vehicle], pendingCommand: "x", copy: copy)
        XCTAssertEqual(items.first?.sublabel, "· online") // empty model → leading space trimmed
    }
}
