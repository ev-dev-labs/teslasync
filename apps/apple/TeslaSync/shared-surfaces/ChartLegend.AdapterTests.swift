//
//  ChartLegend.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  Coverage for the pure, dependency-light core of the ChartLegend surface:
//    • Item — the legend-entry defaults (the Recharts payload-entry subset).
//    • Palette — the `#rrggbb` decoder: exact components, with/without `#`, and the absent / malformed
//      guards (the brand-palette fallback boundary).
//    • Hidden algebra — the native `useChartHiddenSeries` set logic: toggle add/remove, explicit set.
//    • Accessibility — the entry label + the interactive shown/hidden value vs the passive blank.
//    • Interactivity — the web `resolved == null` passive flag.
//    • Input / Meta — the snapshot defaults, `replacingHidden`, and the diagnostics slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Item (web Recharts legend payload entry)

final class ChartLegendItemTests: XCTestCase {
    func testDefaults() {
        let item = ChartLegendItem(id: "speed", label: "Speed")
        XCTAssertEqual(item.id, "speed")
        XCTAssertEqual(item.label, "Speed")
        XCTAssertNil(item.colorHex)
        XCTAssertEqual(item.paletteIndex, 0)
    }

    func testCarriesExplicitColorAndIndex() {
        let item = ChartLegendItem(id: "power", label: "Power", colorHex: "#a855f7", paletteIndex: 3)
        XCTAssertEqual(item.colorHex, "#a855f7")
        XCTAssertEqual(item.paletteIndex, 3)
    }
}

// MARK: - Palette (`#rrggbb` decoder)

final class ChartLegendPaletteTests: XCTestCase {
    private let accuracy = 1.0 / 512.0

    func testDecodesBlue() {
        let parts = ChartLegendPalette.components(forHex: "#3b82f6")
        XCTAssertNotNil(parts)
        XCTAssertEqual(parts?.red ?? -1, Double(0x3B) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.green ?? -1, Double(0x82) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.blue ?? -1, Double(0xF6) / 255, accuracy: accuracy)
    }

    func testAcceptsBareHexWithoutHash() {
        let withHash = ChartLegendPalette.components(forHex: "#22c55e")
        let bare = ChartLegendPalette.components(forHex: "22c55e")
        XCTAssertEqual(withHash, bare)
    }

    func testRejectsAbsentAndMalformed() {
        XCTAssertNil(ChartLegendPalette.components(forHex: nil))
        XCTAssertNil(ChartLegendPalette.components(forHex: ""))
        XCTAssertNil(ChartLegendPalette.components(forHex: "   "))
        XCTAssertNil(ChartLegendPalette.components(forHex: "#fff"))
        XCTAssertNil(ChartLegendPalette.components(forHex: "#zzzzzz"))
        XCTAssertNil(ChartLegendPalette.components(forHex: "#3b82f6ff"))
    }
}

// MARK: - Hidden algebra (web `useChartHiddenSeries` set logic)

final class ChartLegendHiddenTests: XCTestCase {
    func testTogglingAddsThenRemoves() {
        let afterAdd = ChartLegendHidden.toggling([], "power")
        XCTAssertEqual(afterAdd, ["power"])
        let afterRemove = ChartLegendHidden.toggling(afterAdd, "power")
        XCTAssertTrue(afterRemove.isEmpty)
    }

    func testTogglingPreservesOtherKeys() {
        let result = ChartLegendHidden.toggling(["speed"], "power")
        XCTAssertEqual(result, ["speed", "power"])
    }

    func testSettingHiddenAndVisible() {
        let hidden = ChartLegendHidden.setting([], "speed", hidden: true)
        XCTAssertEqual(hidden, ["speed"])
        let visible = ChartLegendHidden.setting(hidden, "speed", hidden: false)
        XCTAssertTrue(visible.isEmpty)
    }

    func testSettingIsIdempotent() {
        let once = ChartLegendHidden.setting(["speed"], "speed", hidden: true)
        XCTAssertEqual(once, ["speed"])
    }
}

// MARK: - Accessibility (entry label + visibility value)

final class ChartLegendAccessibilityTests: XCTestCase {
    func testEntryLabelIsTheName() {
        XCTAssertEqual(ChartLegendAccessibility.entryLabel(name: "Battery"), "Battery")
    }

    func testInteractiveValueReflectsHidden() {
        XCTAssertEqual(
            ChartLegendAccessibility.entryValue(isInteractive: true, isHidden: false, shown: "Shown", hidden: "Hidden"),
            "Shown"
        )
        XCTAssertEqual(
            ChartLegendAccessibility.entryValue(isInteractive: true, isHidden: true, shown: "Shown", hidden: "Hidden"),
            "Hidden"
        )
    }

    func testPassiveValueIsBlank() {
        XCTAssertEqual(
            ChartLegendAccessibility.entryValue(isInteractive: false, isHidden: true, shown: "Shown", hidden: "Hidden"),
            ""
        )
    }
}

// MARK: - Interactivity / input / meta

final class ChartLegendInputTests: XCTestCase {
    func testInteractivityFlag() {
        XCTAssertTrue(ChartLegendInteractivity.interactive.isInteractive)
        XCTAssertFalse(ChartLegendInteractivity.passive.isInteractive)
    }

    func testInputDefaults() {
        let input = ChartLegendInput()
        XCTAssertEqual(input.availability, .loading)
        XCTAssertEqual(input.connection, .live)
        XCTAssertEqual(input.interactivity, .interactive)
        XCTAssertEqual(input.emptyBehavior, .emptyState)
        XCTAssertEqual(input.alignment, .center)
        XCTAssertTrue(input.hidden.isEmpty)
    }

    func testReplacingHiddenIsNonMutating() {
        let base = ChartLegendInput(availability: .resolved([]), connection: .stale)
        let next = base.replacingHidden(["power"])
        XCTAssertTrue(base.hidden.isEmpty, "original is unchanged")
        XCTAssertEqual(next.hidden, ["power"])
        XCTAssertEqual(next.connection, .stale, "other fields are preserved")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChartLegendMeta.surfaceSlug, "ChartLegend")
        XCTAssertEqual(ChartLegend.surfaceSlug, "ChartLegend")
    }
}
