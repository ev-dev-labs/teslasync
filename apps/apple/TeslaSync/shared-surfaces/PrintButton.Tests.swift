//
//  PrintButton.Tests.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  Unit coverage for the PrintButton surface logic:
//    • Logic — the glyph (web `<Printer/>`), the visible-label resolution (web
//      `label ?? t(…, 'Print')`), the accessibility-label resolution (web
//      `ariaLabel ?? (iconOnly ? printLabel : undefined)`), and the re-entrancy guard (web
//      `if (printing) return`).
//    • View-state — the per-state projection the view renders (the deterministic snapshot of the
//      view's inputs in the resting / icon-only / custom-label / disabled states); the on-screen
//      rendering is covered by the #Preview blocks (precedent: CopyButton 0207 / FullscreenButton
//      0214).
//    • Accessibility — the spoken-label seam: a non-empty, override-aware accessibility label.
//    • i18n facade — the per-surface table resolves the web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  print-flow contract is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Pure logic (web glyph / label / aria switch, re-entrancy guard)

@MainActor final class PrintButtonLogicTests: XCTestCase {
    func testIconIsPrinterGlyph() {
        XCTAssertEqual(PrintButtonLogic.iconSystemImage(), "printer")
    }

    func testVisibleLabelDefaultsToPrint() {
        XCTAssertEqual(
            PrintButtonLogic.visibleLabel(labelOverride: nil, defaultLabel: "Print"),
            "Print"
        )
    }

    func testVisibleLabelUsesOverride() {
        XCTAssertEqual(
            PrintButtonLogic.visibleLabel(labelOverride: "Print snapshot", defaultLabel: "Print"),
            "Print snapshot",
            "a caller `label` override wins over the default (web `label ?? printLabel`)"
        )
    }

    func testAccessibilityLabelFallsBackToVisibleLabel() {
        XCTAssertEqual(
            PrintButtonLogic.accessibilityLabel(ariaLabel: nil, labelOverride: nil, defaultLabel: "Print"),
            "Print",
            "with no override the spoken label is the visible text (web undefined → visible label)"
        )
    }

    func testAccessibilityLabelUsesLabelOverride() {
        XCTAssertEqual(
            PrintButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                labelOverride: "Print snapshot",
                defaultLabel: "Print"
            ),
            "Print snapshot"
        )
    }

    func testAccessibilityLabelAriaOverrideWins() {
        XCTAssertEqual(
            PrintButtonLogic.accessibilityLabel(
                ariaLabel: "Print this report",
                labelOverride: "Print snapshot",
                defaultLabel: "Print"
            ),
            "Print this report",
            "an explicit `ariaLabel` wins over the label + default (web `ariaLabel ?? …`)"
        )
    }

    func testShouldStartPrintGuardsInFlight() {
        XCTAssertTrue(
            PrintButtonLogic.shouldStartPrint(isPrinting: false),
            "an idle button may start a print"
        )
        XCTAssertFalse(
            PrintButtonLogic.shouldStartPrint(isPrinting: true),
            "an in-flight print blocks a second start (web `if (printing) return`)"
        )
    }
}

// MARK: - View-state projection (per-state snapshot of the view's inputs)

@MainActor final class PrintButtonViewStateTests: XCTestCase {
    func testRestingStateRendersPrinterGlyphAndPrintLabel() {
        XCTAssertEqual(PrintButtonLogic.iconSystemImage(), "printer")
        XCTAssertEqual(PrintButtonStrings.visibleLabel(labelOverride: nil), "Print")
    }

    func testCustomLabelStateRendersOverride() {
        XCTAssertEqual(
            PrintButtonStrings.visibleLabel(labelOverride: "Print snapshot"),
            "Print snapshot"
        )
    }

    func testSurfaceConstructsForEveryState() {
        // Exercises the view's construction path for the resting, icon-only, custom-label, and
        // disabled states (the in-memory presenter keeps the real print server out of the unit test).
        let resting = PrintButton(presenter: InMemoryPrintPresenter())
        let iconOnly = PrintButton(presenter: InMemoryPrintPresenter(), iconOnly: true)
        let labelled = PrintButton(presenter: InMemoryPrintPresenter(), label: "Print snapshot")
        let disabled = PrintButton(presenter: InMemoryPrintPresenter(), disabled: true)
        _ = (resting, iconOnly, labelled, disabled)
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class PrintButtonAccessibilityTests: XCTestCase {
    func testAccessibilityLabelIsNeverEmpty() {
        XCTAssertFalse(
            PrintButtonStrings.accessibilityLabel(ariaLabel: nil, labelOverride: nil).isEmpty
        )
    }

    func testAccessibilityLabelDefaultsToPrint() {
        XCTAssertEqual(
            PrintButtonStrings.accessibilityLabel(ariaLabel: nil, labelOverride: nil),
            "Print"
        )
    }

    func testAccessibilityLabelUsesOverrides() {
        XCTAssertEqual(
            PrintButtonStrings.accessibilityLabel(ariaLabel: "Print report", labelOverride: nil),
            "Print report"
        )
        XCTAssertEqual(
            PrintButtonStrings.accessibilityLabel(ariaLabel: nil, labelOverride: "Print snapshot"),
            "Print snapshot"
        )
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class PrintButtonStringsTests: XCTestCase {
    func testWebKeyResolvesToItsFallback() {
        XCTAssertEqual(
            PrintButtonStrings.string("common.printButton.print", "Print"),
            "Print"
        )
    }

    func testPrintLabelHelperResolvesToWebFallback() {
        XCTAssertEqual(PrintButtonStrings.printLabel(), "Print")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(PrintButtonStrings.table, "PrintButton")
    }
}
