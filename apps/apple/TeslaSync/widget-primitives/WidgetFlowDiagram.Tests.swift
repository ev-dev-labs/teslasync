//
//  WidgetFlowDiagram.Tests.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The SwiftUI composition half of the coverage (the pure adapter + state-holder + facade live in
//  WidgetFlowDiagram.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • Layout — the viewBox → live coordinate mapping (``FlowDiagramLayout``): uniform scale, centering
//      (SVG `xMidYMid meet`), and the degenerate zero-size guard.
//    • Tone → color — every ``FlowArrowTone`` resolves to a concrete token color (incl. the palette wrap).
//    • Views — the public surface composes in every real branch (empty / populated / compact), via the
//      prop initializer and the injected-model seam; the subviews (empty leaf, canvas, node chip, arrows
//      layer) compose.
//    • Per-state render — each branch renders to an image (ImageRenderer): empty leaf, populated graph,
//      compact graph, and an all-active graph (the marching-ants path).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum FlowFixture {
    static let nodes: [FlowNode] = [
        FlowNode(
            id: "battery",
            label: "Battery",
            value: 78,
            formattedValue: "78%",
            systemImage: "battery.100.bolt",
            position: .left
        ),
        FlowNode(
            id: "motor",
            label: "Consuming",
            value: 12.4,
            formattedValue: "12.4 kW",
            systemImage: "bolt.fill",
            position: .right
        ),
        FlowNode(
            id: "charger",
            label: "Charger",
            value: 7.2,
            formattedValue: "7.2 kW",
            systemImage: "powerplug.fill",
            position: .top
        )
    ]

    static let arrows: [FlowArrow] = [
        FlowArrow(from: "battery", to: "motor", value: 12.4, active: true, colorPaletteIndex: 4),
        FlowArrow(from: "motor", to: "battery", value: 0, active: false),
        FlowArrow(from: "charger", to: "battery", value: 7.2, active: true, colorPaletteIndex: 1)
    ]

    static func canvas(compact: Bool = false) -> FlowDiagramCanvas {
        WidgetFlowDiagramProjector.canvas(WidgetFlowInput(nodes: nodes, arrows: arrows, compact: compact))
    }
}

// MARK: - Layout (viewBox → live; SVG xMidYMid meet)

final class FlowDiagramLayoutTests: XCTestCase {
    func testUniformScaleAndHorizontalCentering() {
        let layout = FlowDiagramLayout(size: CGSize(width: 200, height: 100))
        XCTAssertEqual(layout.scale, 1, accuracy: 1e-9)
        // The 100-wide box is centered in the 200-wide view.
        XCTAssertEqual(layout.originX, 50, accuracy: 1e-9)
        XCTAssertEqual(layout.originY, 0, accuracy: 1e-9)
        let mapped = layout.point(CGPoint(x: 50, y: 50))
        XCTAssertEqual(mapped.x, 100, accuracy: 1e-9)
        XCTAssertEqual(mapped.y, 50, accuracy: 1e-9)
        XCTAssertEqual(layout.length(14), 14, accuracy: 1e-9)
    }

    func testSquareScales() {
        let layout = FlowDiagramLayout(size: CGSize(width: 240, height: 240))
        XCTAssertEqual(layout.scale, 2.4, accuracy: 1e-9)
        XCTAssertEqual(layout.length(10), 24, accuracy: 1e-9)
        let mapped = layout.point(CGPoint(x: 50, y: 12))
        XCTAssertEqual(mapped.x, 120, accuracy: 1e-9)
        XCTAssertEqual(mapped.y, 28.8, accuracy: 1e-9)
    }

    func testZeroSizeCollapsesScaleSafely() {
        let layout = FlowDiagramLayout(size: .zero)
        XCTAssertEqual(layout.scale, 0)
        XCTAssertEqual(layout.point(CGPoint(x: 50, y: 50)), .zero)
    }
}

// MARK: - Tone → color

final class FlowArrowToneColorTests: XCTestCase {
    func testEveryToneResolvesToAColor() {
        XCTAssertEqual(FlowArrowTone.positive.color, Color.TS.statusSuccess)
        XCTAssertEqual(FlowArrowTone.negative.color, Color.TS.statusDanger)
        XCTAssertEqual(FlowArrowTone.neutral.color, Color.TS.textMuted)
        // palette index wraps (TSChartPalette handles modulo) — just assert it produces a color.
        XCTAssertEqual(FlowArrowTone.palette(2).color, TSChartPalette.color(at: 2))
        XCTAssertEqual(FlowArrowTone.palette(99).color, TSChartPalette.color(at: 99))
    }
}

// MARK: - Composition (every real branch composes)

@MainActor
final class WidgetFlowDiagramCompositionTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetFlowDiagram(nodes: FlowFixture.nodes, arrows: FlowFixture.arrows)
        _ = WidgetFlowDiagram(nodes: FlowFixture.nodes, arrows: FlowFixture.arrows, compact: true)
        _ = WidgetFlowDiagram(nodes: [], arrows: [])
        _ = WidgetFlowDiagram(nodes: [], arrows: [], emptyMessage: "Custom empty")
    }

    func testSurfaceComposesFromInjectedModel() {
        let model = WidgetFlowDiagramModel(
            input: WidgetFlowInput(nodes: FlowFixture.nodes, arrows: FlowFixture.arrows),
            telemetry: OSLogWidgetFlowDiagramTelemetry()
        )
        _ = WidgetFlowDiagram(model: model)
        XCTAssertEqual(WidgetFlowDiagram.surfaceSlug, "WidgetFlowDiagram")
    }

    func testSubviewsCompose() {
        _ = WidgetFlowDiagramEmptyState(message: WidgetFlowDiagramStrings.emptyMessage)
        _ = WidgetFlowDiagramCanvasView(canvas: FlowFixture.canvas())
        let layout = FlowDiagramLayout(size: CGSize(width: 240, height: 240))
        _ = FlowArrowsLayer(arrows: FlowFixture.canvas().arrows, layout: layout, animates: true)
        if let node = FlowFixture.canvas().nodes.first {
            _ = FlowNodeChip(node: node, radius: 14, layout: layout, locale: .current)
        }
    }
}

// MARK: - Per-state render smoke

@MainActor
final class WidgetFlowDiagramRenderTests: XCTestCase {
    private func assertRenders(_ view: some View, _ message: String, width: CGFloat, height: CGFloat) {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage, message)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage, message)
        #endif
    }

    func testRendersPopulated() {
        assertRenders(
            WidgetFlowDiagram(nodes: FlowFixture.nodes, arrows: FlowFixture.arrows),
            "populated graph should render",
            width: 280,
            height: 240
        )
    }

    func testRendersCompact() {
        assertRenders(
            WidgetFlowDiagram(nodes: FlowFixture.nodes, arrows: FlowFixture.arrows, compact: true),
            "compact graph should render",
            width: 150,
            height: 150
        )
    }

    func testRendersEmptyLeaf() {
        assertRenders(
            WidgetFlowDiagram(nodes: [], arrows: []),
            "empty leaf should render",
            width: 280,
            height: 200
        )
    }

    func testRendersStaticArrowsLayerForActiveEdges() {
        // The non-animated render path (Reduce Motion / snapshot): a populated canvas with active edges.
        let layout = FlowDiagramLayout(size: CGSize(width: 240, height: 240))
        assertRenders(
            FlowArrowsLayer(arrows: FlowFixture.canvas().arrows, layout: layout, animates: false),
            "static arrows layer should render",
            width: 240,
            height: 240
        )
    }
}
