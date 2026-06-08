//
//  SettingField.Tests.swift
//  TeslaSync — P4 feature view · 0213 · SettingField (Apple)
//
//  Unit coverage for the SettingField surface. `SettingField` is a pure presentational
//  wrapper (the web source fetches nothing), so the meaningful, host-free surface area is:
//    • the help adapter — the web `<HelpIcon>` content/aria resolution, including the
//      `i18nKey ? t(...) : content` ladder and the "render nothing when there is no text"
//      rule (web `if (!text) return null`);
//    • the accessibility policy — the per-field "Help for {field}" label vs. the generic
//      "More info", and the `{for}-help` describing-element id;
//    • the `view.opened` telemetry slug (P1/S11).
//  String resolution is injected so every branch asserts deterministically with no bundle
//  and no rendering host.
//
//  These compile in the TeslaSync(/-macOS) app targets alongside the surface (the
//  per-surface test convention). They have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Helpers

/// A chrome resolver that returns the English fallback verbatim, so the accessibility
/// wording is asserted without a loaded catalog.
private let echoChrome: @Sendable (String, String) -> String = { _, fallback in fallback }

/// A translate resolver that returns the fallback verbatim (web key missing → defaultValue).
private let echoTranslate: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Help projection: render branches (web <HelpIcon> text ladder)

@MainActor
final class SettingFieldHelpProjectionTests: XCTestCase {
    func testNilHelpDoesNotRender() {
        let projection = SettingFieldHelpResolver.resolve(nil, translate: echoTranslate, chrome: echoChrome)
        XCTAssertFalse(projection.rendersTrigger)
        XCTAssertEqual(projection.helpText, "")
        XCTAssertEqual(projection.accessibilityLabel, "")
        XCTAssertNil(projection.describedByID)
    }

    func testPlainContentRenders() {
        let help = SettingFieldHelp(content: "Paste your API token.")
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertTrue(projection.rendersTrigger)
        XCTAssertEqual(projection.helpText, "Paste your API token.")
    }

    func testEmptyContentDoesNotRender() {
        let help = SettingFieldHelp(content: "")
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertFalse(projection.rendersTrigger)
        XCTAssertEqual(projection.helpText, "")
    }

    func testKeyedHelpUsesTranslation() {
        let help = SettingFieldHelp(i18nKey: "settings.token.help", content: "fallback")
        let translate: (String, String) -> String = { key, _ in
            key == "settings.token.help" ? "Translated help" : "wrong"
        }
        let projection = SettingFieldHelpResolver.resolve(help, translate: translate, chrome: echoChrome)
        XCTAssertTrue(projection.rendersTrigger)
        XCTAssertEqual(projection.helpText, "Translated help")
    }

    func testKeyedHelpFallsBackToContentWhenTranslationMissing() {
        // web: t(i18nKey, { defaultValue: content }) → returns the content when the key is absent.
        let help = SettingFieldHelp(i18nKey: "missing.key", content: "Fallback help")
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertTrue(projection.rendersTrigger)
        XCTAssertEqual(projection.helpText, "Fallback help")
    }

    func testKeyedHelpWithEmptyResolvedTextDoesNotRender() {
        // web: i18nKey present, content undefined, translation missing → text '' → return null.
        let help = SettingFieldHelp(i18nKey: "missing.key", content: nil)
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertFalse(projection.rendersTrigger)
        XCTAssertEqual(projection.helpText, "")
    }

    func testEmptyKeyTreatedAsAbsentKey() {
        // An empty i18nKey is falsy on the web → fall through to `content`.
        let help = SettingFieldHelp(i18nKey: "", content: "Direct content")
        let translate: (String, String) -> String = { _, _ in "should-not-be-used" }
        let projection = SettingFieldHelpResolver.resolve(help, translate: translate, chrome: echoChrome)
        XCTAssertEqual(projection.helpText, "Direct content")
    }
}

// MARK: - Accessibility policy (web aria-label / aria-describedby)

@MainActor
final class SettingFieldAccessibilityTests: XCTestCase {
    func testFieldIDProducesPerFieldLabelAndDescribedBy() {
        let help = SettingFieldHelp(content: "Help text", fieldID: "display_name")
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertEqual(projection.accessibilityLabel, "Help for display_name")
        XCTAssertEqual(projection.describedByID, "display_name-help")
    }

    func testMissingFieldIDProducesGenericLabelAndNoDescribedBy() {
        let help = SettingFieldHelp(content: "Help text")
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertEqual(projection.accessibilityLabel, "More info")
        XCTAssertNil(projection.describedByID)
    }

    func testEmptyFieldIDIsTreatedAsMissing() {
        let help = SettingFieldHelp(content: "Help text", fieldID: "")
        let projection = SettingFieldHelpResolver.resolve(help, translate: echoTranslate, chrome: echoChrome)
        XCTAssertEqual(projection.accessibilityLabel, "More info")
        XCTAssertNil(projection.describedByID)
    }

    func testChromeKeysAreRoutedThroughTheFacade() {
        // Assert the resolver asks for the exact keys the web HelpIcon uses.
        var requestedKeys: [String] = []
        let chrome: (String, String) -> String = { key, fallback in
            requestedKeys.append(key)
            return fallback
        }
        _ = SettingFieldHelpResolver.resolve(
            SettingFieldHelp(content: "Help", fieldID: "vin"), translate: echoTranslate, chrome: chrome
        )
        XCTAssertEqual(requestedKeys, ["a11y.helpFor"])

        requestedKeys.removeAll()
        _ = SettingFieldHelpResolver.resolve(
            SettingFieldHelp(content: "Help"), translate: echoTranslate, chrome: chrome
        )
        XCTAssertEqual(requestedKeys, ["help.tooltip.iconLabel"])
    }
}

// MARK: - Surface identity + telemetry (P1/S11 view.opened)

@MainActor
final class SettingFieldSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SettingFieldSurface.slug, "SettingField")
    }

    func testViewSurfaceSlugMatchesSurface() {
        XCTAssertEqual(SettingField<EmptyView>.surfaceSlug, SettingFieldSurface.slug)
    }

    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpySettingFieldTelemetry()
        SettingFieldSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["SettingField"])
    }

    func testReportOpenIsTheExactSlugContract() {
        let spy = SpySettingFieldTelemetry()
        SettingFieldSurface.reportOpen(to: spy)
        SettingFieldSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["SettingField", "SettingField"])
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class SpySettingFieldTelemetry: SettingFieldTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
