//
//  CommandPalette.ViewTests.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The view-composition + facade coverage: the public surface composes in every state (loading / error /
//  content / empty / search results / scope chip / vehicle-select / stale / offline), the focus-free subviews
//  build (rows, group, scope chip, freshness chip, error tile, empty message, view-all, trigger), and the
//  P1/S10 facade resolves the web `t()` parity copy + the native a11y additions with the English fallbacks
//  (section labels, scope chips, recent-time buckets, the interpolated header / empty / footer copy, and the
//  dialog / control accessibility labels). Split from CommandPalette.Tests.swift to keep each file within the
//  SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class CommandPaletteViewTests: XCTestCase {
    private func model(
        snapshot: CommandPaletteSnapshot = CommandPaletteTestSupport.snapshot(),
        rawQuery: String? = nil,
        command: String? = nil
    ) -> CommandPaletteModel {
        let source = InMemoryCommandPaletteSource(snapshot: snapshot, searchProvider: { _ in [] })
        let holder = CommandPaletteModel(
            source: source, runner: InMemoryCommandPaletteRunner(),
            copyProvider: { CommandPaletteTestSupport.copy() }
        )
        holder.start()
        if let command {
            holder.activate(PaletteItem(
                id: "cmd-\(command)",
                label: command,
                section: "",
                iconName: "c",
                kind: .command,
                action: .selectCommand(command: command)
            ))
        }
        if let rawQuery { holder.setRawQuery(rawQuery) }
        return holder
    }

    // MARK: Surface composes in every state

    func testSurfaceComposesForEveryState() {
        _ = CommandPalette(model: model())
        _ = CommandPalette(model: model(snapshot: CommandPaletteSnapshot(isLoading: true)))
        _ = CommandPalette(model: model(snapshot: CommandPaletteSnapshot(errorMessage: "down")))
        _ = CommandPalette(model: model(rawQuery: "zzz")) // empty / no results
        _ = CommandPalette(model: model(rawQuery: "> ")) // scope chip
        _ = CommandPalette(model: model(command: "lock")) // vehicle-select
        _ = CommandPalette(model: model(snapshot: CommandPaletteTestSupport.snapshot(connection: .stale)))
        _ = CommandPalette(model: model(snapshot: CommandPaletteTestSupport.snapshot(connection: .offline)))
        XCTAssertEqual(CommandPalette.surfaceSlug, "CommandPalette")
    }

    func testSurfaceComposesFromSourceInitializer() {
        let source = InMemoryCommandPaletteSource(snapshot: CommandPaletteTestSupport.snapshot())
        _ = CommandPalette(source: source, onOpen: {})
    }

    // MARK: Focus-free subviews build

    func testSubviewsBuild() {
        let item = PaletteItem(
            id: "cmd-lock",
            label: "Lock Vehicle",
            section: "Vehicle Commands",
            iconName: "lock.fill",
            kind: .command,
            sublabel: "-> Lightning",
            shortcut: "g l",
            keywords: ["lock"],
            action: .selectCommand(command: "lock")
        )
        _ = CommandPaletteRow(item: item, isSelected: true, onSelect: {}, onHover: {})
        _ = CommandPaletteRow(item: item, isSelected: false, onSelect: {}, onHover: {})
        _ = CommandPaletteGroup(
            group: PaletteGroup(
                id: "g-0",
                section: "Vehicle Commands",
                items: [PaletteIndexedItem(item: item, globalIndex: 0)]
            ),
            selectedIndex: 0, onSelect: { _ in }, onHover: { _ in }
        )
        _ = CommandPaletteScopeChip(scope: .command, onClear: {})
        _ = CommandPaletteFreshnessChip(connection: .stale, onRefresh: {})
        _ = CommandPaletteFreshnessChip(connection: .offline, onRefresh: {})
        _ = CommandPaletteErrorTile(message: "boom", onRetry: {})
        _ = CommandPaletteEmptyMessage(kind: .noVehicles)
        _ = CommandPaletteEmptyMessage(kind: .scopeEmpty(.command))
        _ = CommandPaletteEmptyMessage(kind: .noResults(query: "abc"))
        _ = CommandPaletteLoadingRows()
        _ = CommandPaletteViewAllButton(query: "abc", onTap: {})
        _ = CommandPaletteKbd(text: "esc")
        _ = CommandPaletteBackdrop(onClose: {})
        _ = CommandPaletteTrigger(onActivate: {})
    }

    // MARK: Strings facade (web t() parity)

    func testSectionLabelsResolve() {
        XCTAssertEqual(CommandPaletteStrings.pages, "Pages")
        XCTAssertEqual(CommandPaletteStrings.commands, "Vehicle Commands")
        XCTAssertEqual(CommandPaletteStrings.mostUsed, "Most Used")
        XCTAssertEqual(CommandPaletteStrings.selectVehicle, "Select Vehicle")
    }

    func testSearchSectionLabels() {
        XCTAssertEqual(CommandPaletteStrings.searchSection(.drive), "Drives")
        XCTAssertEqual(CommandPaletteStrings.searchSection(.charging), "Charging")
        XCTAssertEqual(CommandPaletteStrings.searchSection(.geofence), "Geofences")
    }

    func testScopeCopyResolves() {
        XCTAssertEqual(CommandPaletteStrings.scopeLabel(.command), "Commands")
        XCTAssertEqual(CommandPaletteStrings.scopePlaceholder(.navigate), "Search pages…")
        XCTAssertEqual(CommandPaletteStrings.scopeEmpty(.registry), "No settings available")
    }

    func testRecentTimeBuckets() {
        XCTAssertEqual(CommandPaletteStrings.justNow, "Just now")
        XCTAssertEqual(CommandPaletteStrings.minutesAgo(5), "5m ago")
        XCTAssertEqual(CommandPaletteStrings.hoursAgo(2), "2h ago")
        XCTAssertEqual(CommandPaletteStrings.daysAgo(3), "3d ago")
    }

    func testInterpolatedCopy() {
        XCTAssertEqual(CommandPaletteStrings.switchVehicle("Bolt"), "Switch to Bolt")
        XCTAssertEqual(CommandPaletteStrings.selectVehicleFor("Lock"), "Send \"Lock\" to…")
        XCTAssertEqual(CommandPaletteStrings.noResults("xyz"), "No results for \"xyz\"")
        XCTAssertEqual(CommandPaletteStrings.viewAllResults("xyz"), "View all results for \"xyz\"")
        XCTAssertEqual(CommandPaletteStrings.shortcut("g d"), "Shortcut: g d")
        XCTAssertEqual(CommandPaletteStrings.commandTarget("Bolt"), "→ Bolt")
    }

    func testFooterCountSingularPlural() {
        XCTAssertEqual(CommandPaletteStrings.vehicleCount(1), "1 vehicle")
        XCTAssertEqual(CommandPaletteStrings.vehicleCount(3), "3 vehicles")
    }

    // MARK: Accessibility label presence

    func testAccessibilityLabelsAreNonEmpty() {
        XCTAssertFalse(CommandPaletteStrings.dialogTitle.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.searchFieldLabel.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.backButton.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.closeButton.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.rowSelectHint.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.staleA11y.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.offlineA11y.isEmpty)
        XCTAssertFalse(CommandPaletteStrings.loadingA11y.isEmpty)
    }

    func testMakeCopyMirrorsFacade() {
        let copy = CommandPaletteStrings.makeCopy()
        XCTAssertEqual(copy.pages, CommandPaletteStrings.pages)
        XCTAssertEqual(copy.commandLabel("palette.cmd.lock", "Lock Vehicle"), "Lock Vehicle")
        XCTAssertEqual(copy.searchSection(.trip), "Trips")
        XCTAssertEqual(copy.recentAgo.justNow, CommandPaletteStrings.justNow)
    }
}
