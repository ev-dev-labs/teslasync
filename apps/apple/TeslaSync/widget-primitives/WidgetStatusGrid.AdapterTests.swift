//
//  WidgetStatusGrid.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the column target resolution
//  (the verbatim port of `resolvedCols = compact ? 2 : cols`), the cell mapping (the `!compact && cell.value`
//  value gating + passthrough), the empty branch (web `cells.length === 0`), the container-query column
//  collapse (``WidgetStatusGridLayout`` breakpoints), and the value-type equality + status enum. Split from
//  WidgetStatusGrid.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network, no clock, and no measured width.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func cell(
        _ id: String,
        label: String = "Label",
        status: StatusCellKind = .ok,
        value: String? = "Value",
        systemImage: String? = nil
    ) -> StatusCell {
        StatusCell(id: id, label: label, status: status, value: value, systemImage: systemImage)
    }

    static let three = [cell("a"), cell("b"), cell("c")]
}

// MARK: - Surface identity

final class WidgetStatusGridAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetStatusGridSurface.slug, "WidgetStatusGrid")
    }
}

// MARK: - StatusCellKind (web status union)

final class WidgetStatusGridStatusKindTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(StatusCellKind.ok.rawValue, "ok")
        XCTAssertEqual(StatusCellKind.warning.rawValue, "warning")
        XCTAssertEqual(StatusCellKind.error.rawValue, "error")
        XCTAssertEqual(StatusCellKind.inactive.rawValue, "inactive")
        XCTAssertEqual(StatusCellKind.unknown.rawValue, "unknown")
    }

    func testAllCasesCoverTheFiveStates() {
        XCTAssertEqual(StatusCellKind.allCases.count, 5)
    }

    func testSemanticTonesAreTheColoredStates() {
        XCTAssertTrue(StatusCellKind.ok.isSemantic)
        XCTAssertTrue(StatusCellKind.warning.isSemantic)
        XCTAssertTrue(StatusCellKind.error.isSemantic)
        XCTAssertFalse(StatusCellKind.inactive.isSemantic)
        XCTAssertFalse(StatusCellKind.unknown.isSemantic)
    }
}

// MARK: - Resolved columns (web `resolvedCols = compact ? 2 : cols`)

final class WidgetStatusGridResolvedColumnsTests: XCTestCase {
    func testNonCompactKeepsTheTarget() {
        XCTAssertEqual(
            WidgetStatusGridProjector.resolvedColumns(WidgetStatusGridInput(cells: Fixture.three, columns: .four)),
            .four
        )
        XCTAssertEqual(
            WidgetStatusGridProjector.resolvedColumns(WidgetStatusGridInput(cells: Fixture.three, columns: .three)),
            .three
        )
    }

    func testCompactForcesTwo() {
        XCTAssertEqual(
            WidgetStatusGridProjector.resolvedColumns(
                WidgetStatusGridInput(cells: Fixture.three, columns: .four, compact: true)
            ),
            .two
        )
    }
}

// MARK: - Cell mapping (value gating + passthrough)

final class WidgetStatusGridCellsTests: XCTestCase {
    func testNonCompactKeepsTheValue() {
        let cells = WidgetStatusGridProjector.cells(
            WidgetStatusGridInput(cells: [Fixture.cell("a", value: "Healthy")])
        )
        XCTAssertEqual(cells.first?.value, "Healthy")
    }

    func testCompactSuppressesTheValue() {
        let cells = WidgetStatusGridProjector.cells(
            WidgetStatusGridInput(cells: [Fixture.cell("a", value: "Healthy")], compact: true)
        )
        XCTAssertNil(cells.first?.value)
    }

    func testMappingPassesThroughIdentityLabelStatusAndIcon() {
        let cell = Fixture.cell("tpms", label: "Tire pressure", status: .error, value: "Low", systemImage: "gauge")
        let mapped = WidgetStatusGridProjector.cells(WidgetStatusGridInput(cells: [cell]))[0]
        XCTAssertEqual(mapped.id, "tpms")
        XCTAssertEqual(mapped.label, "Tire pressure")
        XCTAssertEqual(mapped.status, .error)
        XCTAssertEqual(mapped.value, "Low")
        XCTAssertEqual(mapped.systemImage, "gauge")
    }

    func testMappingPreservesOrderAndCount() {
        let cells = WidgetStatusGridProjector.cells(WidgetStatusGridInput(cells: Fixture.three))
        XCTAssertEqual(cells.map(\.id), ["a", "b", "c"])
    }
}

// MARK: - Resolve (empty vs populated)

final class WidgetStatusGridResolveTests: XCTestCase {
    func testEmptyInputResolvesToEmpty() {
        XCTAssertEqual(WidgetStatusGridProjector.resolve(WidgetStatusGridInput(cells: [])), .empty)
    }

    func testPopulatedInputResolvesToPopulatedGridWithTarget() {
        let projection = WidgetStatusGridProjector.resolve(
            WidgetStatusGridInput(cells: Fixture.three, columns: .three)
        )
        guard case let .populated(cells, columns) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(cells.count, 3)
        XCTAssertEqual(columns, .three)
    }

    func testCompactPopulatedResolvesToTwoColumns() {
        let projection = WidgetStatusGridProjector.resolve(
            WidgetStatusGridInput(cells: Fixture.three, columns: .four, compact: true)
        )
        guard case let .populated(_, columns) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(columns, .two)
    }
}

// MARK: - Layout (web container-query column collapse)

final class WidgetStatusGridLayoutTests: XCTestCase {
    func testTwoColumnTargetAlwaysRendersTwo() {
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .two, availableWidth: 0), 2)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .two, availableWidth: 100), 2)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .two, availableWidth: 800), 2)
    }

    func testThreeColumnTargetCollapsesByWidth() {
        // Web `grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3`.
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .three, availableWidth: 0), 1)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .three, availableWidth: 255), 1)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .three, availableWidth: 256), 2)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .three, availableWidth: 383), 2)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .three, availableWidth: 384), 3)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .three, availableWidth: 600), 3)
    }

    func testFourColumnTargetCollapsesByWidth() {
        // Web `grid-cols-2 @sm:grid-cols-4`.
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .four, availableWidth: 0), 2)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .four, availableWidth: 383), 2)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .four, availableWidth: 384), 4)
        XCTAssertEqual(WidgetStatusGridLayout.columnCount(target: .four, availableWidth: 900), 4)
    }
}

// MARK: - Value-type equality

final class WidgetStatusGridValueTypeTests: XCTestCase {
    func testStatusCellEqualityDistinguishesFields() {
        let base = Fixture.cell("a", label: "L", status: .ok, value: "V", systemImage: "x")
        XCTAssertEqual(base, Fixture.cell("a", label: "L", status: .ok, value: "V", systemImage: "x"))
        XCTAssertNotEqual(base, Fixture.cell("b", label: "L", status: .ok, value: "V", systemImage: "x"))
        XCTAssertNotEqual(base, Fixture.cell("a", label: "L2", status: .ok, value: "V", systemImage: "x"))
        XCTAssertNotEqual(base, Fixture.cell("a", label: "L", status: .warning, value: "V", systemImage: "x"))
        XCTAssertNotEqual(base, Fixture.cell("a", label: "L", status: .ok, value: "V2", systemImage: "x"))
        XCTAssertNotEqual(base, Fixture.cell("a", label: "L", status: .ok, value: "V", systemImage: "y"))
    }

    func testColumnsRawValueIsTheCount() {
        XCTAssertEqual(StatusGridColumns.two.rawValue, 2)
        XCTAssertEqual(StatusGridColumns.three.rawValue, 3)
        XCTAssertEqual(StatusGridColumns.four.rawValue, 4)
    }

    func testInputEqualityDistinguishesEveryProp() {
        let cells = [Fixture.cell("a")]
        let base = WidgetStatusGridInput(
            cells: cells,
            columns: .two,
            compact: false,
            emptyMessage: "m",
            emptySystemImage: "i"
        )
        XCTAssertEqual(
            base,
            WidgetStatusGridInput(cells: cells, columns: .two, compact: false, emptyMessage: "m", emptySystemImage: "i")
        )
        XCTAssertNotEqual(base, WidgetStatusGridInput(cells: cells, columns: .three))
        XCTAssertNotEqual(base, WidgetStatusGridInput(cells: cells, columns: .two, compact: true))
        XCTAssertNotEqual(
            base,
            WidgetStatusGridInput(cells: cells, columns: .two, emptyMessage: "other", emptySystemImage: "i")
        )
        XCTAssertNotEqual(
            base,
            WidgetStatusGridInput(cells: cells, columns: .two, emptyMessage: "m", emptySystemImage: "other")
        )
    }

    func testInputDefaultsMatchTheWebProps() {
        let input = WidgetStatusGridInput(cells: [])
        XCTAssertEqual(input.columns, .two)
        XCTAssertFalse(input.compact)
        XCTAssertNil(input.emptyMessage)
        XCTAssertEqual(input.emptySystemImage, WidgetStatusGridInput.defaultEmptySystemImage)
    }

    func testProjectionEquality() {
        let lhs = WidgetStatusGridProjector.resolve(WidgetStatusGridInput(cells: Fixture.three, columns: .three))
        let rhs = WidgetStatusGridProjector.resolve(WidgetStatusGridInput(cells: Fixture.three, columns: .three))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, .empty)
        XCTAssertNotEqual(
            lhs,
            WidgetStatusGridProjector.resolve(WidgetStatusGridInput(cells: Fixture.three, columns: .four))
        )
    }
}
