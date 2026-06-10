//
//  globalShortcuts.Tests.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  Adapter + projection coverage for the globalShortcuts surface:
//    • KeyToken — the verbatim chip glyph and the humanised VoiceOver pronunciation.
//    • Catalog — the verbatim port of the web `defs`: the four universals, the 14
//      `GOTO_SHORTCUTS` navigation entries, and the three `commandRegistry` shortcut
//      entries — counts, ids, key tokens, descriptions, and order.
//    • Format — the `Go to %@` / `{{label}}` interpolation (web template literal).
//    • Grouping — folding the flat registry into ordered, non-empty cheat-sheet sections.
//    • Accessibility — the composed VoiceOver row label.
//    • Projection — the render branches plus the P4 leaf contract across
//      loading / empty / error / data.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store. Strings resolve through an identity-fallback resolver so assertions read the
//  web English values directly.
//

import XCTest
@testable import TeslaSync

private let fallbackResolve: GlobalShortcutsResolve = { _, fallback in fallback }

// MARK: - Key token (web `<kbd>` chip glyph + spoken)

final class GlobalShortcutsKeyTokenTests: XCTestCase {
    func testDisplayIsPreservedVerbatim() {
        XCTAssertEqual(ShortcutKeyToken.from("Ctrl").display, "Ctrl")
        XCTAssertEqual(ShortcutKeyToken.from("/").display, "/")
        XCTAssertEqual(ShortcutKeyToken.from("g").display, "g")
        XCTAssertEqual(ShortcutKeyToken.from("K").display, "K")
    }

    func testNamedModifiersAndPunctuationAreSpelledOut() {
        XCTAssertEqual(ShortcutKeyToken.from("Ctrl").spoken, "Control")
        XCTAssertEqual(ShortcutKeyToken.from("Esc").spoken, "Escape")
        XCTAssertEqual(ShortcutKeyToken.from("/").spoken, "Slash")
        XCTAssertEqual(ShortcutKeyToken.from("?").spoken, "Question mark")
        XCTAssertEqual(ShortcutKeyToken.from("←").spoken, "Left arrow")
    }

    func testSingleLetterIsSpokenUppercased() {
        XCTAssertEqual(ShortcutKeyToken.from("g").spoken, "G")
        XCTAssertEqual(ShortcutKeyToken.from("d").spoken, "D")
        XCTAssertEqual(ShortcutKeyToken.from("T").spoken, "T")
    }
}

// MARK: - Catalog (verbatim port of the web `defs`)

final class GlobalShortcutsCatalogTests: XCTestCase {
    func testUniversalsMatchTheWebSource() {
        let universals = GlobalShortcutsCatalog.universalDefinitions(resolve: fallbackResolve)
        XCTAssertEqual(universals.count, 4)
        XCTAssertEqual(universals.map(\.id), [
            "global.palette.ctrlk",
            "global.palette.slash",
            "global.shortcuts.help",
            "global.shortcuts.escape"
        ])
        XCTAssertEqual(universals[0].keys, ["Ctrl", "K"])
        XCTAssertEqual(universals[0].description, "Open command palette")
        XCTAssertEqual(universals[1].keys, ["/"])
        XCTAssertEqual(universals[1].description, "Open command palette")
        XCTAssertEqual(universals[2].keys, ["?"])
        XCTAssertEqual(universals[2].description, "Show keyboard shortcuts")
        XCTAssertEqual(universals[3].keys, ["Esc"])
        XCTAssertEqual(universals[3].description, "Close modal / cancel")
        XCTAssertTrue(universals.allSatisfy { $0.group == .actions })
    }

    func testNavigationMatchesGotoShortcutsTable() {
        let nav = GlobalShortcutsCatalog.navigationDefinitions(resolve: fallbackResolve)
        XCTAssertEqual(nav.count, 14)
        // Source order: d, v, c, r, t, b, a, e, s, n, l, o, x, i.
        XCTAssertEqual(nav.map { $0.keys[1] }, ["d", "v", "c", "r", "t", "b", "a", "e", "s", "n", "l", "o", "x", "i"])
        XCTAssertTrue(nav.allSatisfy { $0.keys.first == "g" })
        XCTAssertTrue(nav.allSatisfy { $0.group == .navigation })
        XCTAssertEqual(nav.first?.id, "global.goto.d")
        XCTAssertEqual(nav.first?.description, "Go to Dashboard")
        XCTAssertEqual(nav.last?.id, "global.goto.i")
        XCTAssertEqual(nav.last?.description, "Go to Climate")
        // The multi-word label flows through the template intact.
        XCTAssertEqual(nav.first(where: { $0.id == "global.goto.b" })?.description, "Go to Battery & Energy")
    }

    func testPaletteCommandsMatchRegistryShortcutEntries() {
        let commands = GlobalShortcutsCatalog.commandDefinitions(resolve: fallbackResolve)
        XCTAssertEqual(commands.count, 3)
        XCTAssertEqual(commands.map(\.id), [
            "global.palette.cmd.pref.themePicker",
            "global.palette.cmd.action.shortcuts",
            "global.palette.cmd.action.dashboard.edit"
        ])
        XCTAssertEqual(commands.map(\.keys.first), ["T", "?", "E"])
        XCTAssertEqual(commands.map(\.description), [
            "Open theme picker",
            "Show keyboard shortcuts",
            "Edit dashboard layout"
        ])
        XCTAssertTrue(commands.allSatisfy { $0.group == .commands })
    }

    func testCanonicalDefinitionsConcatInWebOrder() {
        let defs = GlobalShortcutsCatalog.canonicalDefinitions(resolve: fallbackResolve)
        XCTAssertEqual(defs.count, 21) // 4 + 14 + 3
        XCTAssertEqual(Array(defs.prefix(4)).map(\.group), Array(repeating: .actions, count: 4))
        XCTAssertEqual(Array(defs.dropFirst(4).prefix(14)).map(\.group), Array(repeating: .navigation, count: 14))
        XCTAssertEqual(Array(defs.suffix(3)).map(\.group), Array(repeating: .commands, count: 3))
        // Ids are unique.
        XCTAssertEqual(Set(defs.map(\.id)).count, defs.count)
        // Every entry is global scope (web `scope: 'global'`).
        XCTAssertTrue(defs.allSatisfy { $0.scope == .global })
    }
}

// MARK: - Format (web `{{label}}` interpolation)

final class GlobalShortcutsFormatTests: XCTestCase {
    func testInterpolatesPercentToken() {
        XCTAssertEqual(GlobalShortcutsFormat.interpolate(template: "Go to %@", label: "Drives"), "Go to Drives")
    }

    func testInterpolatesDoubleBraceToken() {
        XCTAssertEqual(
            GlobalShortcutsFormat.interpolate(template: "Go to {{label}}", label: "Trips"),
            "Go to Trips"
        )
    }

    func testAppendsLabelWhenNoToken() {
        XCTAssertEqual(GlobalShortcutsFormat.interpolate(template: "Go to", label: "Climate"), "Go to Climate")
    }
}

// MARK: - Grouping (web cheat-sheet read-time grouping)

final class GlobalShortcutsGroupingTests: XCTestCase {
    func testGroupsCanonicalIntoThreeOrderedSections() {
        let defs = GlobalShortcutsCatalog.canonicalDefinitions(resolve: fallbackResolve)
        let groups = GlobalShortcutsGrouping.groups(from: defs, resolve: fallbackResolve)
        XCTAssertEqual(groups.map(\.kind), [.actions, .navigation, .commands])
        XCTAssertEqual(groups.map(\.rows.count), [4, 14, 3])
        XCTAssertEqual(groups[0].title, "Actions")
        XCTAssertEqual(groups[1].title, "Navigation (press g then…)")
        XCTAssertEqual(groups[2].title, "Commands")
    }

    func testEmptyInputProducesNoGroups() {
        XCTAssertTrue(GlobalShortcutsGrouping.groups(from: [], resolve: fallbackResolve).isEmpty)
    }

    func testGroupOrderIsCanonicalRegardlessOfInputOrder() {
        let commands = GlobalShortcutsCatalog.commandDefinitions(resolve: fallbackResolve)
        let actions = GlobalShortcutsCatalog.universalDefinitions(resolve: fallbackResolve)
        // Feed commands before actions — output must still be actions then commands.
        let groups = GlobalShortcutsGrouping.groups(from: commands + actions, resolve: fallbackResolve)
        XCTAssertEqual(groups.map(\.kind), [.actions, .commands])
    }
}

// MARK: - Accessibility summary

final class GlobalShortcutsAccessibilityTests: XCTestCase {
    func testSpokenKeysJoinPronunciations() {
        let tokens = [ShortcutKeyToken.from("Ctrl"), ShortcutKeyToken.from("K")]
        XCTAssertEqual(GlobalShortcutsAccessibility.spokenKeys(tokens), "Control K")
    }

    func testRowLabelComposesDescriptionAndKeys() {
        let tokens = [ShortcutKeyToken.from("g"), ShortcutKeyToken.from("d")]
        XCTAssertEqual(
            GlobalShortcutsAccessibility.rowLabel(
                description: "Go to Dashboard",
                shortcutWord: "shortcut",
                tokens: tokens
            ),
            "Go to Dashboard, shortcut G D"
        )
    }

    func testRowLabelDropsShortcutClauseWhenNoKeys() {
        XCTAssertEqual(
            GlobalShortcutsAccessibility.rowLabel(description: "Just a label", shortcutWord: "shortcut", tokens: []),
            "Just a label"
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class GlobalShortcutsProjectionTests: XCTestCase {
    private var canonical: [GlobalShortcutDefinition] {
        GlobalShortcutsCatalog.canonicalDefinitions(resolve: fallbackResolve)
    }

    func testErrorTakesPrecedence() {
        let resolved = GlobalShortcutsProjection.resolve(
            GlobalShortcutsInput(definitions: canonical, errorMessage: "boom"),
            strings: fallbackResolve
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.groups.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = GlobalShortcutsProjection.resolve(
            GlobalShortcutsInput(isLoading: true),
            strings: fallbackResolve
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoDefinitions() {
        let resolved = GlobalShortcutsProjection.resolve(
            GlobalShortcutsInput(),
            strings: fallbackResolve
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.totalCount, 0)
    }

    func testDataGroupsAndCountsTheCanonicalRegistry() {
        let resolved = GlobalShortcutsProjection.resolve(
            GlobalShortcutsInput(definitions: canonical),
            strings: fallbackResolve
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.groups.count, 3)
        XCTAssertEqual(resolved.totalCount, 21)
    }
}
