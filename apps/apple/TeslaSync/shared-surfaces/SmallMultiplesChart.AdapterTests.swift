//
//  SmallMultiplesChart.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  Coverage for the pure, dependency-light core of the SmallMultiplesChart surface:
//    • Sampler — the verbatim `strideSample` port: identity below cap, the ceil-stride downsample,
//      first + last always preserved, and the `cap <= 0` guard.
//    • Cells — the per-cell projection (cached → projection): the finite-only filter (web
//      `isFinitePoint`), the per-cell downsample, and the `hasData` flag.
//    • Palette — the `#rrggbb` decoder: exact components, with/without `#`, and the absent / malformed
//      guards (the brand-palette fallback boundary).
//    • Axis — the `formatTime` time label (locale + timezone deterministic) and the abbreviated
//      number label (k / M / fraction / em-dash).
//    • Accessibility — the cell label, the data vs no-data value, and the interactive vs passive hint.
//    • Input / Meta — the snapshot defaults and the diagnostics slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Sampler (verbatim `strideSample` port)

final class SmallMultiplesSamplerTests: XCTestCase {
    func testReturnsIdentityWhenWithinCap() {
        let rows = Array(0 ..< 10)
        XCTAssertEqual(SmallMultiplesSampler.strideSample(rows, cap: 10), rows)
        XCTAssertEqual(SmallMultiplesSampler.strideSample(rows, cap: 50), rows)
    }

    func testEmptyForNonPositiveCap() {
        XCTAssertTrue(SmallMultiplesSampler.strideSample(Array(0 ..< 10), cap: 0).isEmpty)
        XCTAssertTrue(SmallMultiplesSampler.strideSample(Array(0 ..< 10), cap: -3).isEmpty)
    }

    func testStridesAndKeepsAlignedLast() {
        // count 10, cap 4 → stride = ceil(10/4) = 3 → indices 0,3,6,9 (9 is aligned, already kept).
        XCTAssertEqual(SmallMultiplesSampler.strideSample(Array(0 ..< 10), cap: 4), [0, 3, 6, 9])
    }

    func testAlwaysAppendsUnalignedLast() {
        // count 8, cap 3 → stride = ceil(8/3) = 3 → indices 0,3,6 then the final row 7 is appended.
        XCTAssertEqual(SmallMultiplesSampler.strideSample(Array(0 ..< 8), cap: 3), [0, 3, 6, 7])
    }

    func testLargeSeriesIsCappedWithEndpointsPreserved() {
        let rows = Array(0 ..< 401)
        let sampled = SmallMultiplesSampler.strideSample(rows, cap: 400)
        XCTAssertLessThanOrEqual(sampled.count, 401)
        XCTAssertEqual(sampled.first, 0)
        XCTAssertEqual(sampled.last, 400, "the final row is always preserved")
    }
}

// MARK: - Cells (per-cell projection: cached → projection)

final class SmallMultiplesCellsTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func sample(_ offset: Int, _ values: [String: Double]) -> SmallMultiplesSample {
        SmallMultiplesSample(date: base.addingTimeInterval(Double(offset) * 60), values: values)
    }

    func testFiltersNonFiniteAndMissingPerCell() {
        let samples = [
            sample(0, ["a": 1, "b": 10]),
            sample(1, ["a": 2, "b": .nan]),
            sample(2, ["a": 3])
        ]
        let series = [
            SmallMultiplesSeries(id: "a", label: "A"),
            SmallMultiplesSeries(id: "b", label: "B"),
            SmallMultiplesSeries(id: "c", label: "C")
        ]
        let cells = SmallMultiplesCells.project(samples: samples, series: series, maxPointsPerCell: 400)
        XCTAssertEqual(cells.count, 3)

        let cellA = cells[0]
        XCTAssertEqual(cellA.points.map(\.value), [1, 2, 3], "every finite value is kept")
        XCTAssertTrue(cellA.hasData)

        let cellB = cells[1]
        XCTAssertEqual(cellB.points.map(\.value), [10], "NaN + missing rows are dropped")
        XCTAssertTrue(cellB.hasData)

        let cellC = cells[2]
        XCTAssertTrue(cellC.points.isEmpty, "a series with no rows projects to no points")
        XCTAssertFalse(cellC.hasData, "no finite points → hasData is false (per-cell 'No data')")
    }

    func testProjectionCarriesSeriesIdentity() {
        let samples = [sample(0, ["speed": 42])]
        let series = [SmallMultiplesSeries(id: "speed", label: "Speed", colorHex: "#3b82f6", colorIndex: 2)]
        let cells = SmallMultiplesCells.project(samples: samples, series: series, maxPointsPerCell: 400)
        XCTAssertEqual(cells[0].id, "speed")
        XCTAssertEqual(cells[0].label, "Speed")
        XCTAssertEqual(cells[0].colorHex, "#3b82f6")
        XCTAssertEqual(cells[0].colorIndex, 2)
    }

    func testPerCellDownsampleCapsPoints() {
        let samples = (0 ..< 1000).map { sample($0, ["a": Double($0)]) }
        let cells = SmallMultiplesCells.project(
            samples: samples,
            series: [SmallMultiplesSeries(id: "a", label: "A")],
            maxPointsPerCell: 100
        )
        let points = cells[0].points
        XCTAssertLessThanOrEqual(points.count, 101, "capped near maxPointsPerCell")
        XCTAssertEqual(points.first?.value, 0, "first row preserved")
        XCTAssertEqual(points.last?.value, 999, "last row preserved")
    }
}

// MARK: - Palette (`#rrggbb` decoder)

final class SmallMultiplesPaletteTests: XCTestCase {
    private let accuracy = 1.0 / 512.0

    func testDecodesBlue() {
        let parts = SmallMultiplesPalette.components(forHex: "#3b82f6")
        XCTAssertNotNil(parts)
        XCTAssertEqual(parts?.red ?? -1, Double(0x3B) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.green ?? -1, Double(0x82) / 255, accuracy: accuracy)
        XCTAssertEqual(parts?.blue ?? -1, Double(0xF6) / 255, accuracy: accuracy)
    }

    func testAcceptsBareHexWithoutHash() {
        XCTAssertEqual(
            SmallMultiplesPalette.components(forHex: "#22c55e"),
            SmallMultiplesPalette.components(forHex: "22c55e")
        )
    }

    func testRejectsAbsentAndMalformed() {
        XCTAssertNil(SmallMultiplesPalette.components(forHex: nil))
        XCTAssertNil(SmallMultiplesPalette.components(forHex: ""))
        XCTAssertNil(SmallMultiplesPalette.components(forHex: "   "))
        XCTAssertNil(SmallMultiplesPalette.components(forHex: "#fff"))
        XCTAssertNil(SmallMultiplesPalette.components(forHex: "#zzzzzz"))
        XCTAssertNil(SmallMultiplesPalette.components(forHex: "#3b82f6ff"))
    }
}

// MARK: - Axis (formatTime time label + abbreviated number label)

final class SmallMultiplesAxisTests: XCTestCase {
    func testTimeLabelIsLocaleAndZoneDeterministic() {
        let utc = TimeZone(identifier: "UTC") ?? .gmt
        let locale = Locale(identifier: "en_US")
        /// Normalise the meridiem separator: modern ICU uses a narrow no-break space (U+202F).
        func normalized(_ value: String) -> String {
            value
                .replacingOccurrences(of: "\u{202F}", with: " ")
                .replacingOccurrences(of: "\u{00A0}", with: " ")
        }
        XCTAssertEqual(
            normalized(SmallMultiplesAxis.timeLabel(Date(timeIntervalSince1970: 0), locale: locale, timeZone: utc)),
            "12:00 AM"
        )
        XCTAssertEqual(
            normalized(SmallMultiplesAxis.timeLabel(
                Date(timeIntervalSince1970: 12 * 3600),
                locale: locale,
                timeZone: utc
            )),
            "12:00 PM"
        )
    }

    func testNumberLabelAbbreviates() {
        XCTAssertEqual(SmallMultiplesAxis.numberLabel(42), "42")
        XCTAssertEqual(SmallMultiplesAxis.numberLabel(1500), "1.5k")
        XCTAssertEqual(SmallMultiplesAxis.numberLabel(2_000_000), "2.0M")
        XCTAssertEqual(SmallMultiplesAxis.numberLabel(0.5), "0.50")
        XCTAssertEqual(SmallMultiplesAxis.numberLabel(.nan), "—")
        XCTAssertEqual(SmallMultiplesAxis.numberLabel(.infinity), "—")
    }
}

// MARK: - Accessibility (cell label + value + hint)

final class SmallMultiplesAccessibilityTests: XCTestCase {
    func testCellLabelIsTheName() {
        XCTAssertEqual(SmallMultiplesAccessibility.cellLabel(name: "Battery"), "Battery")
    }

    func testSummaryLabelComposesTemplate() {
        XCTAssertEqual(
            SmallMultiplesAccessibility.summaryLabel(
                template: "Latest %1$@, low %2$@, high %3$@",
                latest: "42",
                minimum: "10",
                maximum: "50"
            ),
            "Latest 42, low 10, high 50"
        )
    }

    func testCellValueUsesNoDataWhenEmpty() {
        XCTAssertEqual(
            SmallMultiplesAccessibility.cellValue(hasData: false, noData: "No data", summary: "Latest 1"),
            "No data"
        )
    }

    func testCellValueUsesSummaryWhenPopulated() {
        XCTAssertEqual(
            SmallMultiplesAccessibility.cellValue(
                hasData: true,
                noData: "No data",
                summary: "Latest 42, low 10, high 50"
            ),
            "Latest 42, low 10, high 50"
        )
    }

    func testCellHintOnlyWhenInteractive() {
        XCTAssertEqual(
            SmallMultiplesAccessibility.cellHint(isInteractive: true, openHint: "Open"),
            "Open"
        )
        XCTAssertNil(SmallMultiplesAccessibility.cellHint(isInteractive: false, openHint: "Open"))
    }
}

// MARK: - Input / meta

final class SmallMultiplesInputTests: XCTestCase {
    func testInteractivityFlag() {
        XCTAssertTrue(SmallMultiplesInteractivity.interactive.isInteractive)
        XCTAssertFalse(SmallMultiplesInteractivity.passive.isInteractive)
    }

    func testInputDefaultsMatchWeb() {
        let input = SmallMultiplesInput()
        XCTAssertEqual(input.availability, .loading)
        XCTAssertEqual(input.connection, .live)
        XCTAssertEqual(input.interactivity, .interactive)
        XCTAssertEqual(input.emptyBehavior, .emptyState)
        XCTAssertEqual(input.maxPointsPerCell, 400, "web maxPointsPerCell default")
        XCTAssertEqual(input.cellHeight, 120, "web cellHeight default")
        XCTAssertEqual(input.cellMinWidth, 280, "web cellMinWidth default")
        XCTAssertNil(input.columns)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SmallMultiplesMeta.surfaceSlug, "SmallMultiplesChart")
        XCTAssertEqual(SmallMultiplesChart.surfaceSlug, "SmallMultiplesChart")
    }
}
