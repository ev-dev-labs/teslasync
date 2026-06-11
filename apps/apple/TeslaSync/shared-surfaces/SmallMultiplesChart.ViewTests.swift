//
//  SmallMultiplesChart.ViewTests.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  The per-state view signature contract for the SmallMultiplesChart surface — every state's subview
//  composes (loading / empty / error / populated), the interactive + passive cell composes, the cell
//  chart composes with a scrub selection, the freshness chip composes, and the dynamic swatch colour
//  falls back to the brand palette for an absent / malformed hex. Split from `SmallMultiplesChart.
//  Tests.swift` to keep each file within the SwiftLint file-length budget.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class SmallMultiplesChartViewTests: XCTestCase {
    private func sampleData() -> SmallMultiplesData {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let samples = [
            SmallMultiplesSample(date: base, values: ["speed": 10]),
            SmallMultiplesSample(date: base.addingTimeInterval(60), values: ["speed": 20])
        ]
        let series = [SmallMultiplesSeries(id: "speed", label: "Speed", colorHex: "#3b82f6", colorIndex: 0)]
        return SmallMultiplesData(samples: samples, series: series)
    }

    private func sampleRow(hasData: Bool = true, interactive: Bool = true) -> SmallMultiplesCellRow {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let points = hasData
            ? [
                SmallMultiplesPoint(date: base, value: 10),
                SmallMultiplesPoint(date: base.addingTimeInterval(60), value: 20)
            ]
            : []
        return SmallMultiplesCellRow(
            id: "speed",
            label: "Speed",
            colorHex: "#3b82f6",
            colorIndex: 0,
            points: points,
            hasData: hasData,
            isInteractive: interactive,
            emptyLabel: "No data",
            accessibilityLabel: "Speed",
            accessibilityValue: hasData ? "Latest 20, low 10, high 20" : "No data",
            accessibilityHint: interactive ? "Double tap to open this series" : nil
        )
    }

    func testSurfaceInitializers() {
        let source = InMemorySmallMultiplesSource(initial: SmallMultiplesInput(availability: .loading))
        _ = SmallMultiplesChart(model: SmallMultiplesChartModel(source: source))
        _ = SmallMultiplesChart(input: SmallMultiplesInput(availability: .resolved(sampleData()))) { _ in }
    }

    func testStateSubviewsCompose() {
        let layout = SmallMultiplesLayout(columns: nil, cellMinWidth: 280, cellHeight: 120)
        _ = SmallMultiplesLoadingView(layout: layout)
        _ = SmallMultiplesEmptyView(content: SmallMultiplesEmpty(title: "t", message: "m"))
        _ = SmallMultiplesErrorView(
            content: SmallMultiplesErrorContent(message: "m", accessibilityLabel: "a")
        ) {}
        _ = SmallMultiplesPopulatedView(
            gridAccessibilityLabel: "Small multiples chart",
            layout: layout,
            freshness: SmallMultiplesFreshness(label: "Stale", accessibilityLabel: "a", isOffline: false),
            cells: [sampleRow()],
            onRefresh: {},
            onSelect: { _ in }
        )
    }

    func testCellAndChartCompose() {
        _ = SmallMultiplesCellView(
            cell: sampleRow(),
            height: 120,
            selection: nil,
            onScrub: { _ in },
            onSelect: {}
        )
        _ = SmallMultiplesCellView(
            cell: sampleRow(hasData: false, interactive: false),
            height: 120,
            selection: nil,
            onScrub: { _ in },
            onSelect: {}
        )
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        _ = SmallMultiplesCellChart(
            cell: sampleRow(),
            height: 120,
            selection: base.addingTimeInterval(30),
            onScrub: { _ in }
        )
        _ = SmallMultiplesFreshnessChip(
            freshness: SmallMultiplesFreshness(label: "Offline", accessibilityLabel: "a", isOffline: true)
        ) {}
    }

    func testColorFallsBackToPalette() {
        XCTAssertEqual(smallMultiplesColor(hex: "#zzzzzz", colorIndex: 0), TSChartPalette.color(at: 0))
        XCTAssertEqual(smallMultiplesColor(hex: nil, colorIndex: 2), TSChartPalette.color(at: 2))
    }
}
