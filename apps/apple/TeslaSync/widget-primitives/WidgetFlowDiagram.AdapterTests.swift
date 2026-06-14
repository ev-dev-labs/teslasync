//
//  WidgetFlowDiagram.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + state-holder): the surface identity, the position
//  → viewBox-coordinate table (web `POSITION_COORDS`), the props defaults + Equatable, the geometry math
//  (web `strokeForValue` / `maxArrowValue` / `arrowColor` / endpoint-offset / compact top-3 / label
//  compaction / `AnimatedNumber decimals={1}`), the render-branch projection (web `nodes.length === 0
//  ? <EmptyState/> : <svg/>`) incl. the missing-endpoint drop + duplicate-id last-wins + tone-override
//  resolution, the accessibility label builders, and the model's once-only `view.opened` (P1/S11) + prop
//  re-derivation. Split from WidgetFlowDiagram.Tests.swift (the SwiftUI composition half) to keep each file
//  within the SwiftLint file-length budget and so this half runs on a plain host with no SwiftUI. These run
//  in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class WidgetFlowDiagramAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        // The View's `surfaceSlug` (MainActor-isolated) is asserted in the @MainActor Tests.swift half.
        XCTAssertEqual(WidgetFlowDiagramSurface.slug, "WidgetFlowDiagram")
    }
}

// MARK: - FlowNodePosition (web POSITION_COORDS)

final class FlowNodePositionTests: XCTestCase {
    func testCoordinatesMatchWebTable() {
        XCTAssertEqual(FlowNodePosition.top.point, CGPoint(x: 50, y: 12))
        XCTAssertEqual(FlowNodePosition.bottom.point, CGPoint(x: 50, y: 88))
        XCTAssertEqual(FlowNodePosition.left.point, CGPoint(x: 12, y: 50))
        XCTAssertEqual(FlowNodePosition.right.point, CGPoint(x: 88, y: 50))
        XCTAssertEqual(FlowNodePosition.center.point, CGPoint(x: 50, y: 50))
    }

    func testLabelPlacement() {
        XCTAssertFalse(FlowNodePosition.bottom.placesLabelAbove)
        for position in [FlowNodePosition.top, .left, .right, .center] {
            XCTAssertTrue(position.placesLabelAbove)
        }
    }

    func testPositionCaseCount() {
        XCTAssertEqual(FlowNodePosition.allCases.count, 5)
    }
}

// MARK: - Props + value types

final class WidgetFlowInputTests: XCTestCase {
    func testDefaultsMatchWebProps() {
        let input = WidgetFlowInput(nodes: [], arrows: [])
        XCTAssertFalse(input.compact)
        XCTAssertTrue(input.nodes.isEmpty)
        XCTAssertTrue(input.arrows.isEmpty)
    }

    func testNodeAndArrowDefaults() {
        let node = FlowNode(id: "a", label: "A", value: 1, formattedValue: "1", position: .left)
        XCTAssertNil(node.systemImage)
        let arrow = FlowArrow(from: "a", to: "b", value: 1, active: true)
        XCTAssertNil(arrow.colorPaletteIndex)
    }

    func testEquatable() {
        let lhs = WidgetFlowInput(nodes: [], arrows: [], compact: true)
        let rhs = WidgetFlowInput(nodes: [], arrows: [], compact: true)
        let other = WidgetFlowInput(nodes: [], arrows: [], compact: false)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, other)
    }
}

// MARK: - Geometry: radius / stroke / max / tone

final class FlowDiagramGeometryScalarTests: XCTestCase {
    func testRadius() {
        XCTAssertEqual(FlowDiagramGeometry.radius(compact: false), 14)
        XCTAssertEqual(FlowDiagramGeometry.radius(compact: true), 10)
    }

    func testStrokeWidthScalesByRatio() {
        // web strokeForValue: minStroke + ratio * (maxStroke - minStroke)
        XCTAssertEqual(FlowDiagramGeometry.strokeWidth(value: 0, maxValue: 10), 1, accuracy: 1e-9)
        XCTAssertEqual(FlowDiagramGeometry.strokeWidth(value: 5, maxValue: 10), 2.5, accuracy: 1e-9)
        XCTAssertEqual(FlowDiagramGeometry.strokeWidth(value: 10, maxValue: 10), 4, accuracy: 1e-9)
        XCTAssertEqual(FlowDiagramGeometry.strokeWidth(value: -10, maxValue: 10), 4, accuracy: 1e-9)
    }

    func testStrokeWidthZeroMaxFloorsToMin() {
        XCTAssertEqual(FlowDiagramGeometry.strokeWidth(value: 5, maxValue: 0), 1, accuracy: 1e-9)
    }

    func testMaxArrowValueFloorsAtOne() {
        XCTAssertEqual(FlowDiagramGeometry.maxArrowValue([]), 1, accuracy: 1e-9)
        let zeros = [FlowArrow(from: "a", to: "b", value: 0, active: false)]
        XCTAssertEqual(FlowDiagramGeometry.maxArrowValue(zeros), 1, accuracy: 1e-9)
    }

    func testMaxArrowValuePicksPeakMagnitude() {
        let arrows = [
            FlowArrow(from: "a", to: "b", value: 3, active: false),
            FlowArrow(from: "b", to: "c", value: -7, active: false),
            FlowArrow(from: "c", to: "d", value: 2, active: false)
        ]
        XCTAssertEqual(FlowDiagramGeometry.maxArrowValue(arrows), 7, accuracy: 1e-9)
    }

    func testToneBySign() {
        XCTAssertEqual(FlowDiagramGeometry.tone(forValue: 4), .positive)
        XCTAssertEqual(FlowDiagramGeometry.tone(forValue: -4), .negative)
        XCTAssertEqual(FlowDiagramGeometry.tone(forValue: 0), .neutral)
    }
}

// MARK: - Geometry: visible arrows / labels / endpoints / value text

final class FlowDiagramGeometryRenderTests: XCTestCase {
    private let sample = [
        FlowArrow(from: "n1", to: "n2", value: 1, active: false),
        FlowArrow(from: "n3", to: "n4", value: -5, active: false),
        FlowArrow(from: "n5", to: "n6", value: 3, active: false),
        FlowArrow(from: "n7", to: "n8", value: 2, active: false)
    ]

    func testVisibleArrowsNonCompactReturnsAll() {
        let visible = FlowDiagramGeometry.visibleArrows(sample, compact: false)
        XCTAssertEqual(visible.map(\.from), ["n1", "n3", "n5", "n7"])
    }

    func testVisibleArrowsCompactTakesTopThreeByMagnitude() {
        let visible = FlowDiagramGeometry.visibleArrows(sample, compact: true)
        XCTAssertEqual(visible.count, 3)
        XCTAssertEqual(visible.map(\.from), ["n3", "n5", "n7"]) // |5|, |3|, |2| — |1| dropped
    }

    func testVisibleArrowsCompactSortIsStableForTies() {
        let ties = [
            FlowArrow(from: "first", to: "x", value: 2, active: false),
            FlowArrow(from: "second", to: "x", value: -2, active: false),
            FlowArrow(from: "peak", to: "x", value: 5, active: false)
        ]
        let visible = FlowDiagramGeometry.visibleArrows(ties, compact: true)
        XCTAssertEqual(visible.map(\.from), ["peak", "first", "second"])
    }

    func testDisplayLabelCompaction() {
        XCTAssertEqual(FlowDiagramGeometry.displayLabel("Battery", compact: false), "Battery")
        XCTAssertEqual(FlowDiagramGeometry.displayLabel("Battery", compact: true), "BAT")
        XCTAssertEqual(FlowDiagramGeometry.displayLabel("ABC", compact: true), "ABC")
        XCTAssertEqual(FlowDiagramGeometry.displayLabel("AB", compact: true), "AB")
    }

    func testEndpointsOffsetByRadius() {
        let segment = FlowDiagramGeometry.endpoints(
            from: CGPoint(x: 12, y: 50),
            to: CGPoint(x: 88, y: 50),
            radius: 14
        )
        XCTAssertEqual(segment.start.x, 26, accuracy: 1e-9)
        XCTAssertEqual(segment.start.y, 50, accuracy: 1e-9)
        XCTAssertEqual(segment.end.x, 74, accuracy: 1e-9)
        XCTAssertEqual(segment.end.y, 50, accuracy: 1e-9)
    }

    func testEndpointsDegenerateSamePointStaysCoincident() {
        let segment = FlowDiagramGeometry.endpoints(
            from: CGPoint(x: 50, y: 50),
            to: CGPoint(x: 50, y: 50),
            radius: 14
        )
        XCTAssertEqual(segment.start, CGPoint(x: 50, y: 50))
        XCTAssertEqual(segment.end, CGPoint(x: 50, y: 50))
    }

    func testDisplayValueTextOneDecimalDeterministic() {
        let posix = Locale(identifier: "en_US_POSIX")
        XCTAssertEqual(FlowDiagramGeometry.displayValueText(12, locale: posix), "12.0")
        XCTAssertEqual(FlowDiagramGeometry.displayValueText(7.2, locale: posix), "7.2")
        XCTAssertEqual(FlowDiagramGeometry.displayValueText(1234.5, locale: posix), "1234.5")
    }
}

// MARK: - Projector (web render branch)

final class WidgetFlowDiagramProjectorTests: XCTestCase {
    private func node(_ id: String, _ position: FlowNodePosition, value: Double = 1) -> FlowNode {
        FlowNode(id: id, label: id, value: value, formattedValue: "\(id)", position: position)
    }

    func testEmptyWhenNoNodes() {
        let projection = WidgetFlowDiagramProjector.resolve(WidgetFlowInput(nodes: [], arrows: []))
        XCTAssertEqual(projection, .empty)
    }

    func testDiagramWhenNodesPresent() {
        let input = WidgetFlowInput(nodes: [node("a", .left)], arrows: [])
        guard case let .diagram(canvas) = WidgetFlowDiagramProjector.resolve(input) else {
            return XCTFail("expected a populated diagram")
        }
        XCTAssertEqual(canvas.nodes.count, 1)
        XCTAssertEqual(canvas.nodeRadius, 14)
    }

    func testCompactCanvasUsesCompactRadiusAndArrowSlice() {
        let nodes = [node("a", .left), node("b", .right), node("c", .top), node("d", .bottom)]
        let arrows = [
            FlowArrow(from: "a", to: "b", value: 1, active: false),
            FlowArrow(from: "b", to: "c", value: 5, active: false),
            FlowArrow(from: "c", to: "d", value: 4, active: false),
            FlowArrow(from: "d", to: "a", value: 3, active: false)
        ]
        let canvas = WidgetFlowDiagramProjector.canvas(WidgetFlowInput(nodes: nodes, arrows: arrows, compact: true))
        XCTAssertEqual(canvas.nodeRadius, 10)
        XCTAssertEqual(canvas.arrows.count, 3) // top-3 by magnitude
        XCTAssertEqual(canvas.nodes.count, 4) // all nodes still projected
    }

    func testArrowWithMissingEndpointIsDropped() {
        let input = WidgetFlowInput(
            nodes: [node("a", .left), node("b", .right)],
            arrows: [
                FlowArrow(from: "a", to: "b", value: 1, active: false),
                FlowArrow(from: "ghost", to: "b", value: 9, active: false)
            ]
        )
        let canvas = WidgetFlowDiagramProjector.canvas(input)
        XCTAssertEqual(canvas.arrows.count, 1)
        XCTAssertEqual(canvas.arrows.first?.from, "a")
    }

    func testToneOverrideWinsOverSign() {
        let input = WidgetFlowInput(
            nodes: [node("a", .left), node("b", .right)],
            arrows: [FlowArrow(from: "a", to: "b", value: -5, active: false, colorPaletteIndex: 3)]
        )
        let canvas = WidgetFlowDiagramProjector.canvas(input)
        XCTAssertEqual(canvas.arrows.first?.tone, .palette(3))
    }

    func testToneFallsBackToSignWhenNoOverride() {
        let input = WidgetFlowInput(
            nodes: [node("a", .left), node("b", .right)],
            arrows: [FlowArrow(from: "a", to: "b", value: -5, active: false)]
        )
        let canvas = WidgetFlowDiagramProjector.canvas(input)
        XCTAssertEqual(canvas.arrows.first?.tone, .negative)
    }

    func testDuplicateNodeIDLastWinsForArrowLookup() {
        // web `new Map(nodes.map(...))` keeps the LAST node for a duplicated id.
        let input = WidgetFlowInput(
            nodes: [node("a", .left), node("a", .top), node("b", .right)],
            arrows: [FlowArrow(from: "b", to: "a", value: 1, active: false)]
        )
        let canvas = WidgetFlowDiagramProjector.canvas(input)
        // Endpoint resolves toward the TOP node (y≈12), not the LEFT node (y=50).
        XCTAssertLessThan(canvas.arrows.first?.end.y ?? 99, 30)
        XCTAssertEqual(canvas.nodes.count, 3) // every node (incl. the duplicate) is still drawn
    }
}

// MARK: - Accessibility

final class WidgetFlowDiagramAccessibilityTests: XCTestCase {
    private func projected(_ id: String, label: String, formatted: String) -> ProjectedFlowNode {
        ProjectedFlowNode(
            id: id,
            center: .zero,
            displayValue: 0,
            label: label,
            displayLabel: label,
            formattedValue: formatted,
            systemImage: nil,
            placesLabelAbove: true
        )
    }

    func testNodeLabelUsesFullLabelAndFormattedValue() {
        let node = projected("battery", label: "Battery", formatted: "78%")
        XCTAssertEqual(WidgetFlowDiagramAccessibility.nodeLabel(for: node), "Battery: 78%")
    }

    func testSummaryJoinsNodes() {
        let canvas = FlowDiagramCanvas(
            nodeRadius: 14,
            nodes: [
                projected("battery", label: "Battery", formatted: "78%"),
                projected("motor", label: "Motor", formatted: "12.4 kW")
            ],
            arrows: []
        )
        XCTAssertEqual(
            WidgetFlowDiagramAccessibility.summary(for: canvas),
            "Battery: 78%, Motor: 12.4 kW"
        )
    }
}

// MARK: - Localization facade (P1/S10)

final class WidgetFlowDiagramStringsTests: XCTestCase {
    func testTableName() {
        XCTAssertEqual(WidgetFlowDiagramStrings.table, "WidgetFlowDiagram")
    }

    func testFallbacksResolveToWebEnglish() {
        XCTAssertEqual(WidgetFlowDiagramStrings.emptyMessage, "No flow data available")
        XCTAssertEqual(WidgetFlowDiagramStrings.accessibilityLabel, "Energy flow diagram")
        XCTAssertFalse(WidgetFlowDiagramStrings.emptyHint.isEmpty)
    }
}

// MARK: - State-holder (P1/S8) — once-only view.opened + prop re-derivation

private final class SpyFlowDiagramTelemetry: WidgetFlowDiagramTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []
    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

@MainActor
final class WidgetFlowDiagramModelTests: XCTestCase {
    private func node(_ id: String) -> FlowNode {
        FlowNode(id: id, label: id, value: 1, formattedValue: id, position: .center)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyFlowDiagramTelemetry()
        let model = WidgetFlowDiagramModel(input: WidgetFlowInput(nodes: [], arrows: []), telemetry: spy)
        model.start()
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.openedSurfaces, ["WidgetFlowDiagram"])
    }

    func testProjectionReflectsInput() {
        let model = WidgetFlowDiagramModel(input: WidgetFlowInput(nodes: [], arrows: []))
        XCTAssertEqual(model.projection, .empty)
        model.update(WidgetFlowInput(nodes: [node("a")], arrows: []))
        guard case .diagram = model.projection else {
            return XCTFail("expected a populated diagram after update")
        }
    }

    func testUpdateIgnoresIdenticalInput() {
        let model = WidgetFlowDiagramModel(input: WidgetFlowInput(nodes: [node("a")], arrows: []))
        let before = model.input
        model.update(WidgetFlowInput(nodes: [node("a")], arrows: []))
        XCTAssertEqual(model.input, before)
    }
}
