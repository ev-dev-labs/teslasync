//
//  ByteSizeConverter.Tests.swift
//  TeslaSync — P4 feature view · 0012 · ByteSizeConverter (Apple)
//
//  Unit coverage for the ByteSizeConverter surface:
//    • Adapter (input → projection) — JS `parseFloat` parity, the `safeNumber`
//      finite guard, the `fmtNumber` locale-grouped fixed-precision output, the
//      unit exponents, and the exact converted strings the web tool produces.
//    • State holder — phase resolution across parseable / unparseable edits, unit
//      selection (highlight moves), and the P1/S11 `view.opened` telemetry
//      (emitted once).
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets at integration. They have
//  no network and no real store — the surface is a synchronous client-side tool.
//

import XCTest
@testable import TeslaSync

// MARK: - Numeric helpers: parseFloat / safeNumber / fmtNumber parity

final class ByteSizeNumericTests: XCTestCase {
    /// Mirrors JavaScript `parseFloat(value)` including leading whitespace, sign,
    /// trailing junk, fraction/exponent forms, and the `NaN → nil` branch.
    func testParseLeadingDoubleMatchesParseFloat() {
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("1024"), 1024)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("12abc"), 12)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("  3.5 "), 3.5)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("-2"), -2)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("+4"), 4)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("1e3"), 1000)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("1.5e2"), 150)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble(".5"), 0.5)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("5."), 5)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("1e"), 1)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("1.2.3"), 1.2)
        XCTAssertEqual(ByteSizeNumeric.parseLeadingDouble("0x10"), 0)
        XCTAssertNil(ByteSizeNumeric.parseLeadingDouble(""))
        XCTAssertNil(ByteSizeNumeric.parseLeadingDouble("abc"))
        XCTAssertNil(ByteSizeNumeric.parseLeadingDouble("   "))
        XCTAssertNil(ByteSizeNumeric.parseLeadingDouble("."))
    }

    /// `parseFloat("Infinity")` is `Infinity` (not `NaN`); the value is later
    /// zeroed by `safeNumber`, exactly as the web `fmtNumber` does.
    func testParseLeadingDoubleHonoursInfinity() throws {
        let positive = try XCTUnwrap(ByteSizeNumeric.parseLeadingDouble("Infinity"))
        XCTAssertTrue(positive.isInfinite && positive > 0)
        let negative = try XCTUnwrap(ByteSizeNumeric.parseLeadingDouble("-Infinity"))
        XCTAssertTrue(negative.isInfinite && negative < 0)
    }

    /// Mirrors the web `safeNumber`: finite passes through, non-finite → 0.
    func testSafeNumberGuardsNonFinite() {
        XCTAssertEqual(ByteSizeNumeric.safeNumber(5), 5)
        XCTAssertEqual(ByteSizeNumeric.safeNumber(-3.25), -3.25)
        XCTAssertEqual(ByteSizeNumeric.safeNumber(.infinity), 0)
        XCTAssertEqual(ByteSizeNumeric.safeNumber(-.infinity), 0)
        XCTAssertEqual(ByteSizeNumeric.safeNumber(.nan), 0)
    }

    /// Pins the exact `fmtNumber(value, decimals)` strings (en-US grouping, fixed
    /// precision, half-away-from-zero rounding) the web tool emits.
    func testFormatMatchesFmtNumber() {
        XCTAssertEqual(ByteSizeNumeric.format(1_048_576, decimals: 0), "1,048,576")
        XCTAssertEqual(ByteSizeNumeric.format(1024, decimals: 4), "1,024.0000")
        XCTAssertEqual(ByteSizeNumeric.format(1, decimals: 4), "1.0000")
        XCTAssertEqual(ByteSizeNumeric.format(0.0009765625, decimals: 4), "0.0010")
        XCTAssertEqual(ByteSizeNumeric.format(0.001953125, decimals: 4), "0.0020")
        XCTAssertEqual(ByteSizeNumeric.format(9.5367431640625e-7, decimals: 4), "0.0000")
        XCTAssertEqual(ByteSizeNumeric.format(.infinity, decimals: 4), "0.0000")
        XCTAssertEqual(ByteSizeNumeric.format(2048, decimals: 0), "2,048")
    }
}

// MARK: - Units (web `BYTE_UNITS`)

final class ByteSizeUnitTests: XCTestCase {
    /// Pins the unit order + symbols against the web `BYTE_UNITS` array.
    func testUnitsMatchWebConstant() {
        XCTAssertEqual(ByteSizeUnit.allCases.map(\.symbol), ["B", "KB", "MB", "GB", "TB"])
    }

    /// Each unit's exponent is its index in `BYTE_UNITS` (the `Math.pow(1024, i)`
    /// power), so the conversion arithmetic matches the web.
    func testUnitExponentsAreOneKibibyteApart() {
        XCTAssertEqual(ByteSizeUnit.bytes.exponent, 0)
        XCTAssertEqual(ByteSizeUnit.kilobytes.exponent, 1)
        XCTAssertEqual(ByteSizeUnit.megabytes.exponent, 2)
        XCTAssertEqual(ByteSizeUnit.gigabytes.exponent, 3)
        XCTAssertEqual(ByteSizeUnit.terabytes.exponent, 4)
    }
}

// MARK: - Projector: value + unit → conversions (port parity with the web tool)

final class ByteSizeProjectorTests: XCTestCase {
    /// 1024 KB → the full five-cell breakdown the web grid renders, with the
    /// selected unit flagged.
    func testProjectKilobytesKnownValues() throws {
        let projection = try XCTUnwrap(ByteSizeProjector.project(value: "1024", unit: .kilobytes))
        XCTAssertEqual(projection.selected, .kilobytes)
        XCTAssertEqual(projection.conversions.map(\.value), [
            "1,048,576", "1,024.0000", "1.0000", "0.0010", "0.0000"
        ])
        XCTAssertEqual(projection.conversions.map(\.unit), ByteSizeUnit.allCases)
        let selected = projection.conversions.filter(\.isSelected)
        XCTAssertEqual(selected.count, 1)
        XCTAssertEqual(selected.first?.unit, .kilobytes)
    }

    /// 1 B → the B cell renders an integer (0 decimals) and the rest 4 decimals.
    func testProjectBytesUsesZeroDecimalsForBytesCell() throws {
        let projection = try XCTUnwrap(ByteSizeProjector.project(value: "1", unit: .bytes))
        XCTAssertEqual(projection.conversions[0].unit, .bytes)
        XCTAssertEqual(projection.conversions[0].value, "1")
        XCTAssertEqual(projection.conversions[1].value, "0.0010")
        XCTAssertEqual(projection.conversions[2].value, "0.0000")
    }

    /// 2048 B → KB is exactly 2; MB rounds to 0.0020 (half-away-from-zero).
    func testProjectBytesRounding() throws {
        let projection = try XCTUnwrap(ByteSizeProjector.project(value: "2048", unit: .bytes))
        XCTAssertEqual(projection.conversions[0].value, "2,048")
        XCTAssertEqual(projection.conversions[1].value, "2.0000")
        XCTAssertEqual(projection.conversions[2].value, "0.0020")
    }

    /// Unparseable input yields `nil` (web `conversions === null` → grid hidden).
    func testProjectUnparseableReturnsNil() {
        XCTAssertNil(ByteSizeProjector.project(value: "", unit: .bytes))
        XCTAssertNil(ByteSizeProjector.project(value: "abc", unit: .megabytes))
        XCTAssertNil(ByteSizeProjector.project(value: "   ", unit: .gigabytes))
    }

    /// A trailing-junk value parses its leading number (parseFloat parity) and
    /// still projects.
    func testProjectTrailingJunkParsesLeadingNumber() throws {
        let projection = try XCTUnwrap(ByteSizeProjector.project(value: "12px", unit: .bytes))
        XCTAssertEqual(projection.conversions[0].value, "12")
    }
}

// MARK: - State holder: phases + unit selection + telemetry

@MainActor final class ByteSizeConverterModelTests: XCTestCase {
    func testInitialPhaseEmptyForBlankValue() {
        let model = ByteSizeConverterModel()
        XCTAssertEqual(model.value, "")
        XCTAssertEqual(model.unit, .bytes)
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testParseableValueYieldsContentPhase() {
        let model = ByteSizeConverterModel(value: "1024", unit: .kilobytes)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.conversions.first?.value, "1,048,576")
    }

    func testEditingValueRecomputesProjection() {
        let model = ByteSizeConverterModel(value: "", unit: .bytes)
        XCTAssertEqual(model.phase, .empty)
        model.value = "2048"
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.conversions[1].value, "2.0000")
        model.value = "nope"
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testSelectUnitMovesHighlightAndRecomputes() {
        let model = ByteSizeConverterModel(value: "1", unit: .bytes)
        XCTAssertEqual(model.projection?.selected, .bytes)
        model.select(unit: .megabytes)
        XCTAssertEqual(model.unit, .megabytes)
        XCTAssertEqual(model.projection?.selected, .megabytes)
        let selected = model.projection?.conversions.filter(\.isSelected)
        XCTAssertEqual(selected?.first?.unit, .megabytes)
    }

    func testStartEmitsViewOpenedOnceWithSurfaceSlug() {
        let spy = RecordingByteSizeConverterTelemetry()
        let model = ByteSizeConverterModel(value: "1024", telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ByteSizeConverterSurface.slug])
        XCTAssertEqual(spy.surfaces, ["ByteSizeConverter"])
    }
}

// MARK: - Accessibility summary content

final class ByteSizeAccessibilityTests: XCTestCase {
    func testSummaryIncludesLeadAndEveryConvertedValue() throws {
        let projection = try XCTUnwrap(ByteSizeProjector.project(value: "1024", unit: .kilobytes))
        let summary = ByteSizeAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Byte Size"))
        XCTAssertTrue(summary.contains("1,048,576 B"))
        XCTAssertTrue(summary.contains("1,024.0000 KB"))
        XCTAssertTrue(summary.contains("1.0000 MB"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RecordingByteSizeConverterTelemetry: ByteSizeConverterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
