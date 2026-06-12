//
//  DensityToggle.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the ``Density`` mapping
//  (default option order, i18n key/fallback, SF Symbol), the projection (resolved options, the default vs
//  custom group label, the selected-index lookup, the empty-options flag, and the accessibility
//  identifiers), and the arrow-key navigation (the verbatim port of the web `onKeyDown` — wraps at the
//  ends, no-op when the value is not in the options). Split from DensityToggle.Tests.swift (the SwiftUI /
//  state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Test resolvers (web `t(key, default)` doubles)

/// Identity-fallback resolver — returns the English default, the shape the production facade uses when a
/// key is missing (so the asserted copy is deterministic).
private let fallbackResolver: DensityToggleResolve = { _, fallback in fallback }

/// Key-echo resolver — returns the key, proving the projector wires the right i18n key per option.
private let keyResolver: DensityToggleResolve = { key, _ in key }

// MARK: - Surface identity

final class DensityToggleAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DensityToggleSurface.slug, "DensityToggle")
    }
}

// MARK: - Density (web `Density` + ICONS + DEFAULT_OPTIONS)

final class DensityToggleDensityTests: XCTestCase {
    func testDefaultOptionOrderMatchesWeb() {
        XCTAssertEqual(Density.defaultOptions, [.table, .compact, .comfortable])
        XCTAssertEqual(Density.allCases.count, 3)
    }

    func testRawValuesMatchWebStringUnion() {
        XCTAssertEqual(Density.table.id, "table")
        XCTAssertEqual(Density.compact.id, "compact")
        XCTAssertEqual(Density.comfortable.id, "comfortable")
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(Density.table.labelKey, "density.table")
        XCTAssertEqual(Density.compact.labelKey, "density.compact")
        XCTAssertEqual(Density.comfortable.labelKey, "density.comfortable")
        XCTAssertEqual(Density.table.labelFallback, "Table")
        XCTAssertEqual(Density.compact.labelFallback, "Compact")
        XCTAssertEqual(Density.comfortable.labelFallback, "Comfortable")
    }

    func testSystemImagesAreDistinctAndMapped() {
        XCTAssertEqual(Density.table.systemImage, "tablecells")
        XCTAssertEqual(Density.compact.systemImage, "rectangle.compress.vertical")
        XCTAssertEqual(Density.comfortable.systemImage, "rectangle.expand.vertical")
        let images = Set(Density.allCases.map(\.systemImage))
        XCTAssertEqual(images.count, 3, "each density has a distinct glyph")
    }
}

// MARK: - Projection (web render decision)

final class DensityToggleProjectionTests: XCTestCase {
    func testResolvesOrderedSegmentsWithSelection() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .compact),
            strings: fallbackResolver
        )
        XCTAssertEqual(projection.segments.map(\.density), [.table, .compact, .comfortable])
        XCTAssertEqual(projection.segments.map(\.label), ["Table", "Compact", "Comfortable"])
        XCTAssertEqual(projection.selectedIndex, 1)
        XCTAssertEqual(projection.segments.first(where: { $0.isSelected })?.density, .compact)
        XCTAssertFalse(projection.isEmpty)
    }

    func testSegmentLabelsUseTheCorrectKeys() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table),
            strings: keyResolver
        )
        XCTAssertEqual(projection.segments.map(\.label), ["density.table", "density.compact", "density.comfortable"])
        XCTAssertEqual(projection.groupLabel, "density.groupLabel")
    }

    func testDefaultGroupLabelFallback() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table),
            strings: fallbackResolver
        )
        XCTAssertEqual(projection.groupLabel, "List density")
    }

    func testCustomAriaLabelOverridesGroupLabel() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table, ariaLabel: "Row spacing"),
            strings: fallbackResolver
        )
        XCTAssertEqual(projection.groupLabel, "Row spacing")
    }

    func testConstrainedOptionsAreRespected() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .compact, options: [.compact, .comfortable]),
            strings: fallbackResolver
        )
        XCTAssertEqual(projection.segments.map(\.density), [.compact, .comfortable])
        XCTAssertEqual(projection.selectedIndex, 0)
    }

    func testSelectedIndexNilWhenValueNotInOptions() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table, options: [.compact, .comfortable]),
            strings: fallbackResolver
        )
        XCTAssertNil(projection.selectedIndex)
        XCTAssertFalse(projection.segments.contains(where: \.isSelected))
    }

    func testEmptyOptionsProjectionIsEmpty() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table, options: []),
            strings: fallbackResolver
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertNil(projection.selectedIndex)
    }

    func testIdentifiersDefaultToSurfaceSlug() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table),
            strings: fallbackResolver
        )
        XCTAssertEqual(projection.resolvedIdentifier, "DensityToggle")
        XCTAssertEqual(projection.segmentIdentifier(for: .compact), "DensityToggle-compact")
    }

    func testIdentifiersUseSuppliedTestId() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table, identifier: "dt"),
            strings: fallbackResolver
        )
        XCTAssertEqual(projection.resolvedIdentifier, "dt")
        XCTAssertEqual(projection.segmentIdentifier(for: .table), "dt-table")
    }
}

// MARK: - Navigation (web `onKeyDown` arrow logic)

final class DensityToggleNavigationTests: XCTestCase {
    private let options = Density.defaultOptions

    private func next(
        _ value: Density,
        _ options: [Density],
        _ direction: DensityToggleProjector.Direction
    ) -> Density? {
        DensityToggleProjector.next(after: value, in: options, moving: direction)
    }

    func testForwardAdvancesThroughOptions() {
        XCTAssertEqual(next(.table, options, .forward), .compact)
        XCTAssertEqual(next(.compact, options, .forward), .comfortable)
    }

    func testForwardWrapsAtEnd() {
        XCTAssertEqual(next(.comfortable, options, .forward), .table)
    }

    func testBackwardRetreatsThroughOptions() {
        XCTAssertEqual(next(.comfortable, options, .backward), .compact)
        XCTAssertEqual(next(.compact, options, .backward), .table)
    }

    func testBackwardWrapsAtStart() {
        XCTAssertEqual(next(.table, options, .backward), .comfortable)
    }

    func testNoOpWhenValueNotInOptions() {
        XCTAssertNil(next(.table, [.compact, .comfortable], .forward))
        XCTAssertNil(next(.table, [.compact, .comfortable], .backward))
    }

    func testSingleOptionWrapsToItself() {
        XCTAssertEqual(next(.table, [.table], .forward), .table)
        XCTAssertEqual(next(.table, [.table], .backward), .table)
    }

    func testEmptyOptionsReturnNil() {
        XCTAssertNil(next(.table, [], .forward))
        XCTAssertNil(next(.table, [], .backward))
    }

    func testConstrainedListNavigation() {
        XCTAssertEqual(next(.compact, [.compact, .comfortable], .forward), .comfortable)
        XCTAssertEqual(next(.comfortable, [.compact, .comfortable], .forward), .compact)
    }
}

// MARK: - Value-type equality

final class DensityToggleValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = DensityToggleInput(value: .table, options: [.table, .compact])
        let rhs = DensityToggleInput(value: .table, options: [.table, .compact])
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, DensityToggleInput(value: .compact, options: [.table, .compact]))
    }

    func testSegmentEquality() {
        let lhs = DensitySegment(density: .table, label: "Table", systemImage: "tablecells", isSelected: true)
        let rhs = DensitySegment(density: .table, label: "Table", systemImage: "tablecells", isSelected: true)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(
            lhs,
            DensitySegment(density: .table, label: "Table", systemImage: "tablecells", isSelected: false)
        )
    }

    func testDirectionEquality() {
        XCTAssertEqual(DensityToggleProjector.Direction.forward, .forward)
        XCTAssertNotEqual(DensityToggleProjector.Direction.forward, .backward)
    }
}
