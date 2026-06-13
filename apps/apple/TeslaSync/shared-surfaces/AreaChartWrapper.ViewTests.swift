//
//  AreaChartWrapper.ViewTests.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  The per-state view signature contract for the AreaChartWrapper surface — every state's subview
//  composes (loading / empty / error / populated), the chart canvas + scrub tooltip compose, the
//  freshness chip composes, and the dynamic swatch colour falls back to the brand palette for a
//  malformed hex while a valid hex decodes. Split from `AreaChartWrapper.Tests.swift` to keep each file
//  within the SwiftLint file-length budget.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class AreaChartWrapperViewTests: XCTestCase {
    private func sampleData() -> AreaChartData {
        let rows = [
            AreaChartRow(x: "0", values: ["battery": 10]),
            AreaChartRow(x: "1", values: ["battery": 20])
        ]
        let series = [AreaChartSeries(id: "battery", label: "Battery %", colorHex: "#10b981", colorIndex: 2)]
        return AreaChartData(rows: rows, series: series)
    }

    private func sampleRow(hasData: Bool = true) -> AreaChartSeriesRow {
        let points = hasData
            ? [AreaChartPoint(index: 0, value: 10), AreaChartPoint(index: 1, value: 20)]
            : []
        return AreaChartSeriesRow(
            id: "battery",
            label: "Battery %",
            colorHex: "#10b981",
            colorIndex: 2,
            points: points,
            accessibilitySummary: hasData ? "Battery %: latest 20%, low 10%, high 20%" : "Battery %: no data"
        )
    }

    private func samplePlot() -> AreaChartPlot {
        AreaChartPlot(
            series: [sampleRow()],
            labels: ["0", "1"],
            valueFormat: AreaValueFormat(suffix: "%"),
            accessibilitySummary: "Battery %: latest 20%, low 10%, high 20%"
        )
    }

    func testSurfaceInitializers() {
        let source = InMemoryAreaChartSource(initial: AreaChartInput(availability: .loading))
        _ = AreaChartWrapper(model: AreaChartWrapperModel(source: source))
        _ = AreaChartWrapper(input: AreaChartInput(availability: .resolved(sampleData())))
    }

    func testStateSubviewsCompose() {
        _ = AreaChartLoadingView(height: 220)
        _ = AreaChartEmptyView(content: AreaChartEmpty(title: "t", message: "m"), height: 220)
        _ = AreaChartErrorView(
            content: AreaChartErrorContent(message: "m", accessibilityLabel: "a")
        ) {}
        _ = AreaChartPopulatedView(
            chartAccessibilityLabel: "Area chart",
            plot: samplePlot(),
            height: 220,
            freshness: AreaChartFreshness(label: "Stale", accessibilityLabel: "a", isOffline: false),
            onRefresh: {}
        )
        _ = AreaChartPopulatedView(
            chartAccessibilityLabel: "Area chart",
            plot: samplePlot(),
            height: 220,
            freshness: nil,
            onRefresh: {}
        )
    }

    func testCanvasAndTooltipCompose() {
        _ = AreaChartCanvas(plot: samplePlot(), height: 220)
        _ = AreaChartTooltip(plot: samplePlot(), index: 1)
        _ = AreaChartTooltip(plot: samplePlot(), index: 99)
        _ = AreaChartFreshnessChip(
            freshness: AreaChartFreshness(label: "Offline", accessibilityLabel: "a", isOffline: true)
        ) {}
    }

    func testEmptySeriesRowCellComposes() {
        let plot = AreaChartPlot(
            series: [sampleRow(hasData: false)],
            labels: ["0", "1"],
            valueFormat: .plain,
            accessibilitySummary: "Battery %: no data"
        )
        _ = AreaChartCanvas(plot: plot, height: 220)
    }

    func testColorFallsBackToPaletteForMalformedHex() {
        XCTAssertEqual(areaChartColor(hex: "#zzzzzz", colorIndex: 0), TSChartPalette.color(at: 0))
        XCTAssertEqual(areaChartColor(hex: "", colorIndex: 3), TSChartPalette.color(at: 3))
    }

    func testValidHexDecodesInsteadOfPalette() {
        XCTAssertNotEqual(
            areaChartColor(hex: "#10b981", colorIndex: 0),
            TSChartPalette.color(at: 0),
            "a valid hex decodes to its own colour, not the palette fallback"
        )
    }
}
