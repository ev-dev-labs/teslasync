//
//  ThemeProvider.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  Pure-core coverage for the theme surface (the model + projection + view-composition half lives in
//  ThemeProvider.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for, plus the verbatim-parity pins
//  against the web source:
//    • surface slug + the two id unions (raw values mirror the web string unions; counts; fallbacks).
//    • ThemeCSSColor hex / rgb / rgba parsing (+ shorthand, + malformed → nil, + 0…255 + rgbString).
//    • ThemeCatalog — every built-in colorway's `primaryRGB`/`accentRGB` equals the web precomputed
//      string (the transcription pin), the mode literals + colorScheme, and the custom builder.
//    • ThemeSelection copy-with helpers + defaults; CustomColors defaults.
//    • ThemeSelectionReducer — sanitize-on-read, the per-field `/settings` adoption (custom needs both).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no SwiftUI.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + id unions

final class ThemeProviderSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(ThemeProviderSurface.slug, "ThemeProvider")
    }

    func testColorwayRawValuesMirrorWebUnion() {
        XCTAssertEqual(ThemeColorway.neonCyan.rawValue, "neon-cyan")
        XCTAssertEqual(ThemeColorway.teslaRed.rawValue, "tesla-red")
        XCTAssertEqual(ThemeColorway.matrixGreen.rawValue, "matrix-green")
        XCTAssertEqual(ThemeColorway.royalPurple.rawValue, "royal-purple")
        XCTAssertEqual(ThemeColorway.solarAmber.rawValue, "solar-amber")
        XCTAssertEqual(ThemeColorway.custom.rawValue, "custom")
        XCTAssertEqual(ThemeColorway.allCases.count, 6)
        XCTAssertEqual(ThemeColorway.fallback, .neonCyan)
    }

    func testColorwayIdentifierAndNameKey() {
        XCTAssertEqual(ThemeColorway.neonCyan.identifier, "neonCyan")
        XCTAssertEqual(ThemeColorway.neonCyan.nameKey, "themeProvider.colorway.neonCyan")
        XCTAssertEqual(ThemeColorway.royalPurple.nameKey, "themeProvider.colorway.royalPurple")
    }

    func testModeRawValuesMirrorWebUnion() {
        XCTAssertEqual(
            ThemeMode.allCases.map(\.rawValue),
            ["dark", "light", "oled", "midnight", "auto", "sunset", "nord"]
        )
        XCTAssertEqual(ThemeMode.allCases.count, 7)
        XCTAssertEqual(ThemeMode.fallback, .dark)
        XCTAssertEqual(ThemeMode.auto.nameKey, "themeProvider.mode.auto")
    }

    func testOnlyAutoFollowsSystem() {
        XCTAssertTrue(ThemeMode.auto.followsSystem)
        for mode in ThemeMode.allCases where mode != .auto {
            XCTAssertFalse(mode.followsSystem, "\(mode) must not follow system")
        }
    }

    func testColorSchemeRawValues() {
        XCTAssertEqual(ThemeColorScheme.dark.rawValue, "dark")
        XCTAssertEqual(ThemeColorScheme.light.rawValue, "light")
    }
}

// MARK: - ThemeCSSColor parsing (web hex / rgba literals)

final class ThemeCSSColorTests: XCTestCase {
    func testHexParsesSixDigits() {
        let color = ThemeCSSColor.hex("#00f0ff")
        XCTAssertEqual(color?.red255, 0)
        XCTAssertEqual(color?.green255, 240)
        XCTAssertEqual(color?.blue255, 255)
        XCTAssertEqual(color?.opacity, 1)
        XCTAssertEqual(color?.rgbString, "0, 240, 255")
    }

    func testHexParsesShorthand() {
        let color = ThemeCSSColor.hex("#0f0")
        XCTAssertEqual(color?.red255, 0)
        XCTAssertEqual(color?.green255, 255)
        XCTAssertEqual(color?.blue255, 0)
    }

    func testHexRejectsMalformed() {
        XCTAssertNil(ThemeCSSColor.hex("00f0ff"))
        XCTAssertNil(ThemeCSSColor.hex("#zzzzzz"))
        XCTAssertNil(ThemeCSSColor.hex("#12"))
    }

    func testRGBAParsesWithAlpha() {
        let color = ThemeCSSColor.rgba("rgba(255, 255, 255, 0.04)")
        XCTAssertEqual(color?.red255, 255)
        XCTAssertEqual(color?.green255, 255)
        XCTAssertEqual(color?.blue255, 255)
        XCTAssertEqual(color?.opacity ?? 0, 0.04, accuracy: 0.0001)
    }

    func testRGBParsesWithoutAlpha() {
        let color = ThemeCSSColor.rgba("rgb(100, 150, 255)")
        XCTAssertEqual(color?.red255, 100)
        XCTAssertEqual(color?.opacity, 1)
    }

    func testParseDispatchesHexOrRGBA() {
        XCTAssertEqual(ThemeCSSColor.parse("#ffffff")?.red255, 255)
        XCTAssertEqual(ThemeCSSColor.parse("rgba(0, 0, 0, 0.5)")?.opacity ?? 0, 0.5, accuracy: 0.0001)
        XCTAssertNil(ThemeCSSColor.parse("not-a-color"))
    }
}

// MARK: - ThemeCatalog parity pins (web `themes` / `modes`)

final class ThemeCatalogTests: XCTestCase {
    /// The web precomputed `*RGB` strings each built-in colorway must reproduce verbatim.
    private struct ColorwayRGBExpectation {
        let colorway: ThemeColorway
        let primaryRGB: String
        let accentRGB: String
    }

    private let colorwayRGB: [ColorwayRGBExpectation] = [
        ColorwayRGBExpectation(colorway: .neonCyan, primaryRGB: "0, 240, 255", accentRGB: "79, 70, 229"),
        ColorwayRGBExpectation(colorway: .teslaRed, primaryRGB: "227, 25, 55", accentRGB: "255, 64, 96"),
        ColorwayRGBExpectation(colorway: .matrixGreen, primaryRGB: "0, 255, 65", accentRGB: "16, 185, 129"),
        ColorwayRGBExpectation(colorway: .royalPurple, primaryRGB: "168, 85, 247", accentRGB: "124, 58, 237"),
        ColorwayRGBExpectation(colorway: .solarAmber, primaryRGB: "245, 158, 11", accentRGB: "217, 119, 6")
    ]

    func testBuiltInColorwayRGBMatchesWeb() {
        for expected in colorwayRGB {
            let palette = ThemeCatalog.colorway(expected.colorway)
            XCTAssertEqual(palette.id, expected.colorway)
            XCTAssertEqual(palette.primaryRGB, expected.primaryRGB, "\(expected.colorway) primaryRGB")
            XCTAssertEqual(palette.accentRGB, expected.accentRGB, "\(expected.colorway) accentRGB")
        }
    }

    func testHexToRGBMatchesWebHelper() {
        XCTAssertEqual(ThemeCatalog.hexToRGB("#00f0ff"), "0, 240, 255")
        XCTAssertEqual(ThemeCatalog.hexToRGB("#e31937"), "227, 25, 55")
    }

    func testCustomColorwayUsesLivePairAndDefault() {
        let custom = ThemeCatalog.colorway(.custom, custom: .default)
        XCTAssertEqual(custom.id, .custom)
        XCTAssertEqual(custom.nameFallback, "Custom")
        XCTAssertEqual(custom.primary.source, "#00b4d8")
        XCTAssertEqual(custom.accent.source, "#e63946")

        let live = ThemeCatalog.colorway(.custom, custom: CustomColors(primary: "#112233", accent: "#445566"))
        XCTAssertEqual(live.primary.rgbString, "17, 34, 51")
        XCTAssertEqual(live.accent.rgbString, "68, 85, 102")
    }

    func testModePalettesCarryWebLiteralsAndScheme() {
        XCTAssertEqual(ThemeCatalog.mode(.dark).background.source, "#0a0a0f")
        XCTAssertEqual(ThemeCatalog.mode(.dark).colorScheme, .dark)
        XCTAssertEqual(ThemeCatalog.mode(.light).colorScheme, .light)
        XCTAssertEqual(ThemeCatalog.mode(.oled).background.source, "#000000")
        XCTAssertEqual(ThemeCatalog.mode(.nord).textPrimary.source, "#eceff4")
        XCTAssertEqual(ThemeCatalog.mode(.dark).glassBackground.opacity, 0.04, accuracy: 0.0001)
    }

    func testCatalogCounts() {
        XCTAssertEqual(ThemeCatalog.allColorways.count, 6)
        XCTAssertEqual(ThemeCatalog.allModes.count, 7)
    }
}

// MARK: - ThemeSelection + CustomColors

final class ThemeSelectionTests: XCTestCase {
    func testDefaultMirrorsWebInitialState() {
        XCTAssertEqual(ThemeSelection.default.colorway, .neonCyan)
        XCTAssertEqual(ThemeSelection.default.mode, .dark)
        XCTAssertEqual(ThemeSelection.default.customColors, .default)
    }

    func testCustomColorsDefault() {
        XCTAssertEqual(CustomColors.default.primary, "#00b4d8")
        XCTAssertEqual(CustomColors.default.accent, "#e63946")
    }

    func testCopyWithColorwayAndMode() {
        let next = ThemeSelection.default.with(colorway: .teslaRed).with(mode: .nord)
        XCTAssertEqual(next.colorway, .teslaRed)
        XCTAssertEqual(next.mode, .nord)
        XCTAssertEqual(next.customColors, .default)
    }

    func testCopyWithCustomColorsActivatesCustom() {
        let colors = CustomColors(primary: "#aaa", accent: "#bbb")
        let activated = ThemeSelection.default.with(customColors: colors, activateCustom: true)
        XCTAssertEqual(activated.colorway, .custom)
        XCTAssertEqual(activated.customColors, colors)

        let mirrored = ThemeSelection.default.with(customColors: colors, activateCustom: false)
        XCTAssertEqual(mirrored.colorway, .neonCyan, "mirroring keeps the colorway (web subscribe guard)")
        XCTAssertEqual(mirrored.customColors, colors)
    }
}

// MARK: - ThemeSelectionReducer (web sanitize + /settings adoption)

final class ThemeSelectionReducerTests: XCTestCase {
    func testSanitizeColorway() {
        XCTAssertEqual(ThemeSelectionReducer.colorway(from: "tesla-red"), .teslaRed)
        XCTAssertNil(ThemeSelectionReducer.colorway(from: "bogus"))
        XCTAssertNil(ThemeSelectionReducer.colorway(from: nil))
    }

    func testSanitizeMode() {
        XCTAssertEqual(ThemeSelectionReducer.mode(from: "midnight"), .midnight)
        XCTAssertNil(ThemeSelectionReducer.mode(from: "bogus"))
        XCTAssertNil(ThemeSelectionReducer.mode(from: nil))
    }

    func testSelectionFallsBackPerField() {
        let selection = ThemeSelectionReducer.selection(
            colorway: "bogus",
            mode: "sunset",
            customColors: .default
        )
        XCTAssertEqual(selection.colorway, .neonCyan)
        XCTAssertEqual(selection.mode, .sunset)
    }

    func testAdoptAppliesValidFields() {
        let remote = RemoteThemeSettings(
            theme: "matrix-green",
            mode: "oled",
            customPrimary: "#111111",
            customAccent: "#222222"
        )
        let next = ThemeSelectionReducer.adopt(remote, into: .default)
        XCTAssertEqual(next.colorway, .matrixGreen)
        XCTAssertEqual(next.mode, .oled)
        XCTAssertEqual(next.customColors, CustomColors(primary: "#111111", accent: "#222222"))
    }

    func testAdoptIgnoresInvalidAndPartialCustom() {
        let remote = RemoteThemeSettings(theme: "bogus", mode: nil, customPrimary: "#111111", customAccent: nil)
        let next = ThemeSelectionReducer.adopt(remote, into: .default)
        XCTAssertEqual(next.colorway, .neonCyan, "invalid theme ignored")
        XCTAssertEqual(next.mode, .dark, "absent mode ignored")
        XCTAssertEqual(next.customColors, .default, "custom needs BOTH primary and accent (web guard)")
    }
}
