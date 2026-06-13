//
//  CommandPalette.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projector): the surface identity, the scope parser
//  (web `parsePrefix` + `itemMatchesScope` + the hint table), the fuzzy scorer (web `scoreCommand` tiers),
//  the relative-time buckets (web `formatRecentVisitedAgo`), the scope-narrowed + frecency-tiebroken filter
//  (web `filtered`), the section grouping (web `groupedItems`), the empty-message branch, the index clamp,
//  and the top-level `project` fold. The item builders live in CommandPalette.ItemsTests.swift; the
//  state-holder + views live in CommandPalette.Tests.swift. These run in the TeslaSync(/-macOS) XCTest
//  targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared test support (one definition for the whole test target)

enum CommandPaletteTestSupport {
    static func copy() -> PaletteCopy {
        PaletteCopy(
            pages: "Pages", commands: "Vehicle Commands", vehicles: "Vehicles",
            preferences: "Preferences", actions: "Actions", mostUsed: "Most Used",
            recent: "Recent", selectVehicle: "Select Vehicle",
            commandLabel: { _, fallback in fallback },
            switchVehicleLabel: { "Switch to \($0)" },
            commandTarget: { "-> \($0)" },
            selectVehiclePrompt: "Select vehicle…",
            searchSection: { $0.rawValue.capitalized },
            recentAgo: PaletteRecentAgoCopy(
                justNow: "Just now",
                minutes: { "\($0)m ago" },
                hours: { "\($0)h ago" },
                days: { "\($0)d ago" }
            ),
            unknownState: "unknown"
        )
    }

    static let vehicles: [PaletteVehicle] = [
        PaletteVehicle(id: 1, displayName: "Lightning", vin: "VIN1", model: "Model 3", state: "online"),
        PaletteVehicle(id: 2, displayName: "Loaner", vin: "VIN2", model: "Model S", state: "asleep")
    ]

    static let nav: [PaletteNavEntry] = [
        PaletteNavEntry(path: "/drives", label: "Drives", sectionTitle: "Fleet", keywords: ["trips", "routes"]),
        PaletteNavEntry(path: "/me", label: "My Activity", sectionTitle: "Account", requiresAuth: true)
    ]

    static let registry: [PaletteRegistryEntry] = [
        PaletteRegistryEntry(id: "toggle-theme", label: "Toggle Theme", section: .preferences, keywords: ["dark"])
    ]

    static func snapshot(
        searchHits: [PaletteSearchHit] = [],
        commandScores: [String: Double] = [:],
        connection: PaletteConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> CommandPaletteSnapshot {
        CommandPaletteSnapshot(
            vehicles: vehicles, selectedVehicleID: 1, isForwardAuth: true,
            navEntries: nav, registryEntries: registry,
            recentPages: [], commandScores: commandScores, searchHits: searchHits,
            isLoading: isLoading, errorMessage: errorMessage, connection: connection
        )
    }
}

// MARK: - Surface identity

final class CommandPaletteAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(CommandPaletteSurface.slug, "CommandPalette")
    }

    // MARK: Scope parser (web parsePrefix)

    func testParsePrefixRecognizesEachScope() {
        XCTAssertEqual(PaletteScopes.parsePrefix("> wake").scope, .command)
        XCTAssertEqual(PaletteScopes.parsePrefix("/drives").scope, .navigate)
        XCTAssertEqual(PaletteScopes.parsePrefix("@ model").scope, .vehicleSwitch)
        XCTAssertEqual(PaletteScopes.parsePrefix(": theme").scope, .registry)
    }

    func testParsePrefixConsumesOneSpaceAndKeepsTerm() {
        XCTAssertEqual(PaletteScopes.parsePrefix("> wake").term, "wake")
        XCTAssertEqual(PaletteScopes.parsePrefix(">wake").term, "wake")
        XCTAssertEqual(PaletteScopes.parsePrefix(">  wake").term, " wake")
    }

    func testParsePrefixUnknownLeadingCharIsTerm() {
        let parsed = PaletteScopes.parsePrefix("wake")
        XCTAssertNil(parsed.scope)
        XCTAssertEqual(parsed.term, "wake")
    }

    func testParsePrefixEmptyInput() {
        let parsed = PaletteScopes.parsePrefix("")
        XCTAssertNil(parsed.scope)
        XCTAssertEqual(parsed.term, "")
    }

    func testItemMatchesScope() {
        XCTAssertTrue(PaletteScopes.itemMatchesScope(.command, scope: .command))
        XCTAssertFalse(PaletteScopes.itemMatchesScope(.navigate, scope: .command))
        XCTAssertTrue(PaletteScopes.itemMatchesScope(.navigate, scope: nil))
    }

    func testScopeHintsCoverEveryScopeInOrder() {
        XCTAssertEqual(PaletteScopes.hints.map(\.scope), [.command, .navigate, .vehicleSwitch, .registry])
        XCTAssertEqual(PaletteScopes.hints.map(\.prefix), [">", "/", "@", ":"])
    }

    // MARK: Fuzzy scorer (web scoreCommand)

    func testScoreCommandTiers() {
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("", label: "Drives", keywords: []), 1)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("drives", label: "Drives", keywords: []), 1000)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("dr", label: "Drives", keywords: []), 502)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("riv", label: "Drives", keywords: []), 203)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("bh", label: "Battery Health", keywords: []), 150)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("wak", label: "Foo", keywords: ["wake"]), 100)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("ke", label: "Foo", keywords: ["wake"]), 50)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("btr", label: "Battery", keywords: []), 25)
        XCTAssertEqual(CommandPaletteProjector.scoreCommand("zzz", label: "Battery", keywords: []), 0)
    }

    // MARK: Relative time (web formatRecentVisitedAgo)

    func testRecentAgoBuckets() {
        let copy = CommandPaletteTestSupport.copy().recentAgo
        let now = Date(timeIntervalSince1970: 1_000_000)
        func ago(_ seconds: TimeInterval) -> String {
            CommandPaletteProjector.recentAgo(visitedAt: now.addingTimeInterval(-seconds), now: now, copy: copy)
        }
        XCTAssertEqual(ago(30), "Just now")
        XCTAssertEqual(ago(5 * 60), "5m ago")
        XCTAssertEqual(ago(90 * 60), "1h ago")
        XCTAssertEqual(ago(50 * 3600), "2d ago")
        XCTAssertEqual(ago(-100), "Just now") // future visit clamps to 0
    }

    // MARK: filtered (web filtered)

    private func item(
        _ id: String,
        _ label: String,
        kind: PaletteItemKind = .navigate,
        section: String = "Pages",
        keywords: [String] = []
    ) -> PaletteItem {
        PaletteItem(
            id: id,
            label: label,
            section: section,
            iconName: "circle",
            kind: kind,
            keywords: keywords,
            action: .navigate(path: id)
        )
    }

    func testFilteredEmptyTermKeepsScopedOrder() {
        let items = [item("/a", "Alpha"), item("/b", "Beta")]
        let result = CommandPaletteProjector.filtered(allItems: items, activeScope: nil, scopedTerm: "", scores: [:])
        XCTAssertEqual(result.map(\.id), ["/a", "/b"])
    }

    func testFilteredNarrowsByScope() {
        let items = [item("/a", "Alpha", kind: .navigate), item("c", "Cmd", kind: .command)]
        let result = CommandPaletteProjector.filtered(
            allItems: items, activeScope: .command, scopedTerm: "", scores: [:]
        )
        XCTAssertEqual(result.map(\.id), ["c"])
    }

    func testFilteredScoresAndDropsZeros() {
        let items = [item("/drives", "Drives"), item("/charging", "Charging")]
        let result = CommandPaletteProjector.filtered(
            allItems: items, activeScope: nil, scopedTerm: "dri", scores: [:]
        )
        XCTAssertEqual(result.map(\.id), ["/drives"])
    }

    func testFilteredPinsSearchHitsFirst() {
        let hit = PaletteItem(
            id: "search-drive-1",
            label: "Zeta",
            section: "Drives",
            iconName: "circle",
            kind: .searchHit,
            action: .openSearchResult(url: "/d/1")
        )
        let alpha = item("/a", "Alpha drive")
        let result = CommandPaletteProjector.filtered(
            allItems: [alpha, hit], activeScope: nil, scopedTerm: "a", scores: [:]
        )
        XCTAssertEqual(result.first?.id, "search-drive-1")
    }

    func testFilteredFrecencyTiebreak() {
        let one = item("one", "Match", keywords: [])
        let two = item("two", "Match", keywords: [])
        let result = CommandPaletteProjector.filtered(
            allItems: [one, two], activeScope: nil, scopedTerm: "match", scores: ["two": 5]
        )
        XCTAssertEqual(result.map(\.id), ["two", "one"])
    }

    func testFilteredSublabelAndSectionFallback() {
        let sub = PaletteItem(
            id: "s",
            label: "Nope",
            section: "Pages",
            iconName: "circle",
            kind: .navigate,
            sublabel: "needle here",
            action: .navigate(path: "s")
        )
        let result = CommandPaletteProjector.filtered(
            allItems: [sub], activeScope: nil, scopedTerm: "needle", scores: [:]
        )
        XCTAssertEqual(result.map(\.id), ["s"])
    }

    // MARK: grouped (web groupedItems)

    func testGroupedKeepsOrderAndIndices() {
        let items = [
            item("a", "A", section: "S1"), item("b", "B", section: "S1"),
            item("c", "C", section: "S2"), item("d", "D", section: "S1")
        ]
        let groups = CommandPaletteProjector.grouped(items)
        XCTAssertEqual(groups.map(\.section), ["S1", "S2", "S1"])
        XCTAssertEqual(groups[0].items.map(\.globalIndex), [0, 1])
        XCTAssertEqual(groups[1].items.map(\.globalIndex), [2])
        XCTAssertEqual(groups[2].items.map(\.globalIndex), [3])
        XCTAssertEqual(Set(groups.map(\.id)).count, 3)
    }

    func testGroupedEmpty() {
        XCTAssertTrue(CommandPaletteProjector.grouped([]).isEmpty)
    }

    // MARK: empty message + clamp

    func testEmptyMessageKind() {
        XCTAssertEqual(
            CommandPaletteProjector.emptyMessageKind(
                mode: .vehicleSelect,
                activeScope: nil,
                scopedTerm: "",
                rawQuery: ""
            ),
            .noVehicles
        )
        XCTAssertEqual(
            CommandPaletteProjector.emptyMessageKind(
                mode: .search,
                activeScope: .command,
                scopedTerm: "",
                rawQuery: ">"
            ),
            .scopeEmpty(.command)
        )
        XCTAssertEqual(
            CommandPaletteProjector.emptyMessageKind(
                mode: .search,
                activeScope: nil,
                scopedTerm: "abc",
                rawQuery: "abc"
            ),
            .noResults(query: "abc")
        )
    }

    func testClampSelectedIndex() {
        XCTAssertEqual(CommandPaletteProjector.clampSelectedIndex(5, count: 3), 2)
        XCTAssertEqual(CommandPaletteProjector.clampSelectedIndex(-1, count: 3), 0)
        XCTAssertEqual(CommandPaletteProjector.clampSelectedIndex(2, count: 0), 0)
    }

    // MARK: project (top-level fold)

    func testProjectProducesGroupsAndScopeChip() {
        let input = CommandPaletteProjectionInput(
            snapshot: CommandPaletteTestSupport.snapshot(), mode: .search, rawQuery: "> ",
            pendingCommand: nil, selectedIndex: 0, now: Date()
        )
        let projection = CommandPaletteProjector.project(input, copy: CommandPaletteTestSupport.copy())
        XCTAssertEqual(projection.activeScope, .command)
        XCTAssertTrue(projection.items.allSatisfy { $0.kind == .command })
        XCTAssertFalse(projection.items.isEmpty)
    }

    func testProjectShowViewAllResults() {
        let hits = [PaletteSearchHit(type: .drive, id: 1, title: "D", url: "/d/1")]
        let input = CommandPaletteProjectionInput(
            snapshot: CommandPaletteTestSupport.snapshot(searchHits: hits), mode: .search, rawQuery: "drive",
            pendingCommand: nil, selectedIndex: 0, now: Date()
        )
        let projection = CommandPaletteProjector.project(input, copy: CommandPaletteTestSupport.copy())
        XCTAssertTrue(projection.showViewAllResults)
    }
}
