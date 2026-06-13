//
//  ErrorDisplay.Tests.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  Adapter + projection coverage for the ErrorDisplay surface:
//    • Mode — the web branch ladder (`classify`: 404 → 401/403 → 5xx → network/offline; NO transient
//      branch), the per-mode SF Symbol, and the assertive/polite live-region intent.
//    • Density — the web `compact` prop metrics (padding / gap / icon box / icon size).
//    • Text — verbatim (caller content) vs localized (facade-resolved) vs the `{{thing}}` 404 title.
//    • Content — the per-branch copy + CTA: the 404 Back-to-list gate (resourceName / listHref), the
//      401 Sign-in destination, and the 5xx / network Retry gate (`onRetry`) incl. the disabled
//      offline `Retry when online`.
//    • Projection — the render branches + the P4 leaf contract (failure → loading → empty) and the
//      retry-capability flow-through.
//    • Connection / density input — the derived offline/stale/live axis + the compact→density mapping.
//    • Accessibility — the composed VoiceOver failure label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly. The `@MainActor` state-holder behaviour
//  (telemetry / CTA dispatch / freshness) lives in `ErrorDisplay.ModelTests`.
//

import XCTest
@testable import TeslaSync

private let identityResolver: ErrorDisplayResolve = { _, fallback in fallback }
private let keyResolver: ErrorDisplayResolve = { key, _ in key }

// MARK: - Mode — the web branch ladder

final class ErrorDisplayModeClassifyTests: XCTestCase {
    func testNotFound() {
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(404), online: true), .notFound)
    }

    func testUnauthorized() {
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(401), online: true), .unauthorized)
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(403), online: true), .unauthorized)
    }

    func testServerError() {
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(500), online: true), .serverError)
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(502), online: true), .serverError)
    }

    func testUnreachableWhenOnlineAndNoStatus() {
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .network, online: true), .unreachable)
    }

    func testOfflineWhenBrowserOffline() {
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .network, online: false), .offline)
    }

    func testOfflineSentinelStatusZeroIsOfflineEvenWhenOnline() {
        // Web: `isOffline = !online || status === 0` — the status-0 fetch sentinel forces offline.
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .offline, online: true), .offline)
    }

    func testUnmatchedClientStatusFallsThroughToNetworkBranch() {
        // A 4xx that is not 404/401/403 (e.g. 400, 418) falls to the network/unknown branch.
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(400), online: true), .unreachable)
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(418), online: false), .offline)
    }

    func testServerErrorWinsOverOfflineWhenStatusIs5xx() {
        // The 5xx branch precedes the network/offline branch, so a 500 while offline is still a server
        // error (web checks `status >= 500` before the `isOffline` split).
        XCTAssertEqual(ErrorDisplayMode.classify(failure: .http(500), online: false), .serverError)
    }
}

// MARK: - Mode — symbols + live region

final class ErrorDisplayModeSymbolTests: XCTestCase {
    func testEachModeHasADistinctNonEmptySymbol() {
        let symbols = ErrorDisplayMode.allCases.map(\.symbolName)
        XCTAssertEqual(Set(symbols).count, ErrorDisplayMode.allCases.count)
        XCTAssertFalse(symbols.contains(""))
    }

    func testSymbolsAreStable() {
        XCTAssertEqual(ErrorDisplayMode.notFound.symbolName, "doc.questionmark")
        XCTAssertEqual(ErrorDisplayMode.unauthorized.symbolName, "lock.fill")
        XCTAssertEqual(ErrorDisplayMode.serverError.symbolName, "server.rack")
        XCTAssertEqual(ErrorDisplayMode.unreachable.symbolName, "exclamationmark.circle.fill")
        XCTAssertEqual(ErrorDisplayMode.offline.symbolName, "wifi.slash")
    }

    func testNoWaitingBranchExists() {
        // ErrorDisplay (unlike QueryError) has exactly four failure modes — no transient-waiting case.
        XCTAssertEqual(ErrorDisplayMode.allCases.count, 5)
    }
}

final class ErrorDisplayModeLiveRegionTests: XCTestCase {
    func testOfflineIsPolite() {
        XCTAssertFalse(ErrorDisplayMode.offline.isAssertive)
    }

    func testFailureBranchesAreAssertive() {
        XCTAssertTrue(ErrorDisplayMode.notFound.isAssertive)
        XCTAssertTrue(ErrorDisplayMode.unauthorized.isAssertive)
        XCTAssertTrue(ErrorDisplayMode.serverError.isAssertive)
        XCTAssertTrue(ErrorDisplayMode.unreachable.isAssertive)
    }
}

// MARK: - Density — the web `compact` prop

final class ErrorDisplayDensityTests: XCTestCase {
    func testComfortableMetrics() {
        let density = ErrorDisplayDensity.comfortable
        XCTAssertEqual(density.containerPadding, TSSpacing.lg)
        XCTAssertEqual(density.rowSpacing, TSSpacing.md)
        XCTAssertEqual(density.iconBoxPadding, TSSpacing.sm)
        XCTAssertEqual(density.iconPointSize, 16)
    }

    func testCompactMetrics() {
        let density = ErrorDisplayDensity.compact
        XCTAssertEqual(density.containerPadding, TSSpacing.md)
        XCTAssertEqual(density.rowSpacing, TSSpacing.sm)
        XCTAssertEqual(density.iconBoxPadding, TSSpacing.xs)
        XCTAssertEqual(density.iconPointSize, 14)
    }

    func testCompactIsStrictlyTighterThanComfortable() {
        let compact = ErrorDisplayDensity.compact
        let comfortable = ErrorDisplayDensity.comfortable
        XCTAssertLessThan(compact.containerPadding, comfortable.containerPadding)
        XCTAssertLessThan(compact.rowSpacing, comfortable.rowSpacing)
        XCTAssertLessThan(compact.iconBoxPadding, comfortable.iconBoxPadding)
        XCTAssertLessThan(compact.iconPointSize, comfortable.iconPointSize)
    }
}

// MARK: - Text — verbatim vs facade-resolved vs `{{thing}}`

final class ErrorDisplayTextTests: XCTestCase {
    func testVerbatimIgnoresResolver() {
        XCTAssertEqual(ErrorDisplayText.verbatim("Drive").resolve(keyResolver), "Drive")
        XCTAssertEqual(ErrorDisplayText.verbatim("Drive").resolve(identityResolver), "Drive")
    }

    func testLocalizedUsesResolver() {
        let text = ErrorDisplayText.localized(key: "error.retry", fallback: "Retry")
        XCTAssertEqual(text.resolve(identityResolver), "Retry")
        XCTAssertEqual(text.resolve(keyResolver), "error.retry")
    }

    func testNotFoundTitleInterpolatesVerbatimThing() {
        let title = ErrorDisplayText.notFoundTitle(thing: .verbatim("Drive"))
        XCTAssertEqual(title.resolve(identityResolver), "Drive not found")
    }

    func testNotFoundTitleInterpolatesLocalizedThing() {
        let title = ErrorDisplayText.notFoundTitle(
            thing: .localized(key: "error.notFound.thingDefault", fallback: "Resource")
        )
        XCTAssertEqual(title.resolve(identityResolver), "Resource not found")
    }

    func testNotFoundTitleUsesTitleTemplateKey() {
        let title = ErrorDisplayText.notFoundTitle(thing: .verbatim("Drive"))
        XCTAssertEqual(title.resolve(keyResolver), "error.notFound.title")
    }
}

// MARK: - Content — per-branch copy + CTA

final class ErrorDisplayContentTests: XCTestCase {
    func testNotFoundUsesResourceNameAndListHref() throws {
        let content = ErrorDisplayContent.make(
            mode: .notFound,
            resourceName: "Drive",
            listHref: "/drives",
            canRetry: true
        )
        XCTAssertEqual(content.title.resolve(identityResolver), "Drive not found")
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .backToList)
        XCTAssertEqual(action.destination, "/drives")
        XCTAssertTrue(action.isEnabled)
        XCTAssertEqual(action.label.resolve(keyResolver), "error.notFound.cta")
    }

    func testNotFoundDefaultThingWhenNoResourceName() {
        let content = ErrorDisplayContent.make(mode: .notFound, resourceName: nil, listHref: "/x", canRetry: true)
        XCTAssertEqual(content.title.resolve(identityResolver), "Resource not found")
    }

    func testNotFoundHasNoActionWithoutListHref() {
        let content = ErrorDisplayContent.make(mode: .notFound, resourceName: "Drive", listHref: nil, canRetry: true)
        XCTAssertNil(content.action)
    }

    func testUnauthorizedSignInTargetsLogin() throws {
        let content = ErrorDisplayContent.make(mode: .unauthorized, resourceName: nil, listHref: nil, canRetry: false)
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .signIn)
        XCTAssertEqual(action.destination, "/login")
        XCTAssertTrue(action.isEnabled)
    }

    func testServerErrorRetryGatedByCapability() throws {
        let withRetry = ErrorDisplayContent.make(mode: .serverError, resourceName: nil, listHref: nil, canRetry: true)
        let action = try XCTUnwrap(withRetry.action)
        XCTAssertEqual(action.kind, .retry)
        XCTAssertTrue(action.isEnabled)

        let noRetry = ErrorDisplayContent.make(mode: .serverError, resourceName: nil, listHref: nil, canRetry: false)
        XCTAssertNil(noRetry.action)
    }

    func testUnreachableRetryIsEnabled() throws {
        let content = ErrorDisplayContent.make(mode: .unreachable, resourceName: nil, listHref: nil, canRetry: true)
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .retry)
        XCTAssertTrue(action.isEnabled)
        XCTAssertEqual(content.title.resolve(keyResolver), "error.network.title")
    }

    func testOfflineRetryWhenOnlineIsDisabled() throws {
        let content = ErrorDisplayContent.make(mode: .offline, resourceName: nil, listHref: nil, canRetry: true)
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .retryWhenOnline)
        XCTAssertFalse(action.isEnabled)
        XCTAssertEqual(action.label.resolve(keyResolver), "error.network.retryWhenOnline")
        XCTAssertEqual(content.title.resolve(keyResolver), "error.network.offlineTitle")
    }

    func testOfflineHasNoActionWithoutRetryCapability() {
        let content = ErrorDisplayContent.make(mode: .offline, resourceName: nil, listHref: nil, canRetry: false)
        XCTAssertNil(content.action)
    }

    func testContentSymbolMatchesMode() {
        let content = ErrorDisplayContent.make(mode: .serverError, resourceName: nil, listHref: nil, canRetry: true)
        XCTAssertEqual(content.symbolName, ErrorDisplayMode.serverError.symbolName)
        XCTAssertTrue(content.isAssertive)
    }
}

// MARK: - Projection — render branches + P4 leaf contract

final class ErrorDisplayProjectionTests: XCTestCase {
    func testFailurePhaseRendersClassifiedContent() throws {
        let resolved = ErrorDisplayProjection.resolve(
            input: ErrorDisplayInput(failure: .http(404), resourceName: "Drive", listHref: "/drives"),
            canRetry: true
        )
        XCTAssertEqual(resolved.phase, .failure)
        let content = try XCTUnwrap(resolved.content)
        XCTAssertEqual(content.mode, .notFound)
        XCTAssertEqual(content.action?.destination, "/drives")
    }

    func testLoadingWhenNoFailureAndFlagged() {
        let resolved = ErrorDisplayProjection.resolve(input: ErrorDisplayInput(isLoading: true), canRetry: true)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.content)
    }

    func testEmptyWhenNoFailureAndNotLoading() {
        let resolved = ErrorDisplayProjection.resolve(input: ErrorDisplayInput(), canRetry: true)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.content)
    }

    func testFailureTakesPrecedenceOverLoading() {
        let resolved = ErrorDisplayProjection.resolve(
            input: ErrorDisplayInput(failure: .http(500), isLoading: true),
            canRetry: true
        )
        XCTAssertEqual(resolved.phase, .failure)
        XCTAssertEqual(resolved.content?.mode, .serverError)
    }

    func testRetryCapabilityFlowsThroughToContent() {
        let withRetry = ErrorDisplayProjection.resolve(input: ErrorDisplayInput(failure: .http(500)), canRetry: true)
        XCTAssertNotNil(withRetry.content?.action)
        let noRetry = ErrorDisplayProjection.resolve(input: ErrorDisplayInput(failure: .http(500)), canRetry: false)
        XCTAssertNil(noRetry.content?.action)
    }
}

// MARK: - Input — derived connectivity + density axes

final class ErrorDisplayInputAxesTests: XCTestCase {
    func testLiveWhenOnlineAndFresh() {
        XCTAssertEqual(ErrorDisplayInput(online: true, isStale: false).connection, .live)
    }

    func testStaleWhenOnlineButStale() {
        XCTAssertEqual(ErrorDisplayInput(online: true, isStale: true).connection, .stale)
    }

    func testOfflineWhenNotOnline() {
        XCTAssertEqual(ErrorDisplayInput(online: false, isStale: false).connection, .offline)
    }

    func testOfflineWinsOverStale() {
        XCTAssertEqual(ErrorDisplayInput(online: false, isStale: true).connection, .offline)
    }

    func testDensityDerivedFromCompactFlag() {
        XCTAssertEqual(ErrorDisplayInput(compact: true).density, .compact)
        XCTAssertEqual(ErrorDisplayInput(compact: false).density, .comfortable)
    }
}

// MARK: - Accessibility

final class ErrorDisplayAccessibilityTests: XCTestCase {
    func testLabelReadsTitleThenMessage() {
        let label = ErrorDisplayAccessibility.label(title: "Sign in required", message: "Your session has expired")
        XCTAssertEqual(label, "Sign in required. Your session has expired")
    }

    func testLabelMessageOnlyWhenNoTitle() {
        XCTAssertEqual(ErrorDisplayAccessibility.label(title: "", message: "Server error"), "Server error")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = ErrorDisplayAccessibility.label(title: "You're offline.", message: "Reconnecting soon.")
        XCTAssertEqual(label, "You're offline. Reconnecting soon.")
    }

    func testLabelEmptyWhenBothEmpty() {
        XCTAssertEqual(ErrorDisplayAccessibility.label(title: "", message: ""), "")
    }
}
