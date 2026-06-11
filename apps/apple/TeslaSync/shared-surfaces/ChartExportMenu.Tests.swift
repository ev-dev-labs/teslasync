//
//  ChartExportMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0066 · ChartExportMenu (Apple)
//
//  Unit coverage for the ChartExportMenu surface logic:
//    • Logic — the menu-item projection (the verbatim port of the web JSX: optional CSV lead item,
//      then PNG / SVG / Copy, with `busy` disabling only the snapshot-dependent items), the
//      trigger-label switch, the open guard, and the clipboard-outcome → toast mapping.
//    • Accessibility — the spoken label seam: every menu item resolves a non-empty label and the
//      trigger resolves a label in both disabled states.
//    • i18n facade — the per-surface table resolves each web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  toast-dispatch contract is asserted in `…ModelTests.swift`; per-branch view rendering is covered
//  by the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - Menu-item projection (web JSX item list + busy gating)

@MainActor final class ChartExportMenuLogicTests: XCTestCase {
    func testMenuItemsWithoutCsvOrderAndCount() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: false, busy: false)
        XCTAssertEqual(items.map(\.action), [.png, .svg, .copy])
    }

    func testMenuItemsWithCsvLeadsTheMenu() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: true, busy: false)
        XCTAssertEqual(items.map(\.action), [.csv, .png, .svg, .copy])
    }

    func testBusyDisablesSnapshotItemsButNotCsv() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: true, busy: true)
        let byAction = Dictionary(uniqueKeysWithValues: items.map { ($0.action, $0.isEnabled) })
        XCTAssertEqual(byAction[.csv], true, "CSV ignores busy — it does not read the chart DOM")
        XCTAssertEqual(byAction[.png], false)
        XCTAssertEqual(byAction[.svg], false)
        XCTAssertEqual(byAction[.copy], false)
    }

    func testNotBusyEnablesEveryItem() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: true, busy: false)
        XCTAssertTrue(items.allSatisfy(\.isEnabled))
    }

    func testActionSnapshotDependence() {
        XCTAssertFalse(ChartExportMenuAction.csv.dependsOnSnapshot)
        XCTAssertTrue(ChartExportMenuAction.png.dependsOnSnapshot)
        XCTAssertTrue(ChartExportMenuAction.svg.dependsOnSnapshot)
        XCTAssertTrue(ChartExportMenuAction.copy.dependsOnSnapshot)
    }

    func testSystemImagesPerAction() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: true, busy: false)
        let byAction = Dictionary(uniqueKeysWithValues: items.map { ($0.action, $0.systemImage) })
        XCTAssertEqual(byAction[.csv], "tablecells")
        XCTAssertEqual(byAction[.png], "photo")
        XCTAssertEqual(byAction[.svg], "doc.richtext")
        XCTAssertEqual(byAction[.copy], "doc.on.doc")
    }

    func testTriggerLabelSwitch() {
        XCTAssertEqual(ChartExportMenuLogic.triggerLabel(disabled: false).key, "chart.export.menuLabel")
        XCTAssertEqual(
            ChartExportMenuLogic.triggerLabel(disabled: true).key,
            "chart.export.disabledTooltip"
        )
    }

    func testCanOpenFollowsDisabled() {
        XCTAssertTrue(ChartExportMenuLogic.canOpen(disabled: false))
        XCTAssertFalse(ChartExportMenuLogic.canOpen(disabled: true))
    }

    func testToastIntentMapping() {
        XCTAssertEqual(ChartExportMenuLogic.toastIntent(for: .copied).severity, .success)
        XCTAssertEqual(ChartExportMenuLogic.toastIntent(for: .fallback).severity, .info)
        XCTAssertEqual(ChartExportMenuLogic.toastIntent(for: .failed).severity, .error)

        XCTAssertEqual(
            ChartExportMenuLogic.toastIntent(for: .copied).messageKey,
            "chart.export.copySuccess"
        )
        XCTAssertEqual(
            ChartExportMenuLogic.toastIntent(for: .fallback).messageKey,
            "chart.export.copyFallback"
        )
        XCTAssertEqual(
            ChartExportMenuLogic.toastIntent(for: .failed).messageKey,
            "chart.export.copyFailed"
        )
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class ChartExportMenuAccessibilityTests: XCTestCase {
    func testEveryMenuItemHasNonEmptySpokenLabel() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: true, busy: false)
        for item in items {
            XCTAssertFalse(
                ChartExportMenuStrings.itemLabel(item).isEmpty,
                "\(item.action) must resolve a non-empty spoken label"
            )
        }
    }

    func testMenuItemLabelsMatchWebFallbacks() {
        let items = ChartExportMenuLogic.menuItems(hasCsv: true, busy: false)
        let byAction = Dictionary(
            uniqueKeysWithValues: items.map { ($0.action, ChartExportMenuStrings.itemLabel($0)) }
        )
        XCTAssertEqual(byAction[.csv], "Download data as CSV")
        XCTAssertEqual(byAction[.png], "Save as PNG")
        XCTAssertEqual(byAction[.svg], "Save as SVG")
        XCTAssertEqual(byAction[.copy], "Copy image to clipboard")
    }

    func testTriggerLabelResolvesInBothStates() {
        XCTAssertEqual(ChartExportMenuStrings.triggerLabel(disabled: false), "Export chart")
        XCTAssertEqual(
            ChartExportMenuStrings.triggerLabel(disabled: true),
            "Chart not ready to export"
        )
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class ChartExportMenuStringsTests: XCTestCase {
    func testTriggerKeysResolveToWebFallbacks() {
        XCTAssertEqual(
            ChartExportMenuStrings.string("chart.export.menuLabel", "Export chart"),
            "Export chart"
        )
        XCTAssertEqual(
            ChartExportMenuStrings.string("chart.export.disabledTooltip", "Chart not ready to export"),
            "Chart not ready to export"
        )
    }

    func testItemKeysResolveToWebFallbacks() {
        XCTAssertEqual(
            ChartExportMenuStrings.string("chart.export.csv", "Download data as CSV"),
            "Download data as CSV"
        )
        XCTAssertEqual(ChartExportMenuStrings.string("chart.export.png", "Save as PNG"), "Save as PNG")
        XCTAssertEqual(ChartExportMenuStrings.string("chart.export.svg", "Save as SVG"), "Save as SVG")
        XCTAssertEqual(
            ChartExportMenuStrings.string("chart.export.copy", "Copy image to clipboard"),
            "Copy image to clipboard"
        )
    }

    func testToastMessagesResolveToWebFallbacks() {
        XCTAssertEqual(
            ChartExportMenuStrings.toastMessage(for: .copied),
            "Chart image copied to clipboard"
        )
        XCTAssertEqual(
            ChartExportMenuStrings.toastMessage(for: .fallback),
            "Clipboard not available — image downloaded instead"
        )
        XCTAssertEqual(ChartExportMenuStrings.toastMessage(for: .failed), "Failed to copy chart image")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(ChartExportMenuStrings.table, "ChartExportMenu")
    }
}
