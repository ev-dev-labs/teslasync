//
//  BulkActionsToolbar.Tests.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  Adapter + projection coverage for the BulkActionsToolbar surface:
//    • Selection id — the lossless `string | number` mirror + its stable identity.
//    • Interpolation — the i18next `{{token}}` substitution.
//    • Label builders — the verbatim ports of `bulk.selected`, the `itemNoun ? one/other :
//      bulk.itemDefault` noun, and the `bulk.ofTotal` suffix.
//    • Accessibility — the composed selection summary + the per-action busy / confirm hint.
//    • Projection — the web gate (`count === 0`) plus the P4 leaf contract across loading / empty /
//      error / active, and the per-action `disabled || pending` + confirm-required rules.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure core directly.
//

import XCTest
@testable import TeslaSync

/// Identity resolver — returns each key's English fallback so the assertions read the web copy.
private let resolve: BulkActionsResolve = { _, fallback in fallback }

private func descriptor(
    _ id: String,
    label: String,
    variant: BulkActionVariant = .default,
    confirm: BulkActionConfirm? = nil,
    isDisabled: Bool = false
) -> BulkActionDescriptor {
    BulkActionDescriptor(
        id: id,
        label: label,
        variant: variant,
        confirm: confirm,
        isDisabled: isDisabled
    ) { _ in }
}

// MARK: - Selection id (web `string | number`)

final class BulkSelectionIDTests: XCTestCase {
    func testDescriptionRendersBothCases() {
        XCTAssertEqual(BulkSelectionID.int(48).description, "48")
        XCTAssertEqual(BulkSelectionID.string("trip-7").description, "trip-7")
    }

    func testIdentityMatchesDescription() {
        XCTAssertEqual(BulkSelectionID.int(48).id, "48")
        XCTAssertEqual(BulkSelectionID.string("trip-7").id, "trip-7")
    }

    func testEquatableDistinguishesCases() {
        XCTAssertNotEqual(BulkSelectionID.int(7), BulkSelectionID.string("7"))
        XCTAssertEqual(BulkSelectionID.int(7), BulkSelectionID.int(7))
    }
}

// MARK: - Interpolation (web i18next `{{token}}`)

final class BulkActionsInterpolationTests: XCTestCase {
    func testSubstitutesSingleToken() {
        XCTAssertEqual(
            BulkActionsFormat.interpolate("{{count}} selected", ["count": "3"]),
            "3 selected"
        )
    }

    func testLeavesTemplateUntouchedWhenTokenAbsent() {
        XCTAssertEqual(BulkActionsFormat.interpolate("nothing here", ["count": "3"]), "nothing here")
    }
}

// MARK: - Label builders (web `t()` calls)

final class BulkActionsLabelTests: XCTestCase {
    func testCountLabel() {
        XCTAssertEqual(BulkActionsFormat.countLabel(count: 3, strings: resolve), "3 selected")
        XCTAssertEqual(BulkActionsFormat.countLabel(count: 1, strings: resolve), "1 selected")
    }

    func testNounUsesSingularForOne() {
        let noun = BulkItemNoun(one: "drive", other: "drives")
        XCTAssertEqual(BulkActionsFormat.noun(count: 1, itemNoun: noun, strings: resolve), "drive")
    }

    func testNounUsesPluralForMany() {
        let noun = BulkItemNoun(one: "drive", other: "drives")
        XCTAssertEqual(BulkActionsFormat.noun(count: 4, itemNoun: noun, strings: resolve), "drives")
    }

    func testNounFallsBackToDefaultWithoutItemNoun() {
        XCTAssertEqual(BulkActionsFormat.noun(count: 4, itemNoun: nil, strings: resolve), "item")
    }

    func testTotalLabel() {
        XCTAssertEqual(BulkActionsFormat.totalLabel(total: 27, strings: resolve), "of 27")
    }
}

// MARK: - Accessibility summaries

final class BulkActionsAccessibilityTests: XCTestCase {
    func testSummaryJoinsCountNounAndTotal() {
        let summary = BulkActionsAccessibility.selectionSummary(
            countLabel: "3 selected",
            nounText: "drives",
            totalText: "of 27"
        )
        XCTAssertEqual(summary, "3 selected drives of 27")
    }

    func testSummaryWithCountOnly() {
        let summary = BulkActionsAccessibility.selectionSummary(
            countLabel: "3 selected",
            nounText: nil,
            totalText: nil
        )
        XCTAssertEqual(summary, "3 selected")
    }

    func testActionHintBusyTakesPrecedence() {
        let hint = BulkActionsAccessibility.actionHint(isPending: true, requiresConfirm: true, strings: resolve)
        XCTAssertEqual(hint, "Working…")
    }

    func testActionHintConfirmWhenNotPending() {
        let hint = BulkActionsAccessibility.actionHint(isPending: false, requiresConfirm: true, strings: resolve)
        XCTAssertEqual(hint, "Asks for confirmation")
    }

    func testActionHintNilWhenNeither() {
        let hint = BulkActionsAccessibility.actionHint(isPending: false, requiresConfirm: false, strings: resolve)
        XCTAssertNil(hint)
    }
}

// MARK: - Projection (web gate + P4 leaf contract)

final class BulkActionsProjectionTests: XCTestCase {
    private let selection: [BulkSelectionID] = [.int(1), .int(2), .int(3)]

    private func active(
        itemNoun: BulkItemNoun? = nil,
        total: Int? = nil,
        actions: [BulkActionDescriptor] = []
    ) -> BulkActionsInput {
        BulkActionsInput(selection: selection, total: total, itemNoun: itemNoun, actions: actions)
    }

    func testErrorTakesPrecedence() {
        let resolved = BulkActionsProjection.resolve(
            BulkActionsInput(selection: selection, isLoading: true, errorMessage: "boom"),
            strings: resolve
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.actions.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = BulkActionsProjection.resolve(BulkActionsInput(isLoading: true), strings: resolve)
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoSelection() {
        let resolved = BulkActionsProjection.resolve(BulkActionsInput(), strings: resolve)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = BulkActionsProjection.resolve(
            BulkActionsInput(selection: selection, errorMessage: ""),
            strings: resolve
        )
        XCTAssertEqual(resolved.phase, .active)
    }

    func testActiveCountAndLabel() {
        let resolved = BulkActionsProjection.resolve(active(), strings: resolve)
        XCTAssertEqual(resolved.phase, .active)
        XCTAssertEqual(resolved.count, 3)
        XCTAssertEqual(resolved.countLabel, "3 selected")
    }

    func testNounAndTotalOnlyShowWithItemNoun() {
        let withNoun = BulkActionsProjection.resolve(
            active(itemNoun: BulkItemNoun(one: "drive", other: "drives"), total: 27),
            strings: resolve
        )
        XCTAssertEqual(withNoun.nounText, "drives")
        XCTAssertEqual(withNoun.totalText, "of 27")

        let withoutNoun = BulkActionsProjection.resolve(active(total: 27), strings: resolve)
        XCTAssertNil(withoutNoun.nounText)
        XCTAssertNil(withoutNoun.totalText)
    }

    func testActionsProjectedInOrder() {
        let resolved = BulkActionsProjection.resolve(
            active(actions: [
                descriptor("export", label: "Export"),
                descriptor("delete", label: "Delete", variant: .danger)
            ]),
            strings: resolve
        )
        XCTAssertEqual(resolved.actions.map(\.id), ["export", "delete"])
        XCTAssertEqual(resolved.actions.last?.variant, .danger)
    }

    func testActionDisabledWhenDescriptorDisabled() {
        let resolved = BulkActionsProjection.resolve(
            active(actions: [descriptor("export", label: "Export", isDisabled: true)]),
            strings: resolve
        )
        XCTAssertEqual(resolved.actions.first?.isDisabled, true)
        XCTAssertEqual(resolved.actions.first?.isPending, false)
    }

    func testActionDisabledAndPendingWhenInFlight() {
        let resolved = BulkActionsProjection.resolve(
            active(actions: [descriptor("export", label: "Export")]),
            inFlight: ["export"],
            strings: resolve
        )
        XCTAssertEqual(resolved.actions.first?.isPending, true)
        XCTAssertEqual(resolved.actions.first?.isDisabled, true)
    }

    func testRequiresConfirmReflectsDescriptor() {
        let confirm = BulkActionConfirm(title: "Delete?", message: "Gone for good.")
        let resolved = BulkActionsProjection.resolve(
            active(actions: [
                descriptor("delete", label: "Delete", variant: .danger, confirm: confirm),
                descriptor("export", label: "Export")
            ]),
            strings: resolve
        )
        XCTAssertEqual(resolved.actions.first?.requiresConfirm, true)
        XCTAssertEqual(resolved.actions.last?.requiresConfirm, false)
    }

    func testChromeStatesKeepToolbarAndClearLabels() {
        let resolved = BulkActionsProjection.resolve(BulkActionsInput(), strings: resolve)
        XCTAssertEqual(resolved.toolbarLabel, "Bulk actions for selected items")
        XCTAssertEqual(resolved.clearLabel, "Clear selection")
    }
}
