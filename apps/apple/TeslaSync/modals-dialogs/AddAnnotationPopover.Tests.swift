//
//  AddAnnotationPopover.Tests.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  Adapter + projection + accessibility coverage for the AddAnnotationPopover surface:
//    • `AddAnnotationDateValue` — the verbatim port of `toDateInputValue` / `toIsoTimestamp`.
//    • `AddAnnotationCategory` — the six categories in `CATEGORY_OPTIONS` order with their exact
//      `ANNOTATION_COLORS` hex + i18n keys.
//    • `AddAnnotationProjection` — phase resolution, the `occurredAt` rule, the submit guard, and
//      the validated draft assembly (trim + optional description).
//    • `AddAnnotationAccessibility` — the dialog summary + category + timestamp VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without
/// a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Date helpers (web toDateInputValue / toIsoTimestamp)

final class AddAnnotationDateValueTests: XCTestCase {
    func testInputValueEmptyForEmptyTimestamp() {
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: ""), "")
    }

    func testInputValueNormalisesIsoTimestampToUTCDay() {
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: "2024-05-18T14:30:00Z"), "2024-05-18")
    }

    func testInputValueNormalisesFractionalIso() {
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: "2024-05-18T14:30:00.250Z"), "2024-05-18")
    }

    func testInputValueAcceptsBareDate() {
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: "2024-05-18"), "2024-05-18")
    }

    func testInputValueEmptyForUnparseableText() {
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: "not a date"), "")
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: "garbage"), "")
    }

    func testInputValueAcceptsShapeValidStringVerbatimWhenUnparseable() {
        // Web parity: `toDateInputValue` accepts a `YYYY-MM-DD`-shaped value verbatim when
        // `new Date(...)` fails (its own "accept verbatim" branch), even if the day is out of range.
        XCTAssertEqual(AddAnnotationDateValue.inputValue(fromTimestamp: "2024-13-45"), "2024-13-45")
    }

    func testIsoTimestampPinsToUTCMidnight() {
        XCTAssertEqual(AddAnnotationDateValue.isoTimestamp(fromInputValue: "2024-05-18"), "2024-05-18T00:00:00Z")
    }

    func testIsoTimestampEmptyForEmptyOrMalformed() {
        XCTAssertEqual(AddAnnotationDateValue.isoTimestamp(fromInputValue: ""), "")
        XCTAssertEqual(AddAnnotationDateValue.isoTimestamp(fromInputValue: "18/05/2024"), "")
        XCTAssertEqual(AddAnnotationDateValue.isoTimestamp(fromInputValue: "2024-5-8"), "")
    }

    func testIsDateOnlyShapeGuard() {
        XCTAssertTrue(AddAnnotationDateValue.isDateOnly("2024-05-18"))
        XCTAssertFalse(AddAnnotationDateValue.isDateOnly("2024-05-18T00:00:00Z"))
        XCTAssertFalse(AddAnnotationDateValue.isDateOnly("24-05-18"))
    }

    func testDateRoundTripsThroughInputValue() throws {
        let date = AddAnnotationDateValue.date(fromInputValue: "2024-05-18")
        XCTAssertNotNil(date)
        XCTAssertEqual(try AddAnnotationDateValue.inputValue(fromDate: XCTUnwrap(date)), "2024-05-18")
    }

    func testDateNilForMalformedInputValue() {
        XCTAssertNil(AddAnnotationDateValue.date(fromInputValue: "nope"))
    }
}

// MARK: - Category catalog (web CATEGORY_OPTIONS + ANNOTATION_COLORS)

final class AddAnnotationCategoryTests: XCTestCase {
    func testOrderMatchesWebCategoryOptions() {
        XCTAssertEqual(
            AddAnnotationCategory.order.map(\.rawValue),
            ["milestone", "maintenance", "trip", "issue", "upgrade", "custom"]
        )
    }

    func testColorsMatchWebAnnotationColors() {
        let colors = Dictionary(
            uniqueKeysWithValues: AddAnnotationCategory.order.map { ($0.rawValue, $0.option.colorHex) }
        )
        XCTAssertEqual(colors["milestone"], "#3b82f6")
        XCTAssertEqual(colors["maintenance"], "#f59e0b")
        XCTAssertEqual(colors["trip"], "#22c55e")
        XCTAssertEqual(colors["issue"], "#ef4444")
        XCTAssertEqual(colors["upgrade"], "#a855f7")
        XCTAssertEqual(colors["custom"], "#94a3b8")
    }

    func testEveryOptionCarriesKeyGlyphAndLabel() {
        for category in AddAnnotationCategory.order {
            let option = category.option
            XCTAssertEqual(option.labelKey, "annotation.cat.\(category.rawValue)")
            XCTAssertFalse(option.labelFallback.isEmpty)
            XCTAssertFalse(option.systemImage.isEmpty)
        }
    }
}

// MARK: - Projection: phase resolution

final class AddAnnotationPhaseTests: XCTestCase {
    private let fixed = AddAnnotationDraftContext(timestamp: "2024-05-18T14:30:00Z", editableDate: false)

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .loading, context: nil), .loading)
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .loading, context: fixed), .content)
    }

    func testLoadedNoContextResolvesEmpty() {
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .loaded, context: nil), .empty)
    }

    func testLoadedUnusableTimestampResolvesEmpty() {
        let bad = AddAnnotationDraftContext(timestamp: "not-a-date", editableDate: false)
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .loaded, context: bad), .empty)
    }

    func testLoadedEditableDateResolvesContentEvenWithoutTimestamp() {
        let editable = AddAnnotationDraftContext(timestamp: "", editableDate: true)
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .loaded, context: editable), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .failed("boom"), context: nil), .error("boom"))
        XCTAssertEqual(AddAnnotationProjection.resolvePhase(status: .failed("boom"), context: fixed), .content)
    }
}

// MARK: - Projection: occurredAt / canSubmit / draft

final class AddAnnotationSubmitTests: XCTestCase {
    func testOccurredAtUsesFixedTimestampWhenNotEditable() {
        let value = AddAnnotationProjection.occurredAt(
            editableDate: false,
            editedDate: "2024-01-01",
            timestamp: "2024-05-18T14:30:00Z"
        )
        XCTAssertEqual(value, "2024-05-18T14:30:00Z")
    }

    func testOccurredAtPinsEditedDateWhenEditable() {
        let value = AddAnnotationProjection.occurredAt(
            editableDate: true,
            editedDate: "2024-01-02",
            timestamp: "ignored"
        )
        XCTAssertEqual(value, "2024-01-02T00:00:00Z")
    }

    func testCanSubmitRequiresLabelAndOccurredAt() {
        XCTAssertTrue(AddAnnotationProjection.canSubmit(label: "Tires", occurredAt: "2024-05-18T00:00:00Z"))
        XCTAssertFalse(AddAnnotationProjection.canSubmit(label: "   ", occurredAt: "2024-05-18T00:00:00Z"))
        XCTAssertFalse(AddAnnotationProjection.canSubmit(label: "Tires", occurredAt: ""))
    }

    func testDraftTrimsLabelAndOmitsBlankDescription() {
        let draft = AddAnnotationProjection.draft(
            label: "  Battery replaced  ",
            category: .maintenance,
            description: "   ",
            occurredAt: "2024-05-18T00:00:00Z"
        )
        XCTAssertEqual(draft?.label, "Battery replaced")
        XCTAssertEqual(draft?.category, .maintenance)
        XCTAssertNil(draft?.description)
        XCTAssertEqual(draft?.occurredAt, "2024-05-18T00:00:00Z")
    }

    func testDraftKeepsTrimmedDescription() {
        let draft = AddAnnotationProjection.draft(
            label: "Upgrade",
            category: .upgrade,
            description: "  new firmware  ",
            occurredAt: "2024-05-18T00:00:00Z"
        )
        XCTAssertEqual(draft?.description, "new firmware")
    }

    func testDraftNilWhenGuardFails() {
        XCTAssertNil(AddAnnotationProjection.draft(
            label: "  ",
            category: .custom,
            description: "x",
            occurredAt: "2024-05-18T00:00:00Z"
        ))
        XCTAssertNil(AddAnnotationProjection.draft(
            label: "Valid",
            category: .custom,
            description: "x",
            occurredAt: ""
        ))
    }
}

// MARK: - Accessibility

final class AddAnnotationAccessibilityTests: XCTestCase {
    func testSummaryIsDialogTitle() {
        XCTAssertEqual(
            AddAnnotationAccessibility.summary(localize: passthroughLocalize),
            "Add Annotation"
        )
    }

    func testCategoryLabelAppendsSelectedState() {
        let option = AddAnnotationCategory.trip.option
        XCTAssertEqual(
            AddAnnotationAccessibility.categoryLabel(option, selected: false, localize: passthroughLocalize),
            "Trip"
        )
        XCTAssertEqual(
            AddAnnotationAccessibility.categoryLabel(option, selected: true, localize: passthroughLocalize),
            "Trip, selected"
        )
    }

    func testTimestampLabelSubstitutesDay() {
        XCTAssertEqual(
            AddAnnotationAccessibility.timestampLabel("2024-05-18", localize: passthroughLocalize),
            "Annotating 2024-05-18"
        )
    }
}
