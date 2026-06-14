//
//  Typography.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the composed-role table (the
//  native port of `typography.role`), the heading-level → role table (web `HEADING_ROLE`), the granular
//  size / weight / color / mono composition (web `<Text size weight color mono>`), the monotonic size ramp,
//  the colour-token mapping, and the value-type equality. Split from Typography.Tests.swift (the SwiftUI /
//  state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class TypographyAdapterIdentityTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(TypographySurface.slug, "Typography")
    }
}

// MARK: - Composed-role table (web `typography.role`)

final class TypographyRoleStyleTests: XCTestCase {
    func testEveryRoleHasAStyle() {
        XCTAssertEqual(TypographyProjector.roleStyles.count, TypographyRole.allCases.count)
        for role in TypographyRole.allCases {
            XCTAssertNotNil(TypographyProjector.roleStyles[role], "role \(role.rawValue) must map to a style")
        }
    }

    func testPageTitleIsTheLargestHeader() {
        let style = TypographyProjector.style(for: .pageTitle)
        XCTAssertEqual(style.textStyle, .largeTitle)
        XCTAssertEqual(style.weight, .bold)
        XCTAssertEqual(style.color, .primary)
        XCTAssertEqual(style.tracking, .display)
        XCTAssertTrue(style.isAccessibilityHeader)
        XCTAssertFalse(style.isUppercased)
    }

    func testHeadingRolesCarryTheAccessibilityHeaderTrait() {
        for role in [TypographyRole.pageTitle, .sectionTitle, .panelTitle, .subhead] {
            XCTAssertTrue(TypographyProjector.style(for: role).isAccessibilityHeader, "\(role.rawValue)")
        }
        for role in [TypographyRole.body, .caption, .label, .metricValue, .code, .error] {
            XCTAssertFalse(TypographyProjector.style(for: role).isAccessibilityHeader, "\(role.rawValue)")
        }
    }

    func testMetricValueUsesTabularFigures() {
        let style = TypographyProjector.style(for: .metricValue)
        XCTAssertTrue(style.monospacedDigit)
        XCTAssertEqual(style.textStyle, .title)
        XCTAssertEqual(style.weight, .bold)
    }

    func testLabelAndMetricLabelAreUppercased() {
        XCTAssertTrue(TypographyProjector.style(for: .label).isUppercased)
        XCTAssertTrue(TypographyProjector.style(for: .metricLabel).isUppercased)
        XCTAssertEqual(TypographyProjector.style(for: .label).textStyle, .caption)
        XCTAssertEqual(TypographyProjector.style(for: .metricLabel).textStyle, .caption2)
    }

    func testCodeUsesMonospacedDesign() {
        XCTAssertEqual(TypographyProjector.style(for: .code).design, .monospaced)
        XCTAssertEqual(TypographyProjector.style(for: .body).design, .standard)
    }

    func testErrorUsesTheDangerColour() {
        XCTAssertEqual(TypographyProjector.style(for: .error).color, .danger)
        XCTAssertEqual(TypographyProjector.style(for: .caption).color, .muted)
        XCTAssertEqual(TypographyProjector.style(for: .bodySm).color, .secondary)
    }
}

// MARK: - Heading-level table (web `HEADING_ROLE` / `HEADING_TAG`)

final class TypographyHeadingLevelTests: XCTestCase {
    func testLevelMapsToTheHeadingRole() {
        XCTAssertEqual(TypographyHeadingLevel.page.role, .pageTitle)
        XCTAssertEqual(TypographyHeadingLevel.section.role, .sectionTitle)
        XCTAssertEqual(TypographyHeadingLevel.panel.role, .panelTitle)
        XCTAssertEqual(TypographyHeadingLevel.sub.role, .subhead)
    }

    func testHeadingRankAscendsWithDepth() {
        XCTAssertEqual(TypographyHeadingLevel.page.headingRank, 1)
        XCTAssertEqual(TypographyHeadingLevel.section.headingRank, 2)
        XCTAssertEqual(TypographyHeadingLevel.panel.headingRank, 3)
        XCTAssertEqual(TypographyHeadingLevel.sub.headingRank, 4)
    }

    func testStyleForLevelMatchesStyleForRole() {
        for level in TypographyHeadingLevel.allCases {
            XCTAssertEqual(
                TypographyProjector.style(forLevel: level),
                TypographyProjector.style(for: level.role)
            )
        }
    }
}

// MARK: - Granular composition (web `<Text size weight color mono>`)

final class TypographyGranularStyleTests: XCTestCase {
    func testBareCompositionIsTheBodyLikeBase() {
        XCTAssertEqual(TypographyProjector.style(), TypographyProjector.granularBase)
    }

    func testOnlySuppliedDimensionsOverrideTheBase() {
        let sized = TypographyProjector.style(size: .threeXl)
        XCTAssertEqual(sized.textStyle, .title)
        XCTAssertEqual(sized.weight, TypographyProjector.granularBase.weight)
        XCTAssertEqual(sized.color, TypographyProjector.granularBase.color)

        let weighted = TypographyProjector.style(weight: .bold)
        XCTAssertEqual(weighted.weight, .bold)
        XCTAssertEqual(weighted.textStyle, TypographyProjector.granularBase.textStyle)

        let coloured = TypographyProjector.style(color: .muted)
        XCTAssertEqual(coloured.color, .muted)

        let mono = TypographyProjector.style(mono: true)
        XCTAssertEqual(mono.design, .monospaced)
        XCTAssertEqual(TypographyProjector.style(mono: false).design, .standard)
    }

    func testFullCompositionAppliesEveryDimension() {
        let style = TypographyProjector.style(size: .xs, weight: .semibold, color: .secondary, mono: true)
        XCTAssertEqual(style.textStyle, .caption)
        XCTAssertEqual(style.weight, .semibold)
        XCTAssertEqual(style.color, .secondary)
        XCTAssertEqual(style.design, .monospaced)
    }

    func testGranularColourMapsOneToOneOntoTokens() {
        XCTAssertEqual(TypographyColor.primary.token, .primary)
        XCTAssertEqual(TypographyColor.secondary.token, .secondary)
        XCTAssertEqual(TypographyColor.muted.token, .muted)
        XCTAssertEqual(TypographyColor.subtle.token, .subtle)
        XCTAssertEqual(TypographyColor.disabled.token, .disabled)
        XCTAssertEqual(TypographyColor.inverse.token, .inverse)
    }
}

// MARK: - Size ramp (monotonic text-style scaling)

final class TypographySizeRampTests: XCTestCase {
    func testSizeTableIsComplete() {
        XCTAssertEqual(TypographyProjector.sizeTextStyles.count, TypographySize.allCases.count)
        for size in TypographySize.allCases {
            XCTAssertNotNil(TypographyProjector.textStyle(for: size))
        }
    }

    func testRampMapsToStrictlyIncreasingTextStyles() {
        let ranks = TypographySize.allCases.map { TypographyProjector.textStyle(for: $0).scaleRank }
        for (lower, higher) in zip(ranks, ranks.dropFirst()) {
            XCTAssertLessThan(lower, higher, "size ramp must map to non-decreasing text styles")
        }
    }

    func testTextStyleScaleRankFollowsDeclarationOrder() {
        XCTAssertLessThan(TypographyTextStyle.caption2.scaleRank, TypographyTextStyle.caption.scaleRank)
        XCTAssertLessThan(TypographyTextStyle.caption.scaleRank, TypographyTextStyle.body.scaleRank)
        XCTAssertLessThan(TypographyTextStyle.body.scaleRank, TypographyTextStyle.title.scaleRank)
        XCTAssertLessThan(TypographyTextStyle.title.scaleRank, TypographyTextStyle.largeTitle.scaleRank)
    }
}

// MARK: - Value-type equality

final class TypographyValueTypeTests: XCTestCase {
    func testStyleEquality() {
        let lhs = TypographyProjector.style(for: .pageTitle)
        let rhs = TypographyProjector.style(for: .pageTitle)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, TypographyProjector.style(for: .body))
    }

    func testStyleEqualityDistinguishesEveryField() {
        let base = TypographyStyle(textStyle: .body, weight: .regular, color: .primary, tracking: .body)
        XCTAssertNotEqual(base, TypographyStyle(
            textStyle: .title, weight: .regular, color: .primary, tracking: .body
        ))
        XCTAssertNotEqual(base, TypographyStyle(
            textStyle: .body, weight: .bold, color: .primary, tracking: .body
        ))
        XCTAssertNotEqual(base, TypographyStyle(
            textStyle: .body, weight: .regular, color: .muted, tracking: .body
        ))
        XCTAssertNotEqual(base, TypographyStyle(
            textStyle: .body, weight: .regular, color: .primary, tracking: .label
        ))
        XCTAssertNotEqual(base, TypographyStyle(
            textStyle: .body, weight: .regular, design: .monospaced, color: .primary, tracking: .body
        ))
    }
}
