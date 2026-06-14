//
//  Tabs.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the `TabItem` value type +
//  its `disabled` default, the `TabsInput` `enabledKeys` filter (the verbatim port of
//  `tabs.filter(t => !t.disabled).map(t => t.key)`) + `isEmpty`, the `TabsIdentifiers` element-id format +
//  the `useId()`-style generator, the byte-for-byte `TabsNavigator` keyboard rule (next / previous with
//  wrap, skip-disabled, Home / End, the not-enabled + empty edges), and the `TabsProjector` (the selected /
//  disabled / empty branches, the id wiring, the roving `isFocusable`, and the carried aria-label /
//  empty-label). Split from Tabs.Tests.swift (the SwiftUI / state-holder half) to keep each file within the
//  SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure,
//  with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + value types

final class TabsAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(TabsSurface.slug, "Tabs")
    }

    func testTabItemDisabledDefaultsFalse() {
        XCTAssertFalse(TabItem(key: "a", label: "A").disabled)
        XCTAssertTrue(TabItem(key: "b", label: "B", disabled: true).disabled)
        XCTAssertEqual(TabItem(key: "a", label: "A").id, "a")
    }

    func testTabItemEquality() {
        XCTAssertEqual(TabItem(key: "a", label: "A"), TabItem(key: "a", label: "A"))
        XCTAssertNotEqual(TabItem(key: "a", label: "A"), TabItem(key: "a", label: "A", disabled: true))
        XCTAssertNotEqual(TabItem(key: "a", label: "A"), TabItem(key: "a", label: "B"))
    }

    func testEnabledKeysFiltersDisabledInOrder() {
        let input = TabsInput(
            tabs: [
                TabItem(key: "one", label: "One"),
                TabItem(key: "two", label: "Two", disabled: true),
                TabItem(key: "three", label: "Three")
            ],
            activeTab: "one"
        )
        XCTAssertEqual(input.enabledKeys, ["one", "three"])
        XCTAssertFalse(input.isEmpty)
    }

    func testIsEmptyWhenNoTabs() {
        XCTAssertTrue(TabsInput(tabs: [], activeTab: "").isEmpty)
        XCTAssertEqual(TabsInput(tabs: [], activeTab: "").enabledKeys, [])
    }
}

// MARK: - TabsIdentifiers (web `useId()` + `{id}-tab-{key}` / `{id}-panel-{key}`)

final class TabsIdentifiersTests: XCTestCase {
    func testElementIDFormatMatchesWeb() {
        XCTAssertEqual(TabsIdentifiers.tab("t1", key: "battery"), "t1-tab-battery")
        XCTAssertEqual(TabsIdentifiers.panel("t1", key: "battery"), "t1-panel-battery")
    }

    func testGenerateIsPrefixedAndUnique() {
        let first = TabsIdentifiers.generate()
        let second = TabsIdentifiers.generate()
        XCTAssertTrue(first.hasPrefix("tabs-"))
        XCTAssertTrue(second.hasPrefix("tabs-"))
        XCTAssertNotEqual(first, second)
    }
}

// MARK: - TabsNavigator (web `handleKeyDown`)

final class TabsNavigatorTests: XCTestCase {
    private let keys = ["a", "b", "c"]

    func testNextAdvancesOneStop() {
        XCTAssertEqual(TabsNavigator.nextKey(from: "a", move: .next, enabledKeys: keys), "b")
        XCTAssertEqual(TabsNavigator.nextKey(from: "b", move: .next, enabledKeys: keys), "c")
    }

    func testNextWrapsFromLastToFirst() {
        XCTAssertEqual(TabsNavigator.nextKey(from: "c", move: .next, enabledKeys: keys), "a")
    }

    func testPreviousStepsBack() {
        XCTAssertEqual(TabsNavigator.nextKey(from: "c", move: .previous, enabledKeys: keys), "b")
    }

    func testPreviousWrapsFromFirstToLast() {
        XCTAssertEqual(TabsNavigator.nextKey(from: "a", move: .previous, enabledKeys: keys), "c")
    }

    func testArrowsSkipDisabledViaEnabledKeys() {
        // `enabledKeys` already excludes the disabled "b", so a Right from "a" lands on "c", not "b".
        let enabled = ["a", "c"]
        XCTAssertEqual(TabsNavigator.nextKey(from: "a", move: .next, enabledKeys: enabled), "c")
        XCTAssertEqual(TabsNavigator.nextKey(from: "c", move: .previous, enabledKeys: enabled), "a")
    }

    func testHomeAndEndJumpToFirstAndLastEnabled() {
        XCTAssertEqual(TabsNavigator.nextKey(from: "b", move: .first, enabledKeys: keys), "a")
        XCTAssertEqual(TabsNavigator.nextKey(from: "b", move: .last, enabledKeys: keys), "c")
    }

    func testArrowFromNonEnabledKeyIsNil() {
        // The active tab is disabled (not in enabledKeys): an arrow is a no-op (web `idx === -1` early
        // return), but Home / End still resolve.
        XCTAssertNil(TabsNavigator.nextKey(from: "x", move: .next, enabledKeys: keys))
        XCTAssertNil(TabsNavigator.nextKey(from: "x", move: .previous, enabledKeys: keys))
        XCTAssertEqual(TabsNavigator.nextKey(from: "x", move: .first, enabledKeys: keys), "a")
        XCTAssertEqual(TabsNavigator.nextKey(from: "x", move: .last, enabledKeys: keys), "c")
    }

    func testEmptyEnabledKeysIsAlwaysNil() {
        for move in TabsKeyMove.allCases {
            XCTAssertNil(TabsNavigator.nextKey(from: "a", move: move, enabledKeys: []))
        }
    }

    func testSingleEnabledKeyWrapsToItself() {
        XCTAssertEqual(TabsNavigator.nextKey(from: "only", move: .next, enabledKeys: ["only"]), "only")
        XCTAssertEqual(TabsNavigator.nextKey(from: "only", move: .previous, enabledKeys: ["only"]), "only")
    }
}

// MARK: - TabsProjector (web render body)

final class TabsProjectorTests: XCTestCase {
    private func project(_ input: TabsInput, emptyLabel: String = "No tabs available") -> TabsProjection {
        TabsProjector.project(input, tablistID: "t1", emptyLabel: emptyLabel)
    }

    private var sample: TabsInput {
        TabsInput(
            tabs: [
                TabItem(key: "overview", label: "Overview"),
                TabItem(key: "sharing", label: "Sharing", disabled: true),
                TabItem(key: "trips", label: "Trips")
            ],
            activeTab: "trips",
            ariaLabel: "Sections"
        )
    }

    func testItemsCarrySelectedAndDisabledFlags() {
        let items = project(sample).items
        XCTAssertEqual(items.count, 3)
        XCTAssertFalse(items[0].isSelected)
        XCTAssertFalse(items[0].isDisabled)
        XCTAssertTrue(items[1].isDisabled)
        XCTAssertFalse(items[1].isSelected)
        XCTAssertTrue(items[2].isSelected)
    }

    func testItemsCarryElementAndPanelIDs() {
        let item = project(sample).items[0]
        XCTAssertEqual(item.tabElementID, "t1-tab-overview")
        XCTAssertEqual(item.panelID, "t1-panel-overview")
    }

    func testProjectionCarriesEnabledKeysSelectionAndLabel() {
        let projection = project(sample)
        XCTAssertEqual(projection.enabledKeys, ["overview", "trips"])
        XCTAssertEqual(projection.selectedKey, "trips")
        XCTAssertEqual(projection.accessibilityLabel, "Sections")
        XCTAssertEqual(projection.tablistID, "t1")
        XCTAssertFalse(projection.isEmpty)
        XCTAssertTrue(projection.isEnabled("overview"))
        XCTAssertFalse(projection.isEnabled("sharing"))
    }

    func testEmptyInputProjectsTheEmptyBranchWithLabel() {
        let projection = project(TabsInput(tabs: [], activeTab: ""), emptyLabel: "Nothing here")
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.items, [])
        XCTAssertEqual(projection.emptyLabel, "Nothing here")
        XCTAssertNil(projection.accessibilityLabel)
    }

    func testIsFocusableProjectsRovingTabIndex() {
        // Selected + enabled → the single roving stop; disabled-selected or unselected → not focusable.
        let enabledSelected = TabsItemProjection(
            key: "a", label: "A", isSelected: true, isDisabled: false,
            tabElementID: "t1-tab-a", panelID: "t1-panel-a"
        )
        let disabledSelected = TabsItemProjection(
            key: "b", label: "B", isSelected: true, isDisabled: true,
            tabElementID: "t1-tab-b", panelID: "t1-panel-b"
        )
        let unselected = TabsItemProjection(
            key: "c", label: "C", isSelected: false, isDisabled: false,
            tabElementID: "t1-tab-c", panelID: "t1-panel-c"
        )
        XCTAssertTrue(enabledSelected.isFocusable)
        XCTAssertFalse(disabledSelected.isFocusable)
        XCTAssertFalse(unselected.isFocusable)
    }

    func testProjectionEquality() {
        XCTAssertEqual(project(sample), project(sample))
        XCTAssertNotEqual(
            project(sample),
            project(TabsInput(tabs: sample.tabs, activeTab: "overview", ariaLabel: "Sections"))
        )
    }
}
