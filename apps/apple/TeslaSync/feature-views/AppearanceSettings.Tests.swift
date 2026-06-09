//
//  AppearanceSettings.Tests.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  Unit coverage for the AppearanceSettings adapter + i18n facade:
//    • Render phase (cache-then-network) + freshness precedence (ADR-013).
//    • The relative-time chip buckets.
//    • The option catalogs (density / time format / sidebar / chart palette / theme
//      mode) — order, values, and web-parity labels.
//    • The chart-palette swatch tables (byte-identical to web `lib/colors.ts`) and
//      the accent presets.
//    • The density-preview sample rows + the VoiceOver copy.
//    • The i18n facade fallback resolution.
//
//  Host-free: every assertion is over a pure projection — no rendering, no network.
//

import XCTest
@testable import TeslaSync

final class AppearanceSettingsAdapterTests: XCTestCase {
    // MARK: Render phase (cache-then-network)

    func testResolvePhaseWithoutCache() {
        XCTAssertEqual(AppearanceSettingsAdapter.resolvePhase(settings: .loading, hasCachedPrefs: false), .loading)
        XCTAssertEqual(AppearanceSettingsAdapter.resolvePhase(settings: .empty, hasCachedPrefs: false), .empty)
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolvePhase(settings: .failed("boom"), hasCachedPrefs: false),
            .error("boom")
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolvePhase(settings: .loaded(.default), hasCachedPrefs: false),
            .content
        )
    }

    func testResolvePhaseKeepsCachedContentBehindTransientStates() {
        XCTAssertEqual(AppearanceSettingsAdapter.resolvePhase(settings: .loading, hasCachedPrefs: true), .content)
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolvePhase(settings: .failed("net"), hasCachedPrefs: true),
            .content
        )
    }

    // MARK: Freshness precedence

    func testResolveFreshnessPrecedence() {
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolveFreshness(connection: .offline, isFetching: true, isError: true),
            .offline
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolveFreshness(connection: .live, isFetching: true, isError: true),
            .error
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolveFreshness(connection: .live, isFetching: true, isError: false),
            .fetching
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolveFreshness(connection: .stale, isFetching: false, isError: false),
            .stale
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.resolveFreshness(connection: .live, isFetching: false, isError: false),
            .fresh
        )
    }

    // MARK: Relative time buckets

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertEqual(AppearanceSettingsAdapter.relativeTime(since: now, now: now), "just now")
        XCTAssertEqual(
            AppearanceSettingsAdapter.relativeTime(since: now.addingTimeInterval(-120), now: now),
            "2m ago"
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.relativeTime(since: now.addingTimeInterval(-7200), now: now),
            "2h ago"
        )
        XCTAssertEqual(
            AppearanceSettingsAdapter.relativeTime(since: now.addingTimeInterval(-172_800), now: now),
            "2d ago"
        )
    }

    // MARK: Option catalogs

    func testDensityChoicesOrderAndLabels() {
        let choices = AppearanceSettingsAdapter.densityChoices()
        XCTAssertEqual(choices.map(\.value), [.compact, .comfortable, .spacious])
        XCTAssertEqual(choices.map(\.label), ["Compact", "Comfortable", "Spacious"])
        XCTAssertEqual(choices[0].help, "Tight rows — fits more on screen")
    }

    func testTimeFormatChoicesParity() {
        let choices = AppearanceSettingsAdapter.timeFormatChoices()
        XCTAssertEqual(choices.map(\.value), [.relative, .absolute])
        XCTAssertEqual(choices.map(\.label), ["Relative (2h ago)", "Absolute (Nov 12, 13:42)"])
    }

    func testSidebarChoicesParity() {
        let choices = AppearanceSettingsAdapter.sidebarChoices()
        XCTAssertEqual(choices.map(\.value), [.linear, .notion, .legacy])
        // Web labels: linear=Minimal, notion=Compact, legacy=Classic.
        XCTAssertEqual(choices.map(\.label), ["Minimal", "Compact", "Classic"])
    }

    func testThemeModeChoicesParity() {
        let choices = AppearanceSettingsAdapter.themeModeChoices()
        XCTAssertEqual(choices.map(\.value), [.system, .light, .dark])
        XCTAssertEqual(choices.map(\.label), ["System", "Light", "Dark"])
    }

    // MARK: Chart palettes (web `lib/colors.ts` parity)

    func testChartPaletteChoicesAndSwatches() {
        let choices = AppearanceSettingsAdapter.chartPaletteChoices()
        XCTAssertEqual(choices.map(\.value), [.cbSafe, .neon])
        XCTAssertEqual(choices[0].label, "Color-blind safe")
        XCTAssertEqual(choices[1].label, "Stylistic neon")
        XCTAssertEqual(choices[0].swatches.count, 8)
        XCTAssertEqual(choices[0].swatches.first, "#0072B2")
        XCTAssertEqual(choices[1].swatches.first, "#00f0ff")
        XCTAssertEqual(AppearancePalette.cbSafe.last, "#4B4B4B")
        XCTAssertEqual(AppearancePalette.neon.last, "#14b8a6")
    }

    func testSwatchesForPalette() {
        XCTAssertEqual(AppearancePalette.swatches(for: .cbSafe), AppearancePalette.cbSafe)
        XCTAssertEqual(AppearancePalette.swatches(for: .neon), AppearancePalette.neon)
    }

    // MARK: Accent presets

    func testAccentPresetsDefaultAndLookup() {
        let presets = AppearanceAccent.presets()
        XCTAssertEqual(presets.count, 6)
        XCTAssertEqual(presets.first?.id, AppearanceAccent.defaultID)
        XCTAssertEqual(AppearanceAccent.defaultID, "cyan")
        XCTAssertEqual(AppearanceAccent.preset(for: "purple").hex, "#A855F7")
        // Unknown id falls back to the default brand accent.
        XCTAssertEqual(AppearanceAccent.preset(for: "does-not-exist").id, "cyan")
    }

    // MARK: Density preview rows

    func testDensityPreviewRows() {
        let rows = AppearanceSettingsAdapter.densityPreviewRows()
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[0], "Sample row — Tesla Model 3")
        XCTAssertEqual(rows[2], "Sample row — Tesla Model S")
    }

    // MARK: Accessibility copy

    func testAccessibilityCopy() {
        XCTAssertEqual(AppearanceSettingsAccessibility.freshnessLabel(.fresh), "Live")
        XCTAssertEqual(AppearanceSettingsAccessibility.freshnessLabel(.fetching), "Updating…")
        XCTAssertEqual(AppearanceSettingsAccessibility.freshnessLabel(.stale), "Stale")
        XCTAssertEqual(AppearanceSettingsAccessibility.freshnessLabel(.error), "Error")
        XCTAssertEqual(AppearanceSettingsAccessibility.freshnessLabel(.offline), "Offline")
        XCTAssertEqual(AppearanceSettingsAccessibility.toggleStateLabel(true), "On")
        XCTAssertEqual(AppearanceSettingsAccessibility.toggleStateLabel(false), "Off")
        XCTAssertEqual(AppearanceSettingsAccessibility.selectedLabel(), "Selected")
    }

    // MARK: i18n facade

    func testStringsFacadeResolvesFallback() {
        // No "AppearanceSettings" table in the test host bundle → the web English
        // fallback is returned verbatim (proves no hardcoded literals in the views).
        XCTAssertEqual(AppearanceSettingsStrings.string("theme.title", "Appearance"), "Appearance")
        XCTAssertEqual(AppearanceSettingsStrings.count("freshness.minutesAgo", "%lldm ago", 5), "5m ago")
    }
}
