//
//  StatusHero.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the per-status glyph
//  mapping, the headline resolution (the verbatim port of the web `headline ?? cfg.defaultHeadline`),
//  the sub-line normalization (web `{subline && …}` truthiness), the projection (the subline-gated live
//  chip, the CTA flags, the composed VoiceOver label), and the value-type equality. Split from
//  StatusHero.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with
//  no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Test resolvers (deterministic facade stubs)

private func headlineStub(_ status: HeroStatus) -> String {
    "H-\(status.rawValue)"
}

private let liveStub = "LIVE"

// MARK: - Surface identity

final class StatusHeroAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(StatusHeroSurface.slug, "StatusHero")
    }
}

// MARK: - Per-status glyph (web lucide → SF Symbol)

final class StatusHeroIconTests: XCTestCase {
    func testIconForEveryStatus() {
        XCTAssertEqual(HeroStatus.healthy.iconSystemName, "checkmark.circle.fill")
        XCTAssertEqual(HeroStatus.degraded.iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(HeroStatus.unhealthy.iconSystemName, "xmark.circle.fill")
        XCTAssertEqual(HeroStatus.unknown.iconSystemName, "questionmark.circle.fill")
        XCTAssertEqual(HeroStatus.maintenance.iconSystemName, "wrench.adjustable.fill")
    }

    func testEveryStatusHasANonEmptyGlyph() {
        for status in HeroStatus.allCases {
            XCTAssertFalse(status.iconSystemName.isEmpty)
        }
    }
}

// MARK: - Headline resolution (web `headline ?? cfg.defaultHeadline`)

final class StatusHeroHeadlineTests: XCTestCase {
    func testNilOverrideUsesPerStatusDefault() {
        let input = StatusHeroInput(status: .degraded)
        XCTAssertEqual(
            StatusHeroProjector.resolvedHeadline(input, defaultHeadline: headlineStub),
            "H-degraded"
        )
    }

    func testOverrideWinsOverDefault() {
        let input = StatusHeroInput(status: .healthy, headlineOverride: "Fleet nominal")
        XCTAssertEqual(
            StatusHeroProjector.resolvedHeadline(input, defaultHeadline: headlineStub),
            "Fleet nominal"
        )
    }

    func testWhitespaceOnlyOverrideFallsBackToDefault() {
        let input = StatusHeroInput(status: .unknown, headlineOverride: "   \n ")
        XCTAssertEqual(
            StatusHeroProjector.resolvedHeadline(input, defaultHeadline: headlineStub),
            "H-unknown"
        )
    }
}

// MARK: - Sub-line normalization (web `{subline && …}`)

final class StatusHeroSublineTests: XCTestCase {
    func testNilCollapsesToNil() {
        XCTAssertNil(StatusHeroProjector.normalizedSubline(nil))
    }

    func testWhitespaceOnlyCollapsesToNil() {
        XCTAssertNil(StatusHeroProjector.normalizedSubline("   "))
    }

    func testNonEmptyIsPreservedVerbatim() {
        XCTAssertEqual(StatusHeroProjector.normalizedSubline("8 services"), "8 services")
    }
}

// MARK: - Projection (web render decision)

final class StatusHeroProjectionTests: XCTestCase {
    private func resolve(_ input: StatusHeroInput) -> StatusHeroProjection {
        StatusHeroProjector.resolve(input, defaultHeadline: headlineStub, liveLabel: liveStub)
    }

    func testResolveMapsStatusGlyphAndDefaultHeadline() {
        for status in HeroStatus.allCases {
            let projection = resolve(StatusHeroInput(status: status))
            XCTAssertEqual(projection.status, status)
            XCTAssertEqual(projection.iconSystemName, status.iconSystemName)
            XCTAssertEqual(projection.headline, "H-\(status.rawValue)")
        }
    }

    func testLiveChipRendersOnlyWithASubline() {
        // live + subline → chip shows (web nesting).
        let withSubline = resolve(StatusHeroInput(status: .healthy, subline: "ok", isLive: true))
        XCTAssertTrue(withSubline.showsLive)
        XCTAssertTrue(withSubline.showsSubline)
        // live but NO subline → chip hidden (the web nests it inside the subline block).
        let noSubline = resolve(StatusHeroInput(status: .healthy, isLive: true))
        XCTAssertFalse(noSubline.showsLive)
        XCTAssertFalse(noSubline.showsSubline)
        // subline but NOT live → chip hidden.
        let notLive = resolve(StatusHeroInput(status: .healthy, subline: "ok", isLive: false))
        XCTAssertFalse(notLive.showsLive)
    }

    func testCTAFlagsReflectInput() {
        let none = resolve(StatusHeroInput(status: .healthy))
        XCTAssertFalse(none.showsCTA)
        XCTAssertNil(none.ctaLabel)
        let loading = resolve(StatusHeroInput(status: .unhealthy, ctaLabel: "Retry", ctaIsLoading: true))
        XCTAssertTrue(loading.showsCTA)
        XCTAssertEqual(loading.ctaLabel, "Retry")
        XCTAssertTrue(loading.ctaIsLoading)
    }

    func testAnchorIDIsCarriedThrough() {
        let projection = resolve(StatusHeroInput(status: .healthy, anchorID: "system-status-hero"))
        XCTAssertEqual(projection.anchorID, "system-status-hero")
    }
}

// MARK: - Accessibility label composition (spoken peer of web `role="status"`)

final class StatusHeroAccessibilityLabelTests: XCTestCase {
    func testHeadlineOnly() {
        let label = StatusHeroProjector.accessibilityLabel(
            headline: "All systems operational",
            subline: nil,
            liveLabel: nil
        )
        XCTAssertEqual(label, "All systems operational")
    }

    func testHeadlineAndSubline() {
        let label = StatusHeroProjector.accessibilityLabel(
            headline: "Degraded performance",
            subline: "1 service down",
            liveLabel: nil
        )
        XCTAssertEqual(label, "Degraded performance, 1 service down")
    }

    func testHeadlineSublineAndLive() {
        let label = StatusHeroProjector.accessibilityLabel(
            headline: "All systems operational",
            subline: "8 services",
            liveLabel: "Live"
        )
        XCTAssertEqual(label, "All systems operational, 8 services, Live")
    }

    func testProjectionComposesLabelEndToEnd() {
        let projection = StatusHeroProjector.resolve(
            StatusHeroInput(status: .healthy, subline: "8 services", isLive: true),
            defaultHeadline: headlineStub,
            liveLabel: liveStub
        )
        XCTAssertEqual(projection.accessibilityLabel, "H-healthy, 8 services, LIVE")
    }
}

// MARK: - Value-type equality

final class StatusHeroValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = StatusHeroInput(
            status: .degraded,
            headlineOverride: "X",
            subline: "S",
            isLive: true,
            ctaLabel: "Go",
            ctaIsLoading: true,
            anchorID: "id"
        )
        let rhs = StatusHeroInput(
            status: .degraded,
            headlineOverride: "X",
            subline: "S",
            isLive: true,
            ctaLabel: "Go",
            ctaIsLoading: true,
            anchorID: "id"
        )
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, StatusHeroInput(status: .healthy, headlineOverride: "X", subline: "S"))
    }

    func testProjectionEqualityTracksDerivation() {
        let base = StatusHeroProjector.resolve(
            StatusHeroInput(status: .healthy, subline: "ok", isLive: true),
            defaultHeadline: headlineStub,
            liveLabel: liveStub
        )
        let same = StatusHeroProjector.resolve(
            StatusHeroInput(status: .healthy, subline: "ok", isLive: true),
            defaultHeadline: headlineStub,
            liveLabel: liveStub
        )
        XCTAssertEqual(base, same)
        let other = StatusHeroProjector.resolve(
            StatusHeroInput(status: .healthy, subline: "ok", isLive: false),
            defaultHeadline: headlineStub,
            liveLabel: liveStub
        )
        XCTAssertNotEqual(base, other)
    }
}
