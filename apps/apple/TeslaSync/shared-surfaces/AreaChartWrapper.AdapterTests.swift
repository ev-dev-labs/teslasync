//
//  AreaChartWrapper.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  Coverage for the pure, dependency-light core of the AreaChartWrapper surface:
//    • Projector — the per-series finite-only point projection (cached → projection): the finite /
//      missing filter (web non-finite skip), the row-index x positions, and the formatted x labels.
//    • Format — the `yFormatter` parity (suffix, fraction digits, k / M abbreviation, em dash) and the
//      `xFormatter` parity (verbatim, ellipsis truncation).
//    • Palette — the `#rrggbb` decoder: exact components, with/without `#`, and the absent / malformed
//      guards (the brand-palette fallback boundary).
//    • Accessibility — the populated + empty series summaries and the joined chart value.
//    • Input / Meta — the snapshot defaults (web `height` etc.) and the diagnostics slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Projector (per-series finite projection: cached → projection)

final class AreaChartProjectorTests: XCTestCase {
    private func rows(_ matrix: [[String: Double]]) -> [AreaChartRow] {
        matrix.enumerated().map { index, values in
            AreaChartRow(x: "\(index)", values: values)
        }
    }

    func testKeepsFinitePointsWithRowIndices() {
        let source = rows([
            ["a": 1, "b": 10],
            ["a": 2, "b": .nan],
            ["a": 3]
        ])
        let pointsA = AreaChartProjector.points(rows: source, seriesId: "a")
        XCTAssertEqual(pointsA.map(\.value), [1, 2, 3], "every finite value is kept")
        XCTAssertEqual(pointsA.map(\.index), [0, 1, 2], "x position is the row index")

        let pointsB = AreaChartProjector.points(rows: source, seriesId: "b")
        XCTAssertEqual(pointsB.map(\.value), [10], "NaN + missing rows are dropped")
        XCTAssertEqual(pointsB.map(\.index), [0], "the surviving point keeps its original row index")
    }

    func testMissingSeriesProjectsToNoPoints() {
        let points = AreaChartProjector.points(rows: rows([["a": 1]]), seriesId: "missing")
        XCTAssertTrue(points.isEmpty, "a series absent from every row projects to no points")
    }

    func testLabelsFormatEveryRow() {
        let source = [
            AreaChartRow(x: "Monday", values: [:]),
            AreaChartRow(x: "Tuesday", values: [:])
        ]
        XCTAssertEqual(
            AreaChartProjector.labels(rows: source, format: .verbatim),
            ["Monday", "Tuesday"]
        )
        XCTAssertEqual(
            AreaChartProjector.labels(rows: source, format: AreaLabelFormat(maxLength: 4)),
            ["Mon…", "Tue…"],
            "labels longer than maxLength truncate with an ellipsis"
        )
    }
}

// MARK: - Format (yFormatter + xFormatter parity)

final class AreaChartFormatTests: XCTestCase {
    func testNumberAppliesSuffix() {
        XCTAssertEqual(AreaChartFormat.number(80, format: AreaValueFormat(suffix: "%")), "80%")
        XCTAssertEqual(AreaChartFormat.number(12, format: AreaValueFormat(suffix: " kWh")), "12 kWh")
    }

    func testNumberHasNoGroupingSeparator() {
        XCTAssertEqual(AreaChartFormat.number(1000), "1000", "${v} parity — no thousands separator")
    }

    func testNumberHonoursFractionDigits() {
        XCTAssertEqual(AreaChartFormat.number(80.49, format: AreaValueFormat(maximumFractionDigits: 1)), "80.5")
        XCTAssertEqual(AreaChartFormat.number(80.0, format: AreaValueFormat(maximumFractionDigits: 2)), "80")
    }

    func testNumberAbbreviates() {
        XCTAssertEqual(AreaChartFormat.number(1500, format: AreaValueFormat(abbreviate: true)), "1.5k")
        XCTAssertEqual(AreaChartFormat.number(2_000_000, format: AreaValueFormat(abbreviate: true)), "2M")
    }

    func testNumberEmDashForNonFinite() {
        XCTAssertEqual(AreaChartFormat.number(.nan, format: AreaValueFormat(suffix: "%")), "—")
        XCTAssertEqual(AreaChartFormat.number(.infinity), "—")
    }

    func testLabelVerbatimAndTruncation() {
        XCTAssertEqual(AreaChartFormat.label("14:30", format: .verbatim), "14:30")
        XCTAssertEqual(AreaChartFormat.label("short", format: AreaLabelFormat(maxLength: 10)), "short")
        XCTAssertEqual(AreaChartFormat.label("a-very-long-label", format: AreaLabelFormat(maxLength: 6)), "a-ver…")
    }
}

// MARK: - Palette (`#rrggbb` decoder)

final class AreaChartPaletteTests: XCTestCase {
    private let accuracy = 1.0 / 512.0

    func testDecodesGreen() {
        let parts = AreaChartPalette.components(forHex: "#10b981")
        XCTAssertNotNil(parts)
        XCTAssertEqual(parts?.red ?? -1, Double(0x10) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.green ?? -1, Double(0xB9) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.blue ?? -1, Double(0x81) / 255, accuracy: accuracy)
    }

    func testAcceptsBareHexWithoutHash() {
        XCTAssertEqual(
            AreaChartPalette.components(forHex: "#f59e0b"),
            AreaChartPalette.components(forHex: "f59e0b")
        )
    }

    func testRejectsAbsentAndMalformed() {
        XCTAssertNil(AreaChartPalette.components(forHex: nil))
        XCTAssertNil(AreaChartPalette.components(forHex: ""))
        XCTAssertNil(AreaChartPalette.components(forHex: "   "))
        XCTAssertNil(AreaChartPalette.components(forHex: "#fff"))
        XCTAssertNil(AreaChartPalette.components(forHex: "#zzzzzz"))
        XCTAssertNil(AreaChartPalette.components(forHex: "#10b981ff"))
    }
}

// MARK: - Accessibility (series summaries + chart value)

final class AreaChartAccessibilityTests: XCTestCase {
    func testSeriesSummaryComposesTemplate() {
        XCTAssertEqual(
            AreaChartAccessibility.seriesSummary(
                template: "%1$@: latest %2$@, low %3$@, high %4$@",
                label: "Battery %",
                latest: "80%",
                low: "60%",
                high: "92%"
            ),
            "Battery %: latest 80%, low 60%, high 92%"
        )
    }

    func testSeriesEmptyComposesTemplate() {
        XCTAssertEqual(
            AreaChartAccessibility.seriesEmpty(template: "%1$@: no data", label: "Energy"),
            "Energy: no data"
        )
    }

    func testChartValueJoinsSummaries() {
        XCTAssertEqual(
            AreaChartAccessibility.chartValue(summaries: ["Battery %: latest 80%", "Energy: no data"]),
            "Battery %: latest 80%. Energy: no data"
        )
    }
}

// MARK: - Input / meta

final class AreaChartInputTests: XCTestCase {
    func testInputDefaultsMatchWeb() {
        let input = AreaChartInput()
        XCTAssertEqual(input.availability, .loading)
        XCTAssertEqual(input.connection, .live)
        XCTAssertEqual(input.emptyBehavior, .emptyState)
        XCTAssertEqual(input.height, 300, "web height default")
        XCTAssertEqual(input.valueFormat, .plain)
        XCTAssertEqual(input.xFormat, .verbatim)
    }

    func testValueFormatDefaults() {
        let format = AreaValueFormat()
        XCTAssertEqual(format.suffix, "")
        XCTAssertEqual(format.maximumFractionDigits, 2)
        XCTAssertFalse(format.abbreviate)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AreaChartMeta.surfaceSlug, "AreaChartWrapper")
        XCTAssertEqual(AreaChartWrapper.surfaceSlug, "AreaChartWrapper")
    }
}
