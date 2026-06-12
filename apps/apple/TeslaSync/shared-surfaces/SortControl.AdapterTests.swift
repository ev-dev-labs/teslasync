//
//  SortControl.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the ``SortDirection`` mapping
//  (raw values, the flip, i18n key/fallback, SF Symbol), the ``SortOption`` identity, the projection
//  (resolved options, the selected option + the not-in-options fallback trigger label, the direction glyph
//  + label, the default vs custom direction accessibility label, the empty-options flag, and the
//  accessibility identifiers), and the direction flip (the verbatim port of the web `flip`). Split from
//  SortControl.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Test resolvers (web `t(key, default)` doubles)

/// Identity-fallback resolver — returns the English default, the shape the production facade uses when a
/// key is missing (so the asserted copy is deterministic).
private let fallbackResolver: SortControlResolve = { _, fallback in fallback }

/// Key-echo resolver — returns the key, proving the projector wires the right i18n key.
private let keyResolver: SortControlResolve = { key, _ in key }

private let sampleOptions: [SortOption] = [
    SortOption(value: "date", label: "Date"),
    SortOption(value: "distance", label: "Distance"),
    SortOption(value: "score", label: "Score")
]

// MARK: - Surface identity

final class SortControlAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SortControlSurface.slug, "SortControl")
    }
}

// MARK: - SortDirection (web `'asc' | 'desc'` + ArrowUp/Down)

final class SortControlDirectionTests: XCTestCase {
    func testRawValuesMatchWebStringUnion() {
        XCTAssertEqual(SortDirection.asc.id, "asc")
        XCTAssertEqual(SortDirection.desc.id, "desc")
        XCTAssertEqual(SortDirection.allCases, [.asc, .desc])
    }

    func testToggledFlipsBothWays() {
        XCTAssertEqual(SortDirection.asc.toggled, .desc)
        XCTAssertEqual(SortDirection.desc.toggled, .asc)
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(SortDirection.asc.labelKey, "sortControl.ascending")
        XCTAssertEqual(SortDirection.desc.labelKey, "sortControl.descending")
        XCTAssertEqual(SortDirection.asc.labelFallback, "Ascending")
        XCTAssertEqual(SortDirection.desc.labelFallback, "Descending")
    }

    func testSystemImagesMapFromLucideArrows() {
        XCTAssertEqual(SortDirection.asc.systemImage, "arrow.up")
        XCTAssertEqual(SortDirection.desc.systemImage, "arrow.down")
    }
}

// MARK: - SortOption (web `SortOption<F>`)

final class SortControlOptionTests: XCTestCase {
    func testIdentityIsTheFieldValue() {
        let option = SortOption(value: "distance", label: "Distance")
        XCTAssertEqual(option.id, "distance")
        XCTAssertEqual(option.value, "distance")
        XCTAssertEqual(option.label, "Distance")
    }

    func testEquality() {
        XCTAssertEqual(
            SortOption(value: "date", label: "Date"),
            SortOption(value: "date", label: "Date")
        )
        XCTAssertNotEqual(
            SortOption(value: "date", label: "Date"),
            SortOption(value: "date", label: "Datum")
        )
    }
}

// MARK: - Projection (web render decision)

final class SortControlProjectionTests: XCTestCase {
    private func projection(
        field: String = "distance",
        direction: SortDirection = .asc,
        options: [SortOption] = sampleOptions,
        directionAriaLabel: String? = nil,
        identifier: String? = nil,
        strings: SortControlResolve = fallbackResolver
    ) -> SortControlProjection {
        SortControlProjector.resolve(
            SortControlInput(
                field: field,
                direction: direction,
                options: options,
                directionAriaLabel: directionAriaLabel,
                identifier: identifier
            ),
            strings: strings
        )
    }

    func testResolvesOrderedOptionsAndSelection() {
        let proj = projection()
        XCTAssertEqual(proj.options.map(\.value), ["date", "distance", "score"])
        XCTAssertEqual(proj.selectedOption?.value, "distance")
        XCTAssertEqual(proj.fieldTriggerLabel, "Distance")
        XCTAssertFalse(proj.hasNoOptions)
    }

    func testSelectedOptionNilAndTriggerFallsBackWhenFieldNotInOptions() {
        let proj = projection(field: "energy")
        XCTAssertNil(proj.selectedOption)
        XCTAssertEqual(proj.fieldTriggerLabel, "energy", "trigger falls back to the raw field key, never blank")
    }

    func testDirectionGlyphAndLabelForAscending() {
        let proj = projection(direction: .asc)
        XCTAssertEqual(proj.directionSystemImage, "arrow.up")
        XCTAssertEqual(proj.directionLabel, "Ascending")
    }

    func testDirectionGlyphAndLabelForDescending() {
        let proj = projection(direction: .desc)
        XCTAssertEqual(proj.directionSystemImage, "arrow.down")
        XCTAssertEqual(proj.directionLabel, "Descending")
    }

    func testFieldMenuLabelFallback() {
        XCTAssertEqual(projection().fieldMenuLabel, "Sort by")
    }

    func testDefaultDirectionAccessibilityLabelComposesWordAndDirection() {
        XCTAssertEqual(projection(direction: .asc).directionAccessibilityLabel, "Sort direction: Ascending")
        XCTAssertEqual(projection(direction: .desc).directionAccessibilityLabel, "Sort direction: Descending")
    }

    func testCustomDirectionAriaLabelOverridesComposedLabel() {
        let proj = projection(direction: .asc, directionAriaLabel: "Toggle ranking order")
        XCTAssertEqual(proj.directionAccessibilityLabel, "Toggle ranking order")
    }

    func testProjectorWiresTheCorrectI18nKeys() {
        let proj = projection(direction: .asc, strings: keyResolver)
        XCTAssertEqual(proj.fieldMenuLabel, "sortControl.fieldLabel")
        XCTAssertEqual(proj.directionLabel, "sortControl.ascending")
        XCTAssertEqual(proj.directionAccessibilityLabel, "sortControl.direction: sortControl.ascending")
    }

    func testEmptyOptionsFlag() {
        let proj = projection(options: [])
        XCTAssertTrue(proj.hasNoOptions)
        XCTAssertNil(proj.selectedOption)
    }

    func testIdentifiersDefaultToSurfaceSlug() {
        let proj = projection()
        XCTAssertEqual(proj.resolvedIdentifier, "SortControl")
        XCTAssertEqual(proj.fieldIdentifier, "SortControl-field")
        XCTAssertEqual(proj.directionIdentifier, "SortControl-direction")
    }

    func testIdentifiersUseSuppliedTestId() {
        let proj = projection(identifier: "drives-sort")
        XCTAssertEqual(proj.resolvedIdentifier, "drives-sort")
        XCTAssertEqual(proj.fieldIdentifier, "drives-sort-field")
        XCTAssertEqual(proj.directionIdentifier, "drives-sort-direction")
    }
}

// MARK: - Direction flip (web `flip`)

final class SortControlFlipTests: XCTestCase {
    func testToggledFromAscIsDesc() {
        XCTAssertEqual(SortControlProjector.toggled(.asc), .desc)
    }

    func testToggledFromDescIsAsc() {
        XCTAssertEqual(SortControlProjector.toggled(.desc), .asc)
    }
}

// MARK: - Value-type equality

final class SortControlValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = SortControlInput(field: "date", direction: .asc, options: sampleOptions)
        let rhs = SortControlInput(field: "date", direction: .asc, options: sampleOptions)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(
            lhs,
            SortControlInput(field: "date", direction: .desc, options: sampleOptions)
        )
        XCTAssertNotEqual(
            lhs,
            SortControlInput(field: "score", direction: .asc, options: sampleOptions)
        )
    }

    func testProjectionEquality() {
        let lhs = SortControlProjector.resolve(
            SortControlInput(field: "date", direction: .asc, options: sampleOptions),
            strings: fallbackResolver
        )
        let rhs = SortControlProjector.resolve(
            SortControlInput(field: "date", direction: .asc, options: sampleOptions),
            strings: fallbackResolver
        )
        XCTAssertEqual(lhs, rhs)
    }
}
