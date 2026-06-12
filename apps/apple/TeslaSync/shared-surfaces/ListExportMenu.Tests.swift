//
//  ListExportMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0155 · ListExportMenu (Apple)
//
//  Unit coverage for the ListExportMenu surface logic (the surface's pure projection layer — the
//  "adapter" for a hookless, presentational control):
//    • Logic — the scope initialiser, the selected→visible auto-correction, the scope-chooser gate,
//      the effective scope handed to the export, the trigger-label switch, the open guard, and the
//      ordered CSV/JSON format list (the verbatim port of the web behaviour).
//    • Accessibility — the spoken label seam: every scope/format label resolves non-empty, and the
//      trigger resolves a label in all three availability states.
//    • i18n facade — the per-surface table resolves each web key to its English fallback, incl. the
//      ungrouped `{{count}}` interpolation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  export-dispatch contract is asserted in `…ModelTests.swift`; per-branch view rendering is covered
//  by the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - Scope rules + projection (web useState init / useEffect / fieldset gate / export scope)

@MainActor final class ListExportMenuLogicTests: XCTestCase {
    func testInitialScopeDefaultsToVisibleWithoutSelection() {
        XCTAssertEqual(ListExportMenuLogic.initialScope(selectedCount: 0), .visible)
    }

    func testInitialScopeDefaultsToSelectedWithSelection() {
        XCTAssertEqual(ListExportMenuLogic.initialScope(selectedCount: 3), .selected)
    }

    func testCorrectedScopeSnapsSelectedToVisibleWhenSelectionEmpties() {
        XCTAssertEqual(ListExportMenuLogic.correctedScope(.selected, selectedCount: 0), .visible)
    }

    func testCorrectedScopeLeavesSelectedWhenSelectionRemains() {
        XCTAssertEqual(ListExportMenuLogic.correctedScope(.selected, selectedCount: 2), .selected)
    }

    func testCorrectedScopeLeavesVisibleUntouched() {
        XCTAssertEqual(ListExportMenuLogic.correctedScope(.visible, selectedCount: 0), .visible)
        XCTAssertEqual(ListExportMenuLogic.correctedScope(.visible, selectedCount: 5), .visible)
    }

    func testShowsScopeChooserFollowsSelection() {
        XCTAssertFalse(ListExportMenuLogic.showsScopeChooser(selectedCount: 0))
        XCTAssertTrue(ListExportMenuLogic.showsScopeChooser(selectedCount: 1))
    }

    func testEffectiveScopeIsVisibleWhenChooserHidden() {
        // No selection → the chooser is hidden → the export always covers the visible set, even if a
        // stale `.selected` lingered in state.
        XCTAssertEqual(ListExportMenuLogic.effectiveScope(.selected, selectedCount: 0), .visible)
        XCTAssertEqual(ListExportMenuLogic.effectiveScope(.visible, selectedCount: 0), .visible)
    }

    func testEffectiveScopeHonoursChoiceWhenChooserShown() {
        XCTAssertEqual(ListExportMenuLogic.effectiveScope(.selected, selectedCount: 4), .selected)
        XCTAssertEqual(ListExportMenuLogic.effectiveScope(.visible, selectedCount: 4), .visible)
    }

    func testTriggerLabelSwitch() {
        XCTAssertEqual(ListExportMenuLogic.triggerLabel(availability: .ready).key, "listExport.menuLabel")
        XCTAssertEqual(
            ListExportMenuLogic.triggerLabel(availability: .loading).key,
            "listExport.disabledTooltip"
        )
        XCTAssertEqual(
            ListExportMenuLogic.triggerLabel(availability: .empty).key,
            "listExport.disabledTooltip"
        )
    }

    func testCanOpenOnlyWhenReady() {
        XCTAssertTrue(ListExportMenuLogic.canOpen(availability: .ready))
        XCTAssertFalse(ListExportMenuLogic.canOpen(availability: .loading))
        XCTAssertFalse(ListExportMenuLogic.canOpen(availability: .empty))
    }

    func testAvailabilityDisabledFlag() {
        XCTAssertFalse(ListExportAvailability.ready.isDisabled)
        XCTAssertTrue(ListExportAvailability.loading.isDisabled)
        XCTAssertTrue(ListExportAvailability.empty.isDisabled)
    }

    func testFormatOrderIsCsvThenJson() {
        XCTAssertEqual(ListExportMenuLogic.formatOrder, [.csv, .json])
    }

    func testFormatSystemImages() {
        XCTAssertEqual(ListExportFormat.csv.systemImage, "tablecells")
        XCTAssertEqual(ListExportFormat.json.systemImage, "curlybraces")
    }

    func testFormatLabelKeys() {
        XCTAssertEqual(ListExportMenuLogic.label(for: .csv).key, "listExport.csv")
        XCTAssertEqual(ListExportMenuLogic.label(for: .json).key, "listExport.json")
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class ListExportMenuAccessibilityTests: XCTestCase {
    func testTriggerLabelResolvesInEveryAvailability() {
        XCTAssertEqual(ListExportMenuStrings.triggerLabel(availability: .ready), "Export list")
        XCTAssertEqual(ListExportMenuStrings.triggerLabel(availability: .loading), "No data to export")
        XCTAssertEqual(ListExportMenuStrings.triggerLabel(availability: .empty), "No data to export")
    }

    func testFormatLabelsResolveToWebFallbacks() {
        XCTAssertEqual(ListExportMenuStrings.formatLabel(.csv), "Download as CSV")
        XCTAssertEqual(ListExportMenuStrings.formatLabel(.json), "Download as JSON")
    }

    func testEveryFormatHasNonEmptySpokenLabel() {
        for format in ListExportMenuLogic.formatOrder {
            XCTAssertFalse(
                ListExportMenuStrings.formatLabel(format).isEmpty,
                "\(format) must resolve a non-empty spoken label"
            )
        }
    }

    func testScopeLabelsResolveNonEmpty() {
        XCTAssertFalse(
            ListExportMenuStrings.scopeLabel(.visible, visibleCount: 10, selectedCount: 3).isEmpty
        )
        XCTAssertFalse(
            ListExportMenuStrings.scopeLabel(.selected, visibleCount: 10, selectedCount: 3).isEmpty
        )
    }
}

// MARK: - i18n facade (web `t(key, default)` + `{{count}}` parity)

@MainActor final class ListExportMenuStringsTests: XCTestCase {
    func testTriggerKeysResolveToWebFallbacks() {
        XCTAssertEqual(ListExportMenuStrings.string("listExport.menuLabel", "Export list"), "Export list")
        XCTAssertEqual(
            ListExportMenuStrings.string("listExport.disabledTooltip", "No data to export"),
            "No data to export"
        )
        XCTAssertEqual(ListExportMenuStrings.exportButtonLabel(), "Export")
        XCTAssertEqual(ListExportMenuStrings.scopeLegend(), "Export scope")
    }

    func testFormatKeysResolveToWebFallbacks() {
        XCTAssertEqual(ListExportMenuStrings.string("listExport.csv", "Download as CSV"), "Download as CSV")
        XCTAssertEqual(
            ListExportMenuStrings.string("listExport.json", "Download as JSON"),
            "Download as JSON"
        )
    }

    func testVisibleLabelWithCountInterpolatesUngrouped() {
        XCTAssertEqual(ListExportMenuStrings.visibleScopeLabel(visibleCount: 1234), "Visible (1234)")
    }

    func testVisibleLabelWithoutCountFallsBackToBareLabel() {
        XCTAssertEqual(ListExportMenuStrings.visibleScopeLabel(visibleCount: nil), "Visible")
    }

    func testSelectedLabelAlwaysCarriesCount() {
        XCTAssertEqual(ListExportMenuStrings.selectedScopeLabel(selectedCount: 3), "Selected (3)")
    }

    func testScopeLabelDispatch() {
        XCTAssertEqual(
            ListExportMenuStrings.scopeLabel(.visible, visibleCount: 42, selectedCount: 3),
            "Visible (42)"
        )
        XCTAssertEqual(
            ListExportMenuStrings.scopeLabel(.selected, visibleCount: 42, selectedCount: 3),
            "Selected (3)"
        )
    }

    func testCountInterpolationLeavesPlainTemplatesUntouched() {
        XCTAssertEqual(ListExportMenuStrings.interpolateCount("plain text", 9), "plain text")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(ListExportMenuStrings.table, "ListExportMenu")
    }
}
