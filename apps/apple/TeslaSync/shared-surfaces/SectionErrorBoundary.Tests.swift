//
//  SectionErrorBoundary.Tests.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  Adapter + projection coverage for the SectionErrorBoundary surface:
//    • Text — the verbatim (caller / runtime content) vs localized (facade-resolved) resolution.
//    • Fallback mode — the three web modes: the default inline (localized headline + verbatim
//      `error.message` + Retry), the `fallbackTitle` (verbatim headline + the verbatim
//      `errors.section.subtitle` copy + key, NO Retry), and the custom node (no text, NO Retry).
//    • Projection — the render branches plus the P4 leaf contract across caught / loading / empty /
//      content, including the caught-over-everything precedence and connectivity independence.
//    • Accessibility — the composed VoiceOver fallback label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

private let identityResolver: SectionErrorBoundaryResolve = { _, fallback in fallback }
private let keyResolver: SectionErrorBoundaryResolve = { key, _ in key }

// MARK: - Text (verbatim vs facade-resolved)

final class SectionBoundaryTextTests: XCTestCase {
    func testVerbatimIgnoresResolver() {
        XCTAssertEqual(SectionBoundaryText.verbatim("HTTP 500").resolve(keyResolver), "HTTP 500")
        XCTAssertEqual(SectionBoundaryText.verbatim("HTTP 500").resolve(identityResolver), "HTTP 500")
    }

    func testLocalizedUsesResolver() {
        let text = SectionBoundaryText.localized(key: "errors.section.subtitle", fallback: "Other parts work.")
        XCTAssertEqual(text.resolve(identityResolver), "Other parts work.")
        XCTAssertEqual(text.resolve(keyResolver), "errors.section.subtitle")
    }
}

// MARK: - Fallback mode (web default / `fallbackTitle` / `fallback`)

final class SectionBoundaryFallbackModeTests: XCTestCase {
    private let error = SectionBoundaryError(message: "Cannot read 'soc' of undefined")

    func testInlineModeShowsLocalizedTitleVerbatimMessageAndRetry() {
        let content = SectionBoundaryFallbackMode.inline.content(for: error)
        XCTAssertEqual(content.kind, .inline)
        XCTAssertTrue(content.showsRetry)
        XCTAssertEqual(content.symbolName, "exclamationmark.triangle.fill")
        XCTAssertEqual(
            content.headline,
            .localized(key: "errors.section.inlineTitle", fallback: "Component failed to load")
        )
        XCTAssertEqual(content.detail, .verbatim("Cannot read 'soc' of undefined"))
    }

    func testTitleModeShowsVerbatimHeadlineWebSubtitleAndNoRetry() {
        let content = SectionBoundaryFallbackMode.title("Chart unavailable").content(for: error)
        XCTAssertEqual(content.kind, .title)
        XCTAssertFalse(content.showsRetry)
        XCTAssertEqual(content.headline, .verbatim("Chart unavailable"))
        // The single web `t()` key is reproduced verbatim, both key and English fallback.
        XCTAssertEqual(content.detail?.resolve(keyResolver), "errors.section.subtitle")
        XCTAssertEqual(content.detail?.resolve(identityResolver), "Other parts of the page should still work.")
    }

    func testCustomModeHasNoTextAndNoRetry() {
        let content = SectionBoundaryFallbackMode.custom.content(for: error)
        XCTAssertEqual(content.kind, .custom)
        XCTAssertFalse(content.showsRetry)
        XCTAssertNil(content.headline)
        XCTAssertNil(content.detail)
    }

    func testOnlyInlineOffersRetry() {
        XCTAssertTrue(SectionBoundaryFallbackMode.inline.content(for: error).showsRetry)
        XCTAssertFalse(SectionBoundaryFallbackMode.title("x").content(for: error).showsRetry)
        XCTAssertFalse(SectionBoundaryFallbackMode.custom.content(for: error).showsRetry)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class SectionErrorBoundaryProjectionTests: XCTestCase {
    private let error = SectionBoundaryError(message: "boom")

    func testCaughtTakesPrecedenceOverEverything() {
        let resolved = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(error: error, hasContent: false, connection: .offline, isLoading: true),
            mode: .inline
        )
        XCTAssertEqual(resolved.phase, .caught)
        XCTAssertEqual(resolved.fallback?.kind, .inline)
        XCTAssertEqual(resolved.fallback?.detail, .verbatim("boom"))
    }

    func testCaughtCarriesConfiguredModeFallback() {
        let inline = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(error: error),
            mode: .inline
        )
        XCTAssertEqual(inline.fallback?.kind, .inline)

        let title = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(error: error),
            mode: .title("Headline")
        )
        XCTAssertEqual(title.fallback?.kind, .title)
        XCTAssertEqual(title.fallback?.headline, .verbatim("Headline"))

        let custom = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(error: error),
            mode: .custom
        )
        XCTAssertEqual(custom.fallback?.kind, .custom)
    }

    func testLoadingWhenFlaggedAndHealthy() {
        let resolved = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(isLoading: true),
            mode: .inline
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.fallback)
    }

    func testEmptyWhenNoContentAndHealthy() {
        let resolved = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(hasContent: false),
            mode: .inline
        )
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testContentWhenHealthyWithContent() {
        let resolved = SectionErrorBoundaryProjection.resolve(
            input: SectionErrorBoundaryInput(),
            mode: .inline
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertNil(resolved.fallback)
    }

    func testConnectivityDoesNotChangePhase() {
        for connection in SectionBoundaryConnection.allCases {
            let resolved = SectionErrorBoundaryProjection.resolve(
                input: SectionErrorBoundaryInput(connection: connection),
                mode: .inline
            )
            XCTAssertEqual(resolved.phase, .content, "connection \(connection) must not change the content phase")
        }
    }

    func testClearingErrorRecoversToContent() {
        let caught = SectionErrorBoundaryInput(error: error)
        XCTAssertEqual(SectionErrorBoundaryProjection.resolve(input: caught, mode: .inline).phase, .caught)
        let cleared = caught.clearingError()
        XCTAssertNil(cleared.error)
        XCTAssertEqual(SectionErrorBoundaryProjection.resolve(input: cleared, mode: .inline).phase, .content)
    }
}

// MARK: - Accessibility

final class SectionBoundaryAccessibilityTests: XCTestCase {
    func testLabelReadsHeadlineThenDetail() {
        let label = SectionBoundaryAccessibility.label(
            headline: "Component failed to load",
            detail: "Cannot read 'soc' of undefined"
        )
        XCTAssertEqual(label, "Component failed to load. Cannot read 'soc' of undefined")
    }

    func testLabelDetailOnlyWhenNoHeadline() {
        XCTAssertEqual(SectionBoundaryAccessibility.label(headline: nil, detail: "Offline"), "Offline")
        XCTAssertEqual(SectionBoundaryAccessibility.label(headline: "", detail: "Offline"), "Offline")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = SectionBoundaryAccessibility.label(
            headline: "Chart unavailable.",
            detail: "Other parts of the page should still work."
        )
        XCTAssertEqual(label, "Chart unavailable. Other parts of the page should still work.")
    }

    func testLabelEmptyWhenBothEmpty() {
        XCTAssertEqual(SectionBoundaryAccessibility.label(headline: nil, detail: nil), "")
        XCTAssertEqual(SectionBoundaryAccessibility.label(headline: "", detail: ""), "")
    }
}

// MARK: - Connectivity axis

final class SectionBoundaryConnectionTests: XCTestCase {
    func testConnectionCasesMatchWebConsumers() {
        XCTAssertEqual(SectionBoundaryConnection.allCases, [.live, .stale, .offline])
    }
}
