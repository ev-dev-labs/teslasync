//
//  ColorConverter.Tests.swift
//  TeslaSync — P4 feature view · 0013 · ColorConverter (Apple)
//
//  Unit coverage for the ColorConverter surface:
//    • Adapter (hex → breakdown) — JS `parseInt(_, 16)` parity, the first-`#`
//      strip, the six-character guard, the `rgbToHsl` rounded HSL output, and the
//      exact `rgb()`/`hsl()` strings the web tool produces.
//    • State holder — phase resolution across parseable / unparseable edits and
//      the P1/S11 `view.opened` telemetry (emitted once).
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets at integration. They have
//  no network and no real store — the surface is a synchronous client-side tool.
//

import XCTest
@testable import TeslaSync

// MARK: - parseInt(_, 16) parity + first-# strip

final class ColorHexParserPrimitiveTests: XCTestCase {
    /// Mirrors JavaScript `parseInt(slice, 16)` including leading whitespace, an
    /// optional sign, a `0x` prefix, trailing junk, and the `NaN → nil` branch.
    func testParseRadix16MatchesParseInt() {
        XCTAssertEqual(ColorHexParser.parseRadix16("3b"), 59)
        XCTAssertEqual(ColorHexParser.parseRadix16("82"), 130)
        XCTAssertEqual(ColorHexParser.parseRadix16("f6"), 246)
        XCTAssertEqual(ColorHexParser.parseRadix16("ff"), 255)
        XCTAssertEqual(ColorHexParser.parseRadix16("FF"), 255)
        XCTAssertEqual(ColorHexParser.parseRadix16("00"), 0)
        XCTAssertEqual(ColorHexParser.parseRadix16("0a"), 10)
        XCTAssertEqual(ColorHexParser.parseRadix16("3z"), 3)
        XCTAssertEqual(ColorHexParser.parseRadix16("1g"), 1)
        XCTAssertEqual(ColorHexParser.parseRadix16(" a"), 10)
        XCTAssertEqual(ColorHexParser.parseRadix16("-f"), -15)
        XCTAssertEqual(ColorHexParser.parseRadix16("+a"), 10)
        XCTAssertNil(ColorHexParser.parseRadix16("z3"))
        XCTAssertNil(ColorHexParser.parseRadix16("zz"))
        XCTAssertNil(ColorHexParser.parseRadix16(""))
        XCTAssertNil(ColorHexParser.parseRadix16("0x"))
    }

    /// `hex.replace('#','')` removes only the first `#`, not every occurrence.
    func testStripFirstHashRemovesOnlyFirst() {
        XCTAssertEqual(ColorHexParser.stripFirstHash("#3b82f6"), "3b82f6")
        XCTAssertEqual(ColorHexParser.stripFirstHash("3b82f6"), "3b82f6")
        XCTAssertEqual(ColorHexParser.stripFirstHash("##abc"), "#abc")
        XCTAssertEqual(ColorHexParser.stripFirstHash("ab#cd"), "abcd")
    }
}

// MARK: - rgbToHsl parity (web helpers.ts)

final class ColorRgbToHslTests: XCTestCase {
    /// Pins the rounded HSL output against known web `rgbToHsl` results.
    func testRgbToHslKnownValues() {
        XCTAssertEqual(
            ColorHexParser.rgbToHsl(red: 59, green: 130, blue: 246),
            ColorHSL(hue: 217, saturation: 91, lightness: 60)
        )
        XCTAssertEqual(
            ColorHexParser.rgbToHsl(red: 16, green: 185, blue: 129),
            ColorHSL(hue: 160, saturation: 84, lightness: 39)
        )
        XCTAssertEqual(
            ColorHexParser.rgbToHsl(red: 255, green: 0, blue: 0),
            ColorHSL(hue: 0, saturation: 100, lightness: 50)
        )
        XCTAssertEqual(
            ColorHexParser.rgbToHsl(red: 255, green: 255, blue: 255),
            ColorHSL(hue: 0, saturation: 0, lightness: 100)
        )
        XCTAssertEqual(
            ColorHexParser.rgbToHsl(red: 0, green: 0, blue: 0),
            ColorHSL(hue: 0, saturation: 0, lightness: 0)
        )
    }
}

// MARK: - Full parse: hex → breakdown (web `parsed` memo)

final class ColorHexParseTests: XCTestCase {
    /// `#3b82f6` decodes to the full web breakdown (RGB + rounded HSL).
    func testParseDefaultBlue() throws {
        let breakdown = try XCTUnwrap(ColorHexParser.parse(hex: "#3b82f6"))
        XCTAssertEqual(breakdown.red, 59)
        XCTAssertEqual(breakdown.green, 130)
        XCTAssertEqual(breakdown.blue, 246)
        XCTAssertEqual(breakdown.hue, 217)
        XCTAssertEqual(breakdown.saturation, 91)
        XCTAssertEqual(breakdown.lightness, 60)
    }

    /// A bare six-digit hex (no `#`) parses identically — `replace('#','')` is a
    /// no-op when there is no hash.
    func testParseWithoutHash() throws {
        let breakdown = try XCTUnwrap(ColorHexParser.parse(hex: "3b82f6"))
        XCTAssertEqual(breakdown.red, 59)
        XCTAssertEqual(breakdown.blue, 246)
    }

    /// Anything that is not exactly six characters (after stripping one `#`) or
    /// has a non-hex channel yields `nil` — the web `parsed === null` branch.
    func testParseInvalidYieldsNil() {
        XCTAssertNil(ColorHexParser.parse(hex: "#fff"))
        XCTAssertNil(ColorHexParser.parse(hex: "#3b82f"))
        XCTAssertNil(ColorHexParser.parse(hex: "##3b82f6"))
        XCTAssertNil(ColorHexParser.parse(hex: "#zzzzzz"))
        XCTAssertNil(ColorHexParser.parse(hex: ""))
    }
}

// MARK: - Projector: hex → result cards

final class ColorConverterProjectorTests: XCTestCase {
    /// The three result cards mirror the web `rgb(...)`, `hsl(...)`, and raw-hex
    /// strings, in order.
    func testProjectBuildsRgbHslHexChannels() throws {
        let projection = try XCTUnwrap(ColorConverterProjector.project(hex: "#3b82f6"))
        XCTAssertEqual(projection.channels.map(\.kind), [.rgb, .hsl, .hex])
        XCTAssertEqual(projection.channels[0].value, "rgb(59, 130, 246)")
        XCTAssertEqual(projection.channels[1].value, "hsl(217, 91%, 60%)")
        XCTAssertEqual(projection.channels[2].value, "#3b82f6")
    }

    /// The HEX card echoes the raw input verbatim (web shows the unmodified `hex`).
    func testProjectHexCardEchoesRawInput() throws {
        let projection = try XCTUnwrap(ColorConverterProjector.project(hex: "3B82F6"))
        XCTAssertEqual(projection.channels[2].value, "3B82F6")
    }

    /// An unparseable hex projects to `nil` (web grid hidden).
    func testProjectUnparseableReturnsNil() {
        XCTAssertNil(ColorConverterProjector.project(hex: "nope"))
        XCTAssertNil(ColorConverterProjector.project(hex: "#12"))
    }
}

// MARK: - State holder: phases + telemetry

@MainActor
final class ColorConverterModelTests: XCTestCase {
    func testDefaultHexYieldsContentPhase() {
        let model = ColorConverterModel()
        XCTAssertEqual(model.hex, "#3b82f6")
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.channels.first?.value, "rgb(59, 130, 246)")
    }

    func testEditingHexRecomputesProjection() {
        let model = ColorConverterModel(hex: "#3b82f6")
        XCTAssertEqual(model.phase, .content)
        model.hex = "#fff"
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
        model.hex = "#ffffff"
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.channels[1].value, "hsl(0, 0%, 100%)")
    }

    func testStartEmitsViewOpenedOnceWithSurfaceSlug() {
        let spy = RecordingColorConverterTelemetry()
        let model = ColorConverterModel(hex: "#3b82f6", telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ColorConverterSurface.slug])
        XCTAssertEqual(spy.surfaces, ["ColorConverter"])
    }
}

// MARK: - Accessibility summary content

final class ColorConverterAccessibilityTests: XCTestCase {
    func testSummaryIncludesLeadAndEveryChannel() throws {
        let projection = try XCTUnwrap(ColorConverterProjector.project(hex: "#3b82f6"))
        let summary = ColorConverterAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Color Converter"))
        XCTAssertTrue(summary.contains("RGB rgb(59, 130, 246)"))
        XCTAssertTrue(summary.contains("HSL hsl(217, 91%, 60%)"))
        XCTAssertTrue(summary.contains("HEX #3b82f6"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RecordingColorConverterTelemetry: ColorConverterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
