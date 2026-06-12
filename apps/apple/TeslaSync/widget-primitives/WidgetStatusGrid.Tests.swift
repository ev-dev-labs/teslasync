//
//  WidgetStatusGrid.Tests.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in WidgetStatusGrid.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • WidgetStatusGridModel — the once-only `view.opened`, the props `update` re-derivation (empty →
//      populated, and the compact re-resolve), the projection reflecting the resolved grid, and the
//      empty-message override / fallback.
//    • Views — the public surface + the subviews compose in every real branch (populated / responsive
//      targets / compact / single / empty), via both the prop initializer and the injected-model seam.
//    • Strings — the empty copy, the spoken status words, and the a11y compositions resolve through the
//      P1/S10 facade with the fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func cell(_ id: String, status: StatusCellKind = .ok, value: String? = "Value") -> StatusCell {
        StatusCell(id: id, label: "Label \(id)", status: status, value: value)
    }

    static let two = [cell("a"), cell("b")]
    static let three = [cell("a"), cell("b"), cell("c")]
}

// MARK: - WidgetStatusGridModel (telemetry + derivation)

@MainActor
final class WidgetStatusGridModelTests: XCTestCase {
    private func model(
        _ cells: [StatusCell],
        columns: StatusGridColumns = .two,
        compact: Bool = false,
        emptyMessage: String? = nil,
        telemetry: WidgetStatusGridTelemetry = OSLogWidgetStatusGridTelemetry()
    ) -> WidgetStatusGridModel {
        WidgetStatusGridModel(
            input: WidgetStatusGridInput(
                cells: cells,
                columns: columns,
                compact: compact,
                emptyMessage: emptyMessage
            ),
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.two, telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetStatusGridSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.two, telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetStatusGridSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsPopulatedGrid() {
        guard case let .populated(cells, columns) = model(Fixture.three, columns: .three).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(cells.count, 3)
        XCTAssertEqual(columns, .three)
    }

    func testEmptyCellsProjectToEmpty() {
        XCTAssertEqual(model([]).projection, .empty)
    }

    func testUpdateReDerivesProjectionFromEmptyToPopulated() {
        let holder = model([])
        XCTAssertEqual(holder.projection, .empty)
        holder.update(WidgetStatusGridInput(cells: Fixture.two))
        guard case let .populated(cells, _) = holder.projection else {
            return XCTFail("expected populated projection after update")
        }
        XCTAssertEqual(cells.count, 2)
    }

    func testUpdateToCompactReResolvesColumnsAndDropsValues() {
        let holder = model(Fixture.three, columns: .four)
        holder.update(WidgetStatusGridInput(cells: Fixture.three, columns: .four, compact: true))
        guard case let .populated(cells, columns) = holder.projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(columns, .two)
        XCTAssertTrue(cells.allSatisfy { $0.value == nil })
    }

    func testResolvedEmptyMessageUsesOverrideThenFallback() {
        XCTAssertEqual(model([], emptyMessage: "Nothing to report").resolvedEmptyMessage, "Nothing to report")
        XCTAssertEqual(model([]).resolvedEmptyMessage, WidgetStatusGridStrings.emptyMessage)
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetStatusGridViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetStatusGrid(cells: Fixture.three, columns: .three)
        _ = WidgetStatusGrid(cells: Fixture.three, columns: .four, compact: true)
        _ = WidgetStatusGrid(cells: [Fixture.cell("a")])
        _ = WidgetStatusGrid(cells: [])
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetStatusGridModel(
            input: WidgetStatusGridInput(cells: Fixture.two),
            telemetry: SpyTelemetry()
        )
        _ = WidgetStatusGrid(model: injected)
        XCTAssertEqual(WidgetStatusGrid.surfaceSlug, "WidgetStatusGrid")
    }

    func testSubviewsComposeForEveryToneAndState() {
        for kind in StatusCellKind.allCases {
            let cell = StatusGridCell(id: kind.rawValue, label: "L", status: kind, value: "V", systemImage: "circle")
            _ = StatusGridCellView(cell: cell, compact: false)
            _ = StatusGridCellView(cell: cell, compact: true)
        }
        let cells = WidgetStatusGridProjector.cells(WidgetStatusGridInput(cells: Fixture.three))
        _ = WidgetStatusGridContent(cells: cells, columns: .three, compact: false)
        _ = WidgetStatusGridEmptyState(message: "No status data available", systemImage: "circle.grid.2x2")
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetStatusGridStringsTests: XCTestCase {
    func testEmptyCopyFallbacks() {
        XCTAssertEqual(WidgetStatusGridStrings.emptyMessage, "No status data available")
        XCTAssertFalse(WidgetStatusGridStrings.emptyHint.isEmpty)
    }

    func testStatusWordForEveryKind() {
        XCTAssertEqual(WidgetStatusGridStrings.statusWord(.ok), "OK")
        XCTAssertEqual(WidgetStatusGridStrings.statusWord(.warning), "Warning")
        XCTAssertEqual(WidgetStatusGridStrings.statusWord(.error), "Error")
        XCTAssertEqual(WidgetStatusGridStrings.statusWord(.inactive), "Inactive")
        XCTAssertEqual(WidgetStatusGridStrings.statusWord(.unknown), "Unknown")
    }

    func testCellAccessibilityLabelComposesLabelValueStatus() {
        XCTAssertEqual(
            WidgetStatusGridStrings.cellAccessibilityLabel(label: "Battery", value: "Healthy", status: .ok),
            "Battery, Healthy, OK"
        )
    }

    func testCellAccessibilityLabelOmitsAbsentValue() {
        XCTAssertEqual(
            WidgetStatusGridStrings.cellAccessibilityLabel(label: "Sentry", value: nil, status: .inactive),
            "Sentry, Inactive"
        )
        XCTAssertEqual(
            WidgetStatusGridStrings.cellAccessibilityLabel(label: "Sentry", value: "", status: .inactive),
            "Sentry, Inactive"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetStatusGridTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
