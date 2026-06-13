//
//  UsageCard.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the budget-bar math (the
//  verbatim port of the web `widthPct = clamp(pct, 0, 100)` / `ariaValueNow = max(0, round(pct))`, plus
//  the native non-finite hardening), the `hasAnything` empty guard, the banner / footer default resolution,
//  the external / internal link URL split, and the value-type equality. Split from UsageCard.Tests.swift
//  (the SwiftUI / state-holder half) to keep each file within the SwiftLint file-length budget. These run
//  in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class UsageCardAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(UsageCardSurface.slug, "UsageCard")
    }
}

// MARK: - Budget bar width (web `widthPct = max(0, min(100, pct))`)

final class UsageCardBarWidthTests: XCTestCase {
    func testWidthClampsLowToZero() {
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: -25), 0, accuracy: 0.0001)
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: 0), 0, accuracy: 0.0001)
    }

    func testWidthScalesInRange() {
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: 8), 0.08, accuracy: 0.0001)
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: 50), 0.5, accuracy: 0.0001)
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: 100), 1, accuracy: 0.0001)
    }

    func testWidthClampsHighToOne() {
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: 108), 1, accuracy: 0.0001)
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: 10000), 1, accuracy: 0.0001)
    }

    func testWidthHardensNonFiniteToZero() {
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: .nan), 0, accuracy: 0.0001)
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: .infinity), 0, accuracy: 0.0001)
        XCTAssertEqual(UsageCardProjector.barWidthFraction(pct: -.infinity), 0, accuracy: 0.0001)
    }
}

// MARK: - Budget a11y value (web `ariaValueNow = max(0, round(pct))`, unclamped at the top)

final class UsageCardAriaValueTests: XCTestCase {
    func testRoundsToNearestInteger() {
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: 8.4), 8)
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: 8.5), 9)
    }

    func testFloorsNegativeToZero() {
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: -10), 0)
    }

    func testStaysUnclampedAboveHundred() {
        // The web keeps aria-valuenow unclamped so an over-budget overflow is still announced.
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: 108), 108)
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: 250.6), 251)
    }

    func testHardensNonFiniteToZero() {
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: .nan), 0)
        XCTAssertEqual(UsageCardProjector.accessibilityValuePercent(pct: .infinity), 0)
    }
}

// MARK: - hasAnything (web empty guard)

final class UsageCardHasAnythingTests: XCTestCase {
    private func budget() -> UsageCardBudget {
        UsageCardBudget(headline: "h", pct: 1, accessibilityLabel: "a")
    }

    func testEmptyInputHasNothing() {
        XCTAssertFalse(UsageCardProjector.hasAnything(UsageCardInput()))
    }

    func testAnySingleSectionCountsAsSomething() {
        XCTAssertTrue(UsageCardProjector.hasAnything(UsageCardInput(budget: budget())))
        XCTAssertTrue(UsageCardProjector.hasAnything(
            UsageCardInput(bands: [UsageCardBand(id: "b", label: "l", value: "v")])
        ))
        XCTAssertTrue(UsageCardProjector.hasAnything(
            UsageCardInput(details: [UsageCardDetail(id: "d", label: "l", value: "v")])
        ))
        XCTAssertTrue(UsageCardProjector.hasAnything(
            UsageCardInput(topLists: [UsageCardTopList(id: "t", title: "t", items: [])])
        ))
        XCTAssertTrue(UsageCardProjector.hasAnything(
            UsageCardInput(banner: UsageCardBanner(title: "t", description: "d"))
        ))
        XCTAssertTrue(UsageCardProjector.hasAnything(
            UsageCardInput(footer: [UsageCardFooterLink(id: "f", destination: "/x", label: "x")])
        ))
    }
}

// MARK: - Budget resolution

final class UsageCardResolveBudgetTests: XCTestCase {
    func testDangerIntentFlagsRightLabel() {
        let resolved = UsageCardProjector.resolveBudget(
            UsageCardBudget(headline: "h", rightLabel: "over", pct: 108, intent: .danger, accessibilityLabel: "a")
        )
        XCTAssertTrue(resolved.rightLabelIsDanger)
        XCTAssertEqual(resolved.barWidthFraction, 1, accuracy: 0.0001)
        XCTAssertEqual(resolved.accessibilityValuePercent, 108)
        XCTAssertEqual(resolved.intent, .danger)
    }

    func testNormalIntentDoesNotFlagRightLabel() {
        let resolved = UsageCardProjector.resolveBudget(
            UsageCardBudget(headline: "h", rightLabel: "8%", pct: 8, accessibilityLabel: "a")
        )
        XCTAssertFalse(resolved.rightLabelIsDanger)
        XCTAssertEqual(resolved.barWidthFraction, 0.08, accuracy: 0.0001)
    }
}

// MARK: - Banner resolution (web `icon ?? AlertTriangle`, `intent ?? 'danger'`)

final class UsageCardResolveBannerTests: XCTestCase {
    func testDefaultsToDangerIntentAndWarningGlyph() {
        let resolved = UsageCardProjector.resolveBanner(
            UsageCardBanner(title: "t", description: "d")
        )
        XCTAssertEqual(resolved.intent, .danger)
        XCTAssertEqual(resolved.iconSystemName, UsageCardBanner.defaultIconSystemName)
    }

    func testHonorsExplicitIconAndIntent() {
        let resolved = UsageCardProjector.resolveBanner(
            UsageCardBanner(title: "t", description: "d", intent: .warn, iconSystemName: "bolt")
        )
        XCTAssertEqual(resolved.intent, .warn)
        XCTAssertEqual(resolved.iconSystemName, "bolt")
    }
}

// MARK: - Footer link resolution (web `external ? <a href> : <Link to>`)

final class UsageCardResolveFooterLinkTests: XCTestCase {
    func testExternalLinkParsesURL() {
        let resolved = UsageCardProjector.resolveFooterLink(
            UsageCardFooterLink(id: "f", destination: "https://example.com/docs", label: "Docs", external: true)
        )
        XCTAssertTrue(resolved.external)
        XCTAssertEqual(resolved.externalURL, URL(string: "https://example.com/docs"))
    }

    func testInternalLinkHasNoURL() {
        let resolved = UsageCardProjector.resolveFooterLink(
            UsageCardFooterLink(id: "f", destination: "/settings/usage", label: "Usage")
        )
        XCTAssertFalse(resolved.external)
        XCTAssertNil(resolved.externalURL)
    }

    func testPrimaryFlagAndLabelPreserved() {
        let resolved = UsageCardProjector.resolveFooterLink(
            UsageCardFooterLink(id: "f", destination: "/x", label: "Go", primary: true)
        )
        XCTAssertTrue(resolved.primary)
        XCTAssertEqual(resolved.label, "Go")
        XCTAssertEqual(resolved.id, "f")
    }
}

// MARK: - Whole-card projection

final class UsageCardProjectionTests: XCTestCase {
    func testResolveCarriesEverySection() {
        let input = UsageCardInput(
            budget: UsageCardBudget(headline: "h", pct: 50, accessibilityLabel: "a"),
            bands: [UsageCardBand(id: "b", label: "l", value: "v")],
            details: [UsageCardDetail(id: "d", label: "l", value: "v")],
            topLists: [UsageCardTopList(id: "t", title: "t", items: [
                UsageCardTopListItem(id: "i", label: "l", value: "v")
            ])],
            banner: UsageCardBanner(title: "t", description: "d"),
            footer: [UsageCardFooterLink(id: "f", destination: "/x", label: "x")]
        )
        let projection = UsageCardProjector.resolve(input)
        XCTAssertTrue(projection.hasAnything)
        XCTAssertNotNil(projection.budget)
        XCTAssertEqual(projection.bands.count, 1)
        XCTAssertEqual(projection.details.count, 1)
        XCTAssertEqual(projection.topLists.first?.items.count, 1)
        XCTAssertNotNil(projection.banner)
        XCTAssertEqual(projection.footer.count, 1)
    }

    func testResolveEmptyInputHasNothing() {
        let projection = UsageCardProjector.resolve(UsageCardInput())
        XCTAssertFalse(projection.hasAnything)
        XCTAssertNil(projection.budget)
        XCTAssertTrue(projection.bands.isEmpty)
        XCTAssertNil(projection.banner)
        XCTAssertTrue(projection.footer.isEmpty)
    }
}

// MARK: - Value-type equality

final class UsageCardValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = UsageCardInput(
            bands: [UsageCardBand(id: "b", label: "Calls", value: "10", intent: .warn)],
            emptyMessage: "none"
        )
        let rhs = UsageCardInput(
            bands: [UsageCardBand(id: "b", label: "Calls", value: "10", intent: .warn)],
            emptyMessage: "none"
        )
        XCTAssertEqual(lhs, rhs)
    }

    func testInputEqualityDistinguishesIntent() {
        let normal = UsageCardInput(details: [UsageCardDetail(id: "d", label: "l", value: "v")])
        let danger = UsageCardInput(
            details: [UsageCardDetail(id: "d", label: "l", value: "v", intent: .danger)]
        )
        XCTAssertNotEqual(normal, danger)
    }

    func testIntentDefaults() {
        XCTAssertEqual(UsageCardIntent.defaultIntent, .normal)
        XCTAssertEqual(UsageCardIntent.defaultBannerIntent, .danger)
    }
}
