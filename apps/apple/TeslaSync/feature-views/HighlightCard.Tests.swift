//
//  HighlightCard.Tests.swift
//  TeslaSync — P4 feature view · 0076 · HighlightCard (Apple)
//
//  Host-free unit coverage for the HighlightCard surface. HighlightCard is a
//  pure presentational card (the web source fetches nothing), so the meaningful,
//  render-free surface area is:
//    • the `color` → accent + glow adapter (incl. the `cyan` fallback),
//    • the `change` trend model (glyph + success/danger tint),
//    • the per-configuration presentation projection (a "snapshot" of the
//      branches: value present/empty, change, subtitle, glow),
//    • the accessibility phrasing (empty value + trend direction),
//    • the P1/S11 `view.opened` telemetry slug.
//  These mirror the web `glowMap[color] ?? 'none'`, `change.positive ? … : …`,
//  and the card composition. No rendering / no KMP runtime required.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (folded in at integration
//  time, like every per-surface bundle).
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Accent adapter (web color string → native projection + glow map)

@MainActor
final class HighlightCardAccentTests: XCTestCase {
    func testMapsEveryKnownWebColor() {
        XCTAssertEqual(HighlightCardAccent(web: "cyan"), .cyan)
        XCTAssertEqual(HighlightCardAccent(web: "green"), .green)
        XCTAssertEqual(HighlightCardAccent(web: "purple"), .purple)
        XCTAssertEqual(HighlightCardAccent(web: "amber"), .amber)
        XCTAssertEqual(HighlightCardAccent(web: "red"), .red)
    }

    func testCoversExactlyTheWebColorKeysInOrder() {
        // Parity guard: the native case set must equal the web color union, in
        // the same order the props document them.
        XCTAssertEqual(
            HighlightCardAccent.allCases.map(\.rawValue),
            ["cyan", "green", "purple", "amber", "red"]
        )
    }

    func testFallsBackToCyanForUnknownOrEmpty() {
        XCTAssertEqual(HighlightCardAccent(web: "chartreuse"), .cyan)
        XCTAssertEqual(HighlightCardAccent(web: ""), .cyan)
        XCTAssertEqual(HighlightCardAccent.fallback, .cyan)
    }

    func testInitIsCaseInsensitive() {
        XCTAssertEqual(HighlightCardAccent(web: "CYAN"), .cyan)
        XCTAssertEqual(HighlightCardAccent(web: "Purple"), .purple)
        XCTAssertEqual(HighlightCardAccent(web: "AMBER"), .amber)
    }

    func testGlowMapMatchesWeb() {
        // web glowMap: cyan/green/purple keep their hue; amber/red → 'none'.
        XCTAssertTrue(HighlightCardAccent.cyan.hasGlow)
        XCTAssertTrue(HighlightCardAccent.green.hasGlow)
        XCTAssertTrue(HighlightCardAccent.purple.hasGlow)
        XCTAssertFalse(HighlightCardAccent.amber.hasGlow)
        XCTAssertFalse(HighlightCardAccent.red.hasGlow)
    }

    func testGlowColorPresentOnlyWhenAccentGlows() {
        XCTAssertEqual(HighlightCardAccent.cyan.glowColor, HighlightCardAccent.cyan.accent)
        XCTAssertEqual(HighlightCardAccent.green.glowColor, HighlightCardAccent.green.accent)
        XCTAssertEqual(HighlightCardAccent.purple.glowColor, HighlightCardAccent.purple.accent)
        XCTAssertNil(HighlightCardAccent.amber.glowColor)
        XCTAssertNil(HighlightCardAccent.red.glowColor)
    }

    func testAccentResolvesToTheSharedChartTokens() {
        // Cross-surface consistency: same hue mapping the ToolCard tint uses.
        XCTAssertEqual(HighlightCardAccent.cyan.accent, Color.TS.chartSeriesRegen)
        XCTAssertEqual(HighlightCardAccent.green.accent, Color.TS.chartSeriesBattery)
        XCTAssertEqual(HighlightCardAccent.purple.accent, Color.TS.chartSeriesPower)
        XCTAssertEqual(HighlightCardAccent.amber.accent, Color.TS.chartSeriesEnergy)
        XCTAssertEqual(HighlightCardAccent.red.accent, Color.TS.chartSeriesTemperature)
    }
}

// MARK: - Change model (web `change.positive ? TrendingUp : TrendingDown`)

@MainActor
final class HighlightCardChangeTests: XCTestCase {
    func testPositiveUsesUpGlyphAndSuccessTint() {
        let change = HighlightCardChange(value: "+12.3%", isPositive: true)
        XCTAssertEqual(change.systemImage, "arrow.up.right")
        XCTAssertEqual(change.tint, Color.TS.statusSuccess)
        XCTAssertEqual(change.value, "+12.3%")
    }

    func testNegativeUsesDownGlyphAndDangerTint() {
        let change = HighlightCardChange(value: "-4.0%", isPositive: false)
        XCTAssertEqual(change.systemImage, "arrow.down.right")
        XCTAssertEqual(change.tint, Color.TS.statusDanger)
        XCTAssertEqual(change.value, "-4.0%")
    }

    func testIsEquatable() {
        XCTAssertEqual(
            HighlightCardChange(value: "0%", isPositive: true),
            HighlightCardChange(value: "0%", isPositive: true)
        )
        XCTAssertNotEqual(
            HighlightCardChange(value: "0%", isPositive: true),
            HighlightCardChange(value: "0%", isPositive: false)
        )
    }
}

// MARK: - Presentation projection (per-configuration "snapshot")

@MainActor
final class HighlightCardPresentationTests: XCTestCase {
    private func make(
        icon: String = "car.fill",
        accent: HighlightCardAccent = .cyan,
        value: String = "342 km",
        change: HighlightCardChange? = nil,
        hasSubtitle: Bool = false
    ) -> HighlightCardPresentation {
        HighlightCardPresentation(
            iconSystemName: icon,
            accent: accent,
            value: value,
            change: change,
            hasSubtitle: hasSubtitle
        )
    }

    func testHasValueTrueForNonEmpty() {
        XCTAssertTrue(make(value: "342 km").hasValue)
        XCTAssertTrue(make(value: "0").hasValue)
        XCTAssertTrue(make(value: "$45.67").hasValue)
    }

    func testHasValueFalseForEmptyOrWhitespace() {
        XCTAssertFalse(make(value: "").hasValue)
        XCTAssertFalse(make(value: "   ").hasValue)
        XCTAssertFalse(make(value: "\n").hasValue)
    }

    func testShowsChangeReflectsPresence() {
        XCTAssertFalse(make(change: nil).showsChange)
        XCTAssertNil(make(change: nil).changeIsPositive)

        let up = make(change: HighlightCardChange(value: "+1%", isPositive: true))
        XCTAssertTrue(up.showsChange)
        XCTAssertEqual(up.changeIsPositive, true)

        let down = make(change: HighlightCardChange(value: "-1%", isPositive: false))
        XCTAssertTrue(down.showsChange)
        XCTAssertEqual(down.changeIsPositive, false)
    }

    func testShowsSubtitleReflectsPresence() {
        XCTAssertFalse(make(hasSubtitle: false).showsSubtitle)
        XCTAssertTrue(make(hasSubtitle: true).showsSubtitle)
    }

    func testGlowDelegatesToAccentMap() {
        XCTAssertTrue(make(accent: .cyan).hasGlow)
        XCTAssertTrue(make(accent: .green).hasGlow)
        XCTAssertTrue(make(accent: .purple).hasGlow)
        XCTAssertFalse(make(accent: .amber).hasGlow)
        XCTAssertFalse(make(accent: .red).hasGlow)
    }

    func testCarriesIconAndAccent() {
        let presentation = make(icon: "leaf.fill", accent: .red)
        XCTAssertEqual(presentation.iconSystemName, "leaf.fill")
        XCTAssertEqual(presentation.accent, .red)
    }

    func testAccessibilityPolicyHidesIconAndCombines() {
        for accent in HighlightCardAccent.allCases {
            let presentation = make(accent: accent, hasSubtitle: true)
            XCTAssertTrue(presentation.iconIsDecorative, "icon must be hidden from VoiceOver")
            XCTAssertTrue(presentation.combinesForVoiceOver, "card must read as one element")
        }
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(make().surfaceSlug, "HighlightCard")
        XCTAssertEqual(make().surfaceSlug, HighlightCardSurface.slug)
        XCTAssertEqual(HighlightCard.surfaceSlug, HighlightCardSurface.slug)
    }

    func testIsEquatable() {
        XCTAssertEqual(make(value: "1", change: nil), make(value: "1", change: nil))
        XCTAssertNotEqual(
            make(value: "1", change: HighlightCardChange(value: "+1%", isPositive: true)),
            make(value: "1", change: nil)
        )
    }
}

// MARK: - Accessibility phrasing

@MainActor
final class HighlightCardAccessibilityTests: XCTestCase {
    func testChangeLabelAnnouncesIncreaseWithValue() {
        let label = HighlightCardAccessibility.changeLabel(isPositive: true, value: "+12.3%")
        XCTAssertTrue(label.lowercased().contains("increase"), label)
        XCTAssertTrue(label.contains("+12.3%"), label)
    }

    func testChangeLabelAnnouncesDecreaseWithValue() {
        let label = HighlightCardAccessibility.changeLabel(isPositive: false, value: "-4.0%")
        XCTAssertTrue(label.lowercased().contains("decrease"), label)
        XCTAssertTrue(label.contains("-4.0%"), label)
    }

    func testEmptyValueHasGlyphAndSpokenForm() {
        XCTAssertEqual(HighlightCardAccessibility.emptyValueGlyph, "—")
        XCTAssertFalse(HighlightCardAccessibility.emptyValueLabel.isEmpty)
        XCTAssertNotEqual(HighlightCardAccessibility.emptyValueLabel, "—")
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor
final class HighlightCardTelemetryTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyHighlightCardTelemetry()
        HighlightCardSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["HighlightCard"])
    }

    func testReportOpenEmitsTheExactSlugEachTime() {
        let spy = SpyHighlightCardTelemetry()
        HighlightCardSurface.reportOpen(to: spy)
        HighlightCardSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["HighlightCard", "HighlightCard"])
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyHighlightCardTelemetry: HighlightCardTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
