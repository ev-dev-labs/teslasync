//
//  AnnotationList.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  Coverage for the pure, dependency-light core of the AnnotationList surface:
//    • Category — the six web `AnnotationCategory` cases in declaration order, their exact
//      `ANNOTATION_COLORS` swatch, their `ANNOTATION_CATEGORY_LABELS` name, and the i18n key shape.
//    • Palette — the `#rrggbb` decoder: exact components per category, with/without `#`, and the
//      malformed-value guard.
//    • Accessibility — the row label (with / without description) + the remove label.
//    • Input / Meta — the snapshot defaults and the diagnostics slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Category (web `AnnotationCategory` + `ANNOTATION_COLORS` + `ANNOTATION_CATEGORY_LABELS`)

final class AnnotationListCategoryTests: XCTestCase {
    func testOrderMatchesWebUnion() {
        XCTAssertEqual(
            AnnotationListCategory.order.map(\.rawValue),
            ["milestone", "maintenance", "trip", "issue", "upgrade", "custom"]
        )
    }

    func testAllCasesCoveredByOrder() {
        XCTAssertEqual(Set(AnnotationListCategory.order), Set(AnnotationListCategory.allCases))
    }

    func testColorsMatchWebAnnotationColors() {
        let expected: [String: String] = [
            "milestone": "#3b82f6",
            "maintenance": "#f59e0b",
            "trip": "#22c55e",
            "issue": "#ef4444",
            "upgrade": "#a855f7",
            "custom": "#94a3b8"
        ]
        for category in AnnotationListCategory.allCases {
            XCTAssertEqual(category.colorHex, expected[category.rawValue], "swatch drift for \(category.rawValue)")
        }
    }

    func testLabelFallbacksMatchWebCategoryLabels() {
        let expected: [String: String] = [
            "milestone": "Milestone",
            "maintenance": "Maintenance",
            "trip": "Trip",
            "issue": "Issue",
            "upgrade": "Upgrade",
            "custom": "Custom"
        ]
        for category in AnnotationListCategory.allCases {
            XCTAssertEqual(category.labelFallback, expected[category.rawValue])
        }
    }

    func testLabelKeyShape() {
        XCTAssertEqual(AnnotationListCategory.milestone.labelKey, "annotation.cat.milestone")
        XCTAssertEqual(AnnotationListCategory.custom.labelKey, "annotation.cat.custom")
    }

    func testIdentifiableIsRawValue() {
        XCTAssertEqual(AnnotationListCategory.trip.id, "trip")
    }
}

// MARK: - Palette (`#rrggbb` decoder)

final class AnnotationListPaletteTests: XCTestCase {
    private let accuracy = 1.0 / 512.0

    func testDecodesMilestoneBlue() {
        let parts = AnnotationListPalette.components(forHex: "#3b82f6")
        XCTAssertNotNil(parts)
        XCTAssertEqual(parts?.red ?? -1, Double(0x3B) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.green ?? -1, Double(0x82) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.blue ?? -1, Double(0xF6) / 255, accuracy: accuracy)
    }

    func testDecodesEveryCategorySwatch() {
        for category in AnnotationListCategory.allCases {
            XCTAssertNotNil(
                AnnotationListPalette.components(forHex: category.colorHex),
                "failed to decode \(category.rawValue) swatch \(category.colorHex)"
            )
        }
    }

    func testAcceptsBareHexWithoutHash() {
        let withHash = AnnotationListPalette.components(forHex: "#22c55e")
        let bare = AnnotationListPalette.components(forHex: "22c55e")
        XCTAssertEqual(withHash, bare)
    }

    func testRejectsMalformed() {
        XCTAssertNil(AnnotationListPalette.components(forHex: ""))
        XCTAssertNil(AnnotationListPalette.components(forHex: "#fff"))
        XCTAssertNil(AnnotationListPalette.components(forHex: "#zzzzzz"))
        XCTAssertNil(AnnotationListPalette.components(forHex: "#3b82f6ff"))
    }
}

// MARK: - Accessibility (row + remove labels)

final class AnnotationListAccessibilityTests: XCTestCase {
    func testRowLabelIncludesDescription() {
        let label = AnnotationListAccessibility.rowLabel(
            category: "Milestone",
            label: "100k miles",
            description: "Six figures",
            timestamp: "Jan 4"
        )
        XCTAssertEqual(label, "Milestone: 100k miles. Six figures. Jan 4")
    }

    func testRowLabelDropsMissingDescription() {
        let label = AnnotationListAccessibility.rowLabel(
            category: "Trip",
            label: "Tahoe",
            description: nil,
            timestamp: "Mar 1"
        )
        XCTAssertEqual(label, "Trip: Tahoe. Mar 1")
    }

    func testRowLabelDropsEmptyDescription() {
        let label = AnnotationListAccessibility.rowLabel(
            category: "Trip",
            label: "Tahoe",
            description: "",
            timestamp: "Mar 1"
        )
        XCTAssertEqual(label, "Trip: Tahoe. Mar 1")
    }

    func testRemoveLabelNamesTheRow() {
        XCTAssertEqual(
            AnnotationListAccessibility.removeLabel(base: "Remove annotation", label: "100k miles"),
            "Remove annotation: 100k miles"
        )
    }

    func testRemoveLabelFallsBackToBase() {
        XCTAssertEqual(
            AnnotationListAccessibility.removeLabel(base: "Remove annotation", label: ""),
            "Remove annotation"
        )
    }
}

// MARK: - Input / item / meta

final class AnnotationListInputTests: XCTestCase {
    func testInputDefaults() {
        let input = AnnotationListInput()
        XCTAssertEqual(input.availability, .loading)
        XCTAssertEqual(input.connection, .live)
        XCTAssertEqual(input.emptyBehavior, .emptyState)
    }

    func testItemDescriptionDefaultsNil() {
        let item = AnnotationListItem(id: "1", label: "x", timestamp: "t", category: .custom)
        XCTAssertNil(item.description)
        XCTAssertEqual(item.id, "1")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AnnotationListMeta.surfaceSlug, "AnnotationList")
        XCTAssertEqual(AnnotationList.surfaceSlug, "AnnotationList")
    }
}
