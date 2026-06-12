//
//  DataTableResizer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the `clamp` (the verbatim
//  port of the web `Math.max(minWidth, Math.min(maxWidth, Math.round(n)))`), the drag-delta width, the
//  ±8 px / Home-80 / End-max keyboard steps, the hover / focus / drag fill opacity, the projection, the
//  i18next interpolation + the accessible label / value, and the value-type equality. Split from
//  DataTableResizer.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class DataTableResizerAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DataTableResizerSurface.slug, "DataTableResizer")
    }

    func testStepAndHomeConstantsMatchWeb() {
        XCTAssertEqual(DataTableResizerProjector.step, 8, accuracy: 0.0001, "web ArrowLeft/Right ± 8 px")
        XCTAssertEqual(DataTableResizerProjector.homeWidth, 80, accuracy: 0.0001, "web Home → clamp(80)")
    }
}

// MARK: - Clamp (web `Math.max(min, Math.min(max, Math.round(n)))`)

final class DataTableResizerClampTests: XCTestCase {
    private let minWidth: Double = 60
    private let maxWidth: Double = 800

    func testClampsBelowMinimum() {
        XCTAssertEqual(DataTableResizerProjector.clamp(10, minWidth: minWidth, maxWidth: maxWidth), 60)
        XCTAssertEqual(DataTableResizerProjector.clamp(-50, minWidth: minWidth, maxWidth: maxWidth), 60)
    }

    func testClampsAboveMaximum() {
        XCTAssertEqual(DataTableResizerProjector.clamp(1000, minWidth: minWidth, maxWidth: maxWidth), 800)
    }

    func testPassesThroughInRange() {
        XCTAssertEqual(DataTableResizerProjector.clamp(240, minWidth: minWidth, maxWidth: maxWidth), 240)
    }

    func testRoundsToWholePoint() {
        // Web `Math.round`: .5 rounds away from zero, matching Swift's default rounding rule.
        XCTAssertEqual(DataTableResizerProjector.clamp(100.4, minWidth: minWidth, maxWidth: maxWidth), 100)
        XCTAssertEqual(DataTableResizerProjector.clamp(100.6, minWidth: minWidth, maxWidth: maxWidth), 101)
        XCTAssertEqual(DataTableResizerProjector.clamp(100.5, minWidth: minWidth, maxWidth: maxWidth), 101)
    }

    func testInvertedRangeLetsMinimumWin() {
        // Web composition Math.max(min, Math.min(max, …)) yields `min` when min > max; mirror it.
        XCTAssertEqual(DataTableResizerProjector.clamp(120, minWidth: 200, maxWidth: 100), 200)
    }
}

// MARK: - Drag delta (web `clamp(startWidth + delta)`)

final class DataTableResizerResizingTests: XCTestCase {
    func testGrowsByPositiveTranslation() {
        let next = DataTableResizerProjector.resizing(startWidth: 200, translation: 50, minWidth: 60, maxWidth: 800)
        XCTAssertEqual(next, 250)
    }

    func testShrinksByNegativeTranslation() {
        let next = DataTableResizerProjector.resizing(startWidth: 200, translation: -50, minWidth: 60, maxWidth: 800)
        XCTAssertEqual(next, 150)
    }

    func testClampsToFloorOnLargeNegativeDrag() {
        let next = DataTableResizerProjector.resizing(startWidth: 70, translation: -100, minWidth: 60, maxWidth: 800)
        XCTAssertEqual(next, 60, "the drag cannot shrink below minWidth")
    }

    func testClampsToCeilingOnLargePositiveDrag() {
        let next = DataTableResizerProjector.resizing(startWidth: 700, translation: 400, minWidth: 60, maxWidth: 800)
        XCTAssertEqual(next, 800, "the drag cannot grow beyond maxWidth")
    }
}

// MARK: - Keyboard steps (web `ArrowLeft`/`ArrowRight`/`Home`/`End`)

final class DataTableResizerStepTests: XCTestCase {
    func testArrowStepsByEight() {
        XCTAssertEqual(
            DataTableResizerProjector.adjusted(width: 100, by: 8, minWidth: 60, maxWidth: 800),
            108
        )
        XCTAssertEqual(
            DataTableResizerProjector.adjusted(width: 100, by: -8, minWidth: 60, maxWidth: 800),
            92
        )
    }

    func testArrowStepClampsAtBounds() {
        XCTAssertEqual(
            DataTableResizerProjector.adjusted(width: 60, by: -8, minWidth: 60, maxWidth: 800),
            60,
            "ArrowLeft at the floor stays at minWidth"
        )
        XCTAssertEqual(
            DataTableResizerProjector.adjusted(width: 800, by: 8, minWidth: 60, maxWidth: 800),
            800,
            "ArrowRight at the ceiling stays at maxWidth"
        )
    }

    func testHomeResetClampsIntoRange() {
        // Home targets 80; when minWidth exceeds 80 the clamp floor wins (web clamp(80)).
        XCTAssertEqual(
            DataTableResizerProjector.clamp(DataTableResizerProjector.homeWidth, minWidth: 60, maxWidth: 800),
            80
        )
        XCTAssertEqual(
            DataTableResizerProjector.clamp(DataTableResizerProjector.homeWidth, minWidth: 120, maxWidth: 800),
            120,
            "a minWidth above 80 wins the clamp"
        )
    }

    func testEndMaxesOut() {
        XCTAssertEqual(DataTableResizerProjector.clamp(800, minWidth: 60, maxWidth: 800), 800)
    }
}

// MARK: - Handle fill opacity (web resizer `opacity` / cyan tint)

final class DataTableResizerFillTests: XCTestCase {
    func testRestingIsInvisible() {
        let fill = DataTableResizerProjector.handleFillOpacity(isDragging: false, isFocused: false, isHovering: false)
        XCTAssertEqual(fill, 0, accuracy: 0.0001, "web opacity-0 at rest")
    }

    func testHoverTint() {
        let fill = DataTableResizerProjector.handleFillOpacity(isDragging: false, isFocused: false, isHovering: true)
        XCTAssertEqual(fill, 0.4, accuracy: 0.0001, "web hover:bg-cyan-400/40")
    }

    func testFocusTint() {
        let fill = DataTableResizerProjector.handleFillOpacity(isDragging: false, isFocused: true, isHovering: false)
        XCTAssertEqual(fill, 0.6, accuracy: 0.0001, "web focus-visible:bg-cyan-400/60")
    }

    func testDragTint() {
        let fill = DataTableResizerProjector.handleFillOpacity(isDragging: true, isFocused: false, isHovering: false)
        XCTAssertEqual(fill, 0.6, accuracy: 0.0001, "web dragging → bg-cyan-400/60")
    }

    func testDragAndFocusWinOverHover() {
        let drag = DataTableResizerProjector.handleFillOpacity(isDragging: true, isFocused: false, isHovering: true)
        XCTAssertEqual(drag, 0.6, accuracy: 0.0001, "dragging overrides the hover class")
        let focus = DataTableResizerProjector.handleFillOpacity(isDragging: false, isFocused: true, isHovering: true)
        XCTAssertEqual(focus, 0.6, accuracy: 0.0001, "focus overrides the hover class")
    }
}

// MARK: - Projection (clamped width + bounds + active)

final class DataTableResizerProjectionTests: XCTestCase {
    func testProjectionClampsWidthAndEchoesBounds() {
        let projection = DataTableResizerProjector.resolve(
            DataTableResizerInput(columnKey: "name", width: 1000, minWidth: 60, maxWidth: 800),
            isDragging: false,
            isFocused: false,
            isHovering: false
        )
        XCTAssertEqual(projection.width, 800, "aria-valuenow never exceeds aria-valuemax")
        XCTAssertEqual(projection.minWidth, 60)
        XCTAssertEqual(projection.maxWidth, 800)
        XCTAssertFalse(projection.isActive)
        XCTAssertEqual(projection.fillOpacity, 0, accuracy: 0.0001)
    }

    func testProjectionIsActiveWhenInteracting() {
        let projection = DataTableResizerProjector.resolve(
            DataTableResizerInput(columnKey: "name", width: 160),
            isDragging: true,
            isFocused: false,
            isHovering: false
        )
        XCTAssertTrue(projection.isActive)
        XCTAssertEqual(projection.fillOpacity, 0.6, accuracy: 0.0001)
    }
}

// MARK: - Interpolation + accessible copy (web `aria-label` / `aria-valuenow`)

final class DataTableResizerCopyTests: XCTestCase {
    func testInterpolateReplacesEveryOccurrence() {
        XCTAssertEqual(
            DataTableResizerProjector.interpolate("{{a}}-{{b}}-{{a}}", ["a": "1", "b": "2"]),
            "1-2-1"
        )
    }

    func testDefaultLabelInterpolatesColumnKey() {
        XCTAssertEqual(
            DataTableResizerProjector.accessibilityLabel(
                columnKey: "displayName",
                override: nil,
                template: "Resize column {{column}}"
            ),
            "Resize column displayName"
        )
    }

    func testLabelOverrideWins() {
        XCTAssertEqual(
            DataTableResizerProjector.accessibilityLabel(
                columnKey: "displayName",
                override: "Resize the name column",
                template: "Resize column {{column}}"
            ),
            "Resize the name column"
        )
    }

    func testEmptyOverrideFallsBackToTemplate() {
        XCTAssertEqual(
            DataTableResizerProjector.accessibilityLabel(
                columnKey: "vin",
                override: "",
                template: "Resize column {{column}}"
            ),
            "Resize column vin",
            "an empty override is ignored, mirroring web `label ?? …` for a falsy label"
        )
    }

    func testValueInterpolatesWholeWidthWithoutGrouping() {
        XCTAssertEqual(
            DataTableResizerProjector.accessibilityValue(width: 1024, template: "{{width}} points"),
            "1024 points",
            "raw integer, no thousands separator (peer of aria-valuenow)"
        )
        XCTAssertEqual(
            DataTableResizerProjector.accessibilityValue(width: 159.6, template: "{{width}} points"),
            "160 points",
            "the spoken width is rounded to a whole point"
        )
    }
}

// MARK: - Value-type equality

final class DataTableResizerValueTypeTests: XCTestCase {
    func testInputEquality() {
        let base = DataTableResizerInput(columnKey: "name", width: 160, minWidth: 60, maxWidth: 800, label: nil)
        XCTAssertEqual(
            base,
            DataTableResizerInput(columnKey: "name", width: 160, minWidth: 60, maxWidth: 800, label: nil)
        )
        XCTAssertNotEqual(base, DataTableResizerInput(columnKey: "name", width: 168))
        XCTAssertNotEqual(base, DataTableResizerInput(columnKey: "other", width: 160))
        XCTAssertNotEqual(base, DataTableResizerInput(columnKey: "name", width: 160, label: "Override"))
    }

    func testProjectionEquality() {
        let lhs = DataTableResizerProjector.resolve(
            DataTableResizerInput(columnKey: "name", width: 160),
            isDragging: false, isFocused: false, isHovering: true
        )
        let rhs = DataTableResizerProjector.resolve(
            DataTableResizerInput(columnKey: "name", width: 160),
            isDragging: false, isFocused: false, isHovering: true
        )
        XCTAssertEqual(lhs, rhs)
        let other = DataTableResizerProjector.resolve(
            DataTableResizerInput(columnKey: "name", width: 160),
            isDragging: true, isFocused: false, isHovering: false
        )
        XCTAssertNotEqual(lhs, other)
    }
}
