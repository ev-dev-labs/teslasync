//
//  ThemePicker.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the `#RRGGBB` hex parser
//  (web `hexToRGB`), the projection (the "cached selection → view-ready projection" derivation the
//  acceptance calls for — across the showMode / showCustom / custom-active / selected branches), the
//  layout (web `compact`), the lucide→SF-Symbol icon map, the catalog integrity (the ThemeProvider.tsx
//  parity), and value-type equality. Split from ThemePicker.Tests.swift (the SwiftUI / state-holder
//  half) to keep each file inside the SwiftLint length budget. These run in the TeslaSync(/-macOS)
//  XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ThemePickerSurfaceTests: XCTestCase {
    func testSlugIsStable() {
        XCTAssertEqual(ThemePickerSurface.slug, "ThemePicker")
        XCTAssertEqual(ThemePickerProjector.customThemeID, "custom")
    }
}

// MARK: - RGB hex parser (web `hexToRGB`)

final class ThemePickerRGBTests: XCTestCase {
    func testParsesSixDigitWithHash() throws {
        let rgb = try XCTUnwrap(ThemePickerRGB.parse(hex: "#00b4d8"))
        XCTAssertEqual(rgb.red, 0, accuracy: 0.001)
        XCTAssertEqual(rgb.green, Double(0xB4) / 255, accuracy: 0.001)
        XCTAssertEqual(rgb.blue, Double(0xD8) / 255, accuracy: 0.001)
    }

    func testParsesWithoutHash() {
        XCTAssertNotNil(ThemePickerRGB.parse(hex: "ffffff"))
    }

    func testRejectsMalformed() {
        XCTAssertNil(ThemePickerRGB.parse(hex: "#fff"))
        XCTAssertNil(ThemePickerRGB.parse(hex: "zzzzzz"))
        XCTAssertNil(ThemePickerRGB.parse(hex: ""))
        XCTAssertNil(ThemePickerRGB.parse(hex: "#1234567"))
    }

    func testRGBStringMatchesWeb() {
        // web hexToRGB('#00b4d8') => '0, 180, 216'
        XCTAssertEqual(ThemePickerRGB.parse(hex: "#00b4d8")?.rgbString, "0, 180, 216")
        XCTAssertEqual(ThemePickerRGB.parse(hex: "#e63946")?.rgbString, "230, 57, 70")
    }

    func testHexStringUppercaseRoundTrip() {
        XCTAssertEqual(ThemePickerRGB.parse(hex: "#00b4d8")?.hexString, "#00B4D8")
    }
}

// MARK: - Projector (state → projection)

final class ThemePickerProjectorTests: XCTestCase {
    private let resolve: ThemePickerResolve = { _, fallback in fallback }

    private func makeState(
        theme: String = "neon-cyan",
        mode: String = "dark",
        primary: String = "#00b4d8",
        accent: String = "#e63946"
    ) -> ThemePickerState {
        ThemePickerState(
            selectedThemeID: theme,
            selectedModeID: mode,
            customPrimaryHex: primary,
            customAccentHex: accent
        )
    }

    private func project(
        _ input: ThemePickerInput,
        _ state: ThemePickerState,
        themes: [ThemePickerColorTheme] = ThemePickerCatalog.themes,
        modes: [ThemePickerModeTheme] = ThemePickerCatalog.modes
    ) -> ThemePickerProjection {
        ThemePickerProjector.resolve(themes: themes, modes: modes, state: state, input: input, resolve: resolve)
    }

    func testFullProjection() {
        let projection = project(ThemePickerInput(), makeState())
        XCTAssertEqual(projection.modeSectionTitle, "Display Mode")
        XCTAssertTrue(projection.showsModeSection)
        XCTAssertEqual(projection.modeOptions.count, 7)
        XCTAssertEqual(projection.accentSectionTitle, "Accent Color")
        XCTAssertEqual(projection.themeOptions.count, 5, "the Custom entry is split out of the preset grid")
        XCTAssertNotNil(projection.customOption)
        XCTAssertNil(projection.customBuilder, "builder hidden while a preset is active")
        XCTAssertFalse(projection.isEmpty)
    }

    func testShowModeFalseHidesModeSection() {
        let projection = project(ThemePickerInput(showMode: false), makeState())
        XCTAssertNil(projection.modeSectionTitle)
        XCTAssertFalse(projection.showsModeSection)
        XCTAssertTrue(projection.modeOptions.isEmpty)
    }

    func testShowCustomFalseHidesCustomOptionAndBuilder() {
        let projection = project(ThemePickerInput(showCustom: false), makeState(theme: "custom"))
        XCTAssertNil(projection.customOption)
        XCTAssertNil(projection.customBuilder)
        XCTAssertFalse(projection.showsCustomOption)
    }

    func testCustomActiveRevealsBuilderWithLiveColors() {
        let state = makeState(theme: "custom", primary: "#112233", accent: "#445566")
        let projection = project(ThemePickerInput(), state)
        let builder = try? XCTUnwrap(projection.customBuilder)
        XCTAssertEqual(builder?.primaryHex, "#112233")
        XCTAssertEqual(builder?.accentHex, "#445566")
        XCTAssertEqual(builder?.primaryLabel, "Primary")
        XCTAssertEqual(builder?.accentLabel, "Accent")
        let custom = projection.customOption
        XCTAssertEqual(custom?.gradientStartHex, "#112233", "Custom swatch tracks the live custom colours")
        XCTAssertEqual(custom?.isSelected, true)
        XCTAssertEqual(custom?.isCustom, true)
    }

    func testSelectionFlagsTrackState() {
        let projection = project(ThemePickerInput(), makeState(theme: "matrix-green", mode: "oled"))
        XCTAssertEqual(projection.themeOptions.first { $0.id == "matrix-green" }?.isSelected, true)
        XCTAssertEqual(projection.themeOptions.first { $0.id == "neon-cyan" }?.isSelected, false)
        XCTAssertEqual(projection.modeOptions.first { $0.id == "oled" }?.isSelected, true)
        XCTAssertEqual(projection.modeOptions.first { $0.id == "dark" }?.isSelected, false)
    }

    func testPresetGradientFromCatalogNotState() {
        let projection = project(ThemePickerInput(), makeState(primary: "#000000", accent: "#000000"))
        let cyan = projection.themeOptions.first { $0.id == "neon-cyan" }
        XCTAssertEqual(cyan?.gradientStartHex, "#00f0ff")
        XCTAssertEqual(cyan?.gradientEndHex, "#4f46e5")
        XCTAssertEqual(cyan?.isCustom, false)
    }

    func testModeOptionCarriesIconChromeAndSwatches() {
        let projection = project(ThemePickerInput(), makeState())
        let dark = projection.modeOptions.first { $0.id == "dark" }
        XCTAssertEqual(dark?.iconSystemName, "moon")
        XCTAssertEqual(dark?.swatchHexes, ["#0a0a0f", "#0f1019", "#151621", "#1a1b2e"])
        XCTAssertEqual(dark?.iconBackgroundHex, "#1a1b2e")
        XCTAssertEqual(dark?.iconBorderHex, "#FFFFFF14")
        XCTAssertEqual(dark?.iconForegroundHex, "#ffffff")
    }

    func testEmptyWhenNoThemesNoModesNoCustom() {
        let projection = project(
            ThemePickerInput(showMode: false, showCustom: false),
            makeState(),
            themes: [],
            modes: []
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.themeOptions.isEmpty)
        XCTAssertNil(projection.customOption)
    }

    func testNotEmptyWhenOnlyCustomRemains() {
        let projection = project(ThemePickerInput(showMode: false), makeState(), themes: [], modes: [])
        XCTAssertFalse(projection.isEmpty, "the Custom swatch alone is still actionable content")
        XCTAssertNotNil(projection.customOption)
    }
}

// MARK: - Layout (web `compact`)

final class ThemePickerLayoutTests: XCTestCase {
    func testCompactIsDenserThanFull() {
        let compact = ThemePickerProjector.layout(compact: true)
        let full = ThemePickerProjector.layout(compact: false)
        XCTAssertLessThan(compact.sectionSpacing, full.sectionSpacing)
        XCTAssertLessThan(compact.modeMinItemWidth, full.modeMinItemWidth)
        XCTAssertLessThan(compact.themeMinItemWidth, full.themeMinItemWidth)
        XCTAssertEqual(compact.gridSpacing, full.gridSpacing, accuracy: 0.001)
    }
}

// MARK: - Icon map (web `modeIcons`)

final class ThemePickerIconTests: XCTestCase {
    func testKnownModeIcons() {
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "dark"), "moon")
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "light"), "sun.max")
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "sunset"), "sun.max")
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "oled"), "display")
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "auto"), "display")
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "midnight"), "sparkles")
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "nord"), "sparkles")
    }

    func testUnknownModeFallsBack() {
        XCTAssertEqual(ThemePickerProjector.modeIconSystemName(for: "zzz"), "circle.lefthalf.filled")
    }
}

// MARK: - Catalog (ThemeProvider.tsx parity)

final class ThemePickerCatalogTests: XCTestCase {
    func testThemeCatalogShape() {
        XCTAssertEqual(ThemePickerCatalog.themes.count, 6)
        XCTAssertEqual(ThemePickerCatalog.themes.last?.id, ThemePickerProjector.customThemeID)
        let presets = ThemePickerCatalog.themes.filter { $0.id != ThemePickerProjector.customThemeID }
        XCTAssertEqual(presets.count, 5)
        XCTAssertEqual(Set(ThemePickerCatalog.themes.map(\.id)).count, 6, "ids unique")
        for theme in presets {
            XCTAssertNotNil(ThemePickerRGB.parse(hex: theme.primaryHex), "\(theme.id) primary")
            XCTAssertNotNil(ThemePickerRGB.parse(hex: theme.accentHex), "\(theme.id) accent")
        }
    }

    func testModeCatalogShape() {
        XCTAssertEqual(ThemePickerCatalog.modes.count, 7)
        XCTAssertEqual(Set(ThemePickerCatalog.modes.map(\.id)).count, 7, "ids unique")
        XCTAssertEqual(ThemePickerCatalog.modes.first { $0.id == "light" }?.colorScheme, .light)
        XCTAssertEqual(ThemePickerCatalog.modes.first { $0.id == "dark" }?.colorScheme, .dark)
        for mode in ThemePickerCatalog.modes {
            XCTAssertEqual(mode.swatchHexes.count, 4)
            for swatch in mode.swatchHexes {
                XCTAssertNotNil(ThemePickerRGB.parse(hex: swatch), "\(mode.id) swatch \(swatch)")
            }
            XCTAssertTrue(mode.glassBorderHex.hasPrefix("#"))
            XCTAssertEqual(mode.glassBorderHex.count, 9, "glass border is 8-digit #RRGGBBAA")
        }
    }
}

// MARK: - Value-type equality

final class ThemePickerValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(ThemePickerInput(), ThemePickerInput(showMode: true, showCustom: true, compact: false))
        XCTAssertNotEqual(ThemePickerInput(), ThemePickerInput(compact: true))
    }

    func testProjectionEquality() {
        let resolve: ThemePickerResolve = { _, fallback in fallback }
        let state = ThemePickerState(
            selectedThemeID: "neon-cyan",
            selectedModeID: "dark",
            customPrimaryHex: "#00b4d8",
            customAccentHex: "#e63946"
        )
        let lhs = ThemePickerProjector.resolve(
            themes: ThemePickerCatalog.themes,
            modes: ThemePickerCatalog.modes,
            state: state,
            input: ThemePickerInput(),
            resolve: resolve
        )
        let rhs = ThemePickerProjector.resolve(
            themes: ThemePickerCatalog.themes,
            modes: ThemePickerCatalog.modes,
            state: state,
            input: ThemePickerInput(),
            resolve: resolve
        )
        XCTAssertEqual(lhs, rhs)
    }
}
