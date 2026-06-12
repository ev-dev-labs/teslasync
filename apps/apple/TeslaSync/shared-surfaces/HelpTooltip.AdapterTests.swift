//
//  HelpTooltip.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the value types
//  (``HelpTooltipPlacement`` web-side mapping, ``HelpTooltipSize`` glyph dimensions, ``HelpTooltipLearnMore``
//  URL parsing, ``HelpTooltipContent``), the layout metrics, and the ``HelpTooltipProjector`` — the verbatim
//  port of the component's content-resolution rule (`resolved = i18nKey ? t(i18nKey,{defaultValue}) : text ??
//  ''`; `if (!resolved) return null`). Split from HelpTooltip.Tests.swift (the SwiftUI / state-holder half)
//  to keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest
//  targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class HelpTooltipAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(HelpTooltipSurface.slug, "HelpTooltip")
    }
}

// MARK: - Value types

final class HelpTooltipValueTypeTests: XCTestCase {
    func testSizeGlyphSidesMatchWebSizeClass() {
        XCTAssertEqual(HelpTooltipSize.xs.baseGlyphSide, 12)
        XCTAssertEqual(HelpTooltipSize.sm.baseGlyphSide, 14)
        XCTAssertEqual(HelpTooltipSize.md.baseGlyphSide, 16)
        XCTAssertEqual(HelpTooltipSize.webDefault, .sm)
    }

    func testPlacementWebSideMapping() {
        XCTAssertEqual(HelpTooltipPlacement(webSide: "top"), .top)
        XCTAssertEqual(HelpTooltipPlacement(webSide: "bottom"), .bottom)
        XCTAssertEqual(HelpTooltipPlacement(webSide: "left"), .leading)
        XCTAssertEqual(HelpTooltipPlacement(webSide: "right"), .trailing)
        XCTAssertEqual(HelpTooltipPlacement(webSide: "unknown"), .top, "unknown falls back to the web default")
        XCTAssertEqual(HelpTooltipPlacement.webDefault, .top)
    }

    func testLearnMoreResolvesValidURL() {
        let learn = HelpTooltipLearnMore(url: "https://teslasync.io/docs/vampire-drain")
        XCTAssertEqual(learn.resolvedURL?.absoluteString, "https://teslasync.io/docs/vampire-drain")
        XCTAssertNil(learn.label)
    }

    func testLearnMoreEmptyOrWhitespaceURLResolvesNil() {
        XCTAssertNil(HelpTooltipLearnMore(url: "").resolvedURL)
        XCTAssertNil(HelpTooltipLearnMore(url: "   ").resolvedURL)
    }

    func testLearnMoreTrimsSurroundingWhitespace() {
        let learn = HelpTooltipLearnMore(url: "  https://teslasync.io  ", label: "Read the guide")
        XCTAssertEqual(learn.resolvedURL?.absoluteString, "https://teslasync.io")
        XCTAssertEqual(learn.label, "Read the guide")
    }

    func testContentEquatable() {
        let lhs = HelpTooltipContent(text: "A", learnMore: HelpTooltipLearnMore(url: "https://x.io"))
        let rhs = HelpTooltipContent(text: "A", learnMore: HelpTooltipLearnMore(url: "https://x.io"))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, HelpTooltipContent(text: "B"))
    }
}

// MARK: - Layout metrics

final class HelpTooltipLayoutTests: XCTestCase {
    func testMetricsAreSane() {
        XCTAssertGreaterThan(HelpTooltipLayout.bodyMaxWidth, 0)
        XCTAssertGreaterThan(HelpTooltipLayout.popoverPadding, 0)
        XCTAssertEqual(HelpTooltipLayout.externalGlyphSide, 12, "web ExternalLink h-3 w-3")
        XCTAssertGreaterThanOrEqual(HelpTooltipLayout.learnMoreTopSpacing, 0)
    }
}

// MARK: - Projector: content resolution (web `resolved` / `return null`)

final class HelpTooltipProjectorTests: XCTestCase {
    /// A resolver that knows one key and otherwise echoes the fallback — the native shape of i18next `t`.
    private let resolver: HelpTooltipResolve = { key, fallback in
        key == "drain.help" ? "Energy lost while parked." : fallback
    }

    func testResolvesPlainText() {
        XCTAssertEqual(
            HelpTooltipProjector.resolve(text: "Hello", i18nKey: nil, defaultValue: nil, using: resolver),
            "Hello"
        )
    }

    func testNilWhenNoTextOrKey() {
        XCTAssertNil(HelpTooltipProjector.resolve(text: nil, i18nKey: nil, defaultValue: nil, using: resolver))
    }

    func testNilWhenEmptyText() {
        XCTAssertNil(HelpTooltipProjector.resolve(text: "", i18nKey: nil, defaultValue: nil, using: resolver))
    }

    func testI18nKeyTakesPrecedenceOverText() {
        let resolved = HelpTooltipProjector.resolve(
            text: "ignored",
            i18nKey: "drain.help",
            defaultValue: "fallback",
            using: resolver
        )
        XCTAssertEqual(resolved, "Energy lost while parked.", "when i18nKey is set, text is ignored")
    }

    func testMissingKeyUsesDefaultValue() {
        let resolved = HelpTooltipProjector.resolve(
            text: nil,
            i18nKey: "missing.key",
            defaultValue: "Fallback copy",
            using: resolver
        )
        XCTAssertEqual(resolved, "Fallback copy")
    }

    func testMissingKeyWithoutDefaultResolvesNil() {
        XCTAssertNil(
            HelpTooltipProjector.resolve(text: nil, i18nKey: "missing.key", defaultValue: nil, using: resolver),
            "an empty resolution is the web `!resolved` -> return null"
        )
        XCTAssertNil(
            HelpTooltipProjector.resolve(text: nil, i18nKey: "missing.key", defaultValue: "", using: resolver)
        )
    }

    func testContentNilWhenUnresolved() {
        XCTAssertNil(
            HelpTooltipProjector.content(
                text: nil,
                i18nKey: nil,
                defaultValue: nil,
                learnMore: HelpTooltipLearnMore(url: "https://x.io"),
                using: resolver
            ),
            "no resolved copy -> no content (web return null), even with a learnMore prop"
        )
    }

    func testContentCarriesResolvedTextAndLearnMore() {
        let content = HelpTooltipProjector.content(
            text: "Body copy",
            i18nKey: nil,
            defaultValue: nil,
            learnMore: HelpTooltipLearnMore(url: "https://x.io", label: "More"),
            using: resolver
        )
        XCTAssertEqual(content?.text, "Body copy")
        XCTAssertEqual(content?.learnMore?.url, "https://x.io")
        XCTAssertEqual(content?.learnMore?.label, "More")
    }
}
