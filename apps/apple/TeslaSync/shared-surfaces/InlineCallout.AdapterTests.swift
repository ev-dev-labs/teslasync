//
//  InlineCallout.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the variant glyph map,
//  the wrapper-interaction resolution (web `href` wins over `onClick`; `onClick` alone is a button;
//  neither is the status row), and the projector (cached props → view-ready projection) including the
//  composed VoiceOver label. Split from InlineCallout.Tests.swift (the SwiftUI / state-holder half) to
//  keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest
//  targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + variant glyphs

final class InlineCalloutAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(InlineCalloutSurface.slug, "InlineCallout")
    }

    func testVariantsCoverTheFourWebTiers() {
        XCTAssertEqual(InlineCalloutVariant.allCases, [.info, .success, .warning, .danger])
        XCTAssertEqual(InlineCalloutVariant.info.rawValue, "info")
        XCTAssertEqual(InlineCalloutVariant.danger.rawValue, "danger")
    }

    func testVariantDefaultGlyphsMatchTheCanonicalRender() {
        XCTAssertEqual(InlineCalloutVariant.info.defaultIconSystemName, "info.circle.fill")
        XCTAssertEqual(InlineCalloutVariant.success.defaultIconSystemName, "checkmark.circle.fill")
        XCTAssertEqual(InlineCalloutVariant.warning.defaultIconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(InlineCalloutVariant.danger.defaultIconSystemName, "xmark.octagon.fill")
    }
}

// MARK: - Interaction resolution (web wrapper choice)

final class InlineCalloutInteractionTests: XCTestCase {
    private let url = URL(string: "https://teslasync.local/drives")!

    func testHrefWinsOverOnClick() {
        XCTAssertEqual(InlineCalloutInteraction.resolve(url: url, hasTapAction: true), .link(url))
    }

    func testHrefAloneIsLink() {
        XCTAssertEqual(InlineCalloutInteraction.resolve(url: url, hasTapAction: false), .link(url))
    }

    func testOnClickAloneIsButton() {
        XCTAssertEqual(InlineCalloutInteraction.resolve(url: nil, hasTapAction: true), .button)
    }

    func testNeitherIsStatus() {
        XCTAssertEqual(InlineCalloutInteraction.resolve(url: nil, hasTapAction: false), .status)
    }

    func testIsInteractiveFlag() {
        XCTAssertFalse(InlineCalloutInteraction.status.isInteractive)
        XCTAssertTrue(InlineCalloutInteraction.link(url).isInteractive)
        XCTAssertTrue(InlineCalloutInteraction.button.isInteractive)
    }
}

// MARK: - Projector (cached props → projection)

final class InlineCalloutProjectorTests: XCTestCase {
    private let url = URL(string: "https://teslasync.local/drives")!

    /// A deterministic severity resolver so the projector test does not depend on the catalog.
    private func severity(_ variant: InlineCalloutVariant) -> String {
        variant.rawValue.uppercased()
    }

    private func projection(
        _ variant: InlineCalloutVariant,
        message: String,
        actionLabel: String? = nil,
        interaction: InlineCalloutInteraction = .status,
        icon: String? = nil
    ) -> InlineCalloutProjection {
        InlineCalloutProjector.resolve(
            InlineCalloutInput(
                variant: variant,
                iconSystemName: icon,
                message: message,
                actionLabel: actionLabel,
                interaction: interaction
            ),
            severity: severity
        )
    }

    func testProjectionPassesThroughTheProps() {
        let result = projection(.warning, message: "1 anomaly", actionLabel: "View", interaction: .button, icon: "x")
        XCTAssertEqual(result.variant, .warning)
        XCTAssertEqual(result.iconSystemName, "x")
        XCTAssertEqual(result.message, "1 anomaly")
        XCTAssertEqual(result.trailingLabel, "View")
        XCTAssertEqual(result.interaction, .button)
        XCTAssertTrue(result.isInteractive)
    }

    func testAccessibilityLabelPrefixesSeverity() {
        let result = projection(.danger, message: "Stream offline")
        XCTAssertEqual(result.accessibilityLabel, "DANGER: Stream offline")
    }

    func testAccessibilityLabelAppendsAction() {
        let result = projection(.warning, message: "1 anomaly", actionLabel: "View", interaction: .link(url))
        XCTAssertEqual(result.accessibilityLabel, "WARNING: 1 anomaly, View")
    }

    func testStatusProjectionIsNotInteractive() {
        XCTAssertFalse(projection(.info, message: "Up to date").isInteractive)
    }

    func testLabelHelperMatchesDirectComposition() {
        XCTAssertEqual(
            InlineCalloutProjector.accessibilityLabel(severity: "Info", message: "Synced", actionLabel: nil),
            "Info: Synced"
        )
        XCTAssertEqual(
            InlineCalloutProjector.accessibilityLabel(severity: "Info", message: "Synced", actionLabel: ""),
            "Info: Synced"
        )
    }
}

// MARK: - Value-type equality

final class InlineCalloutValueTypeTests: XCTestCase {
    private let url = URL(string: "https://teslasync.local/drives")!

    func testInputEquality() {
        let lhs = InlineCalloutInput(variant: .info, message: "A", actionLabel: "Go", interaction: .link(url))
        let rhs = InlineCalloutInput(variant: .info, message: "A", actionLabel: "Go", interaction: .link(url))
        XCTAssertEqual(lhs, rhs)
        let other = InlineCalloutInput(variant: .danger, message: "A", actionLabel: "Go", interaction: .link(url))
        XCTAssertNotEqual(lhs, other)
    }

    func testInteractionEquality() {
        XCTAssertEqual(InlineCalloutInteraction.link(url), .link(url))
        XCTAssertNotEqual(InlineCalloutInteraction.link(url), .button)
        XCTAssertNotEqual(InlineCalloutInteraction.status, .button)
    }
}
