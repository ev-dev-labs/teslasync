//
//  SkipToContent.Tests.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  Adapter + projection coverage for the SkipToContent surface:
//    • Anchor — the verbatim port of the web `href="#main-content"` ⇄ `getElementById` identity.
//    • Input — the primary / secondary landmark derivation (web `#main-content` selection).
//    • Projection — the render branches plus the P4 leaf contract across
//      loading / empty / error / data, including the primary derivation + secondary ordering.
//    • Accessibility — the composed VoiceOver skip + confirmation labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store,
//  so each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Anchor identity (web `href="#id"` ⇄ `getElementById`)

final class SkipAnchorTests: XCTestCase {
    func testIDStripsLeadingHash() {
        XCTAssertEqual(SkipAnchor.id(forHref: "#main-content"), "main-content")
    }

    func testIDPassesThroughWhenNoHash() {
        XCTAssertEqual(SkipAnchor.id(forHref: "main-content"), "main-content")
    }

    func testIDStripsOnlyTheFirstHash() {
        XCTAssertEqual(SkipAnchor.id(forHref: "##weird"), "#weird")
    }

    func testHrefPrependsHash() {
        XCTAssertEqual(SkipAnchor.href(forID: "main-content"), "#main-content")
    }

    func testHrefDoesNotDoublePrefix() {
        XCTAssertEqual(SkipAnchor.href(forID: "#main-content"), "#main-content")
    }

    func testRoundTrip() {
        let href = "#main-content"
        XCTAssertEqual(SkipAnchor.href(forID: SkipAnchor.id(forHref: href)), href)
    }
}

// MARK: - Input derivation (web `#main-content` selection)

final class SkipToContentInputTests: XCTestCase {
    func testPrimaryPrefersTheFlaggedLandmark() {
        let input = SkipToContentInput(targets: [
            SkipTarget(id: "nav", label: "Navigation"),
            SkipTarget(id: "main-content", label: "Main content", isPrimary: true)
        ])
        XCTAssertEqual(input.primaryTarget?.id, "main-content")
        XCTAssertEqual(input.secondaryTargets.map(\.id), ["nav"])
    }

    func testPrimaryFallsBackToFirstWhenNoneFlagged() {
        let input = SkipToContentInput(targets: [
            SkipTarget(id: "nav", label: "Navigation"),
            SkipTarget(id: "filters", label: "Filters")
        ])
        XCTAssertEqual(input.primaryTarget?.id, "nav")
        XCTAssertEqual(input.secondaryTargets.map(\.id), ["filters"])
    }

    func testPrimaryNilAndNoSecondaryWhenEmpty() {
        let input = SkipToContentInput()
        XCTAssertNil(input.primaryTarget)
        XCTAssertTrue(input.secondaryTargets.isEmpty)
    }

    func testSecondaryPreservesRegistrationOrder() {
        let input = SkipToContentInput(targets: [
            SkipTarget(id: "main-content", label: "Main content", isPrimary: true),
            SkipTarget(id: "b", label: "B"),
            SkipTarget(id: "a", label: "A")
        ])
        XCTAssertEqual(input.secondaryTargets.map(\.id), ["b", "a"])
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class SkipToContentProjectionTests: XCTestCase {
    private let targets = [
        SkipTarget(id: "main-content", label: "Main content", isPrimary: true),
        SkipTarget(id: "nav", label: "Navigation")
    ]

    func testErrorTakesPrecedence() {
        let resolved = SkipToContentProjection.resolve(
            SkipToContentInput(targets: targets, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.primary)
        XCTAssertTrue(resolved.secondary.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = SkipToContentProjection.resolve(SkipToContentInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoTargets() {
        let resolved = SkipToContentProjection.resolve(SkipToContentInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.primary)
    }

    func testDataDerivesPrimaryAndSecondary() {
        let resolved = SkipToContentProjection.resolve(SkipToContentInput(targets: targets))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.primary?.id, "main-content")
        XCTAssertEqual(resolved.secondary.map(\.id), ["nav"])
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = SkipToContentProjection.resolve(
            SkipToContentInput(targets: targets, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testLoadingTakesPrecedenceOverEmpty() {
        let resolved = SkipToContentProjection.resolve(SkipToContentInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.primary)
    }
}

// MARK: - Accessibility summaries

final class SkipToContentAccessibilityTests: XCTestCase {
    func testNamedSkipLabelComposesDestination() {
        let label = SkipToContentAccessibility.namedSkipLabel(
            format: "Skip to %@",
            destination: "Primary navigation"
        )
        XCTAssertEqual(label, "Skip to Primary navigation")
    }

    func testSkipConfirmationComposesDestination() {
        let message = SkipToContentAccessibility.skipConfirmation(
            format: "Skipped to %@",
            destination: "Main content"
        )
        XCTAssertEqual(message, "Skipped to Main content")
    }
}
