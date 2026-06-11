//
//  QueryError.Tests.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  Adapter + projection + state-holder coverage for the QueryError surface:
//    • Mode — the web branch ladder (`classify`: transient → 404 → 401/403 → 5xx → network/offline),
//      the per-mode SF Symbol, and the assertive/polite live-region intent.
//    • Text — verbatim (caller content) vs localized (facade-resolved) vs the `{{thing}}` 404 title.
//    • Content — the per-branch copy + CTA: the 404 Back-to-list gate (resourceName / listHref), the
//      401 Sign-in destination, and the 5xx / network Retry gate (`onRetry`) incl. the disabled
//      offline `Retry when online`.
//    • Projection — the render branches + the P4 leaf contract (failure → loading → empty) and the
//      retry-capability flow-through.
//    • Connection — the derived offline/stale/live axis (web `useOnlineStatus` + P4 freshness).
//    • Accessibility — the composed VoiceOver failure label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / projection directly. The `@MainActor` state-holder
//  behaviour (telemetry / CTA dispatch / auto-retry / freshness) lives in `QueryError.ModelTests`.
//

import XCTest
@testable import TeslaSync

private let identityResolver: QueryErrorResolve = { _, fallback in fallback }
private let keyResolver: QueryErrorResolve = { key, _ in key }

// MARK: - Mode — the web branch ladder

final class QueryErrorModeClassifyTests: XCTestCase {
    func testTransientWaitingWinsRegardlessOfStatus() {
        XCTAssertEqual(QueryErrorMode.classify(failure: .rateLimited, online: true), .waiting)
        XCTAssertEqual(QueryErrorMode.classify(failure: .upstreamUnavailable, online: true), .waiting)
        // Even offline, transient wins (web checks isTransientWaiting before everything else).
        XCTAssertEqual(QueryErrorMode.classify(failure: .upstreamUnavailable, online: false), .waiting)
    }

    func testNotFound() {
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(404), online: true), .notFound)
    }

    func testUnauthorized() {
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(401), online: true), .unauthorized)
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(403), online: true), .unauthorized)
    }

    func testServerError() {
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(500), online: true), .serverError)
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(502), online: true), .serverError)
    }

    func testUnreachableWhenOnlineAndNoStatus() {
        XCTAssertEqual(QueryErrorMode.classify(failure: .network, online: true), .unreachable)
    }

    func testOfflineWhenBrowserOffline() {
        XCTAssertEqual(QueryErrorMode.classify(failure: .network, online: false), .offline)
    }

    func testOfflineSentinelStatusZeroIsOfflineEvenWhenOnline() {
        // Web: `isOffline = !online || status === 0` — the status-0 fetch sentinel forces offline.
        XCTAssertEqual(QueryErrorMode.classify(failure: .offline, online: true), .offline)
    }

    func testUnmatchedClientStatusFallsThroughToNetworkBranch() {
        // A 4xx that is not 404/401/403 (e.g. 400, 418) falls to the network/unknown branch.
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(400), online: true), .unreachable)
        XCTAssertEqual(QueryErrorMode.classify(failure: .http(418), online: false), .offline)
    }
}

// MARK: - Mode — symbols + live region

final class QueryErrorModeSymbolTests: XCTestCase {
    func testEachModeHasADistinctNonEmptySymbol() {
        let symbols = QueryErrorMode.allCases.map(\.symbolName)
        XCTAssertEqual(Set(symbols).count, QueryErrorMode.allCases.count)
        XCTAssertFalse(symbols.contains(""))
    }

    func testSymbolsAreStable() {
        XCTAssertEqual(QueryErrorMode.waiting.symbolName, "clock")
        XCTAssertEqual(QueryErrorMode.notFound.symbolName, "doc.questionmark")
        XCTAssertEqual(QueryErrorMode.unauthorized.symbolName, "lock.fill")
        XCTAssertEqual(QueryErrorMode.serverError.symbolName, "server.rack")
        XCTAssertEqual(QueryErrorMode.unreachable.symbolName, "exclamationmark.circle.fill")
        XCTAssertEqual(QueryErrorMode.offline.symbolName, "wifi.slash")
    }
}

final class QueryErrorModeLiveRegionTests: XCTestCase {
    func testWaitingAndOfflineArePolite() {
        XCTAssertFalse(QueryErrorMode.waiting.isAssertive)
        XCTAssertFalse(QueryErrorMode.offline.isAssertive)
    }

    func testFailureBranchesAreAssertive() {
        XCTAssertTrue(QueryErrorMode.notFound.isAssertive)
        XCTAssertTrue(QueryErrorMode.unauthorized.isAssertive)
        XCTAssertTrue(QueryErrorMode.serverError.isAssertive)
        XCTAssertTrue(QueryErrorMode.unreachable.isAssertive)
    }
}

// MARK: - Text — verbatim vs facade-resolved vs `{{thing}}`

final class QueryErrorTextTests: XCTestCase {
    func testVerbatimIgnoresResolver() {
        XCTAssertEqual(QueryErrorText.verbatim("Drive").resolve(keyResolver), "Drive")
        XCTAssertEqual(QueryErrorText.verbatim("Drive").resolve(identityResolver), "Drive")
    }

    func testLocalizedUsesResolver() {
        let text = QueryErrorText.localized(key: "error.retry", fallback: "Retry")
        XCTAssertEqual(text.resolve(identityResolver), "Retry")
        XCTAssertEqual(text.resolve(keyResolver), "error.retry")
    }

    func testNotFoundTitleInterpolatesVerbatimThing() {
        let title = QueryErrorText.notFoundTitle(thing: .verbatim("Drive"))
        XCTAssertEqual(title.resolve(identityResolver), "Drive not found")
    }

    func testNotFoundTitleInterpolatesLocalizedThing() {
        let title = QueryErrorText.notFoundTitle(
            thing: .localized(key: "error.notFound.thingDefault", fallback: "Resource")
        )
        XCTAssertEqual(title.resolve(identityResolver), "Resource not found")
    }

    func testNotFoundTitleUsesTitleTemplateKey() {
        // The key resolver returns the key for the title template; the nested thing resolves to its
        // own key, so the interpolation substitutes the thing key into the template key.
        let title = QueryErrorText.notFoundTitle(thing: .verbatim("Drive"))
        XCTAssertEqual(title.resolve(keyResolver), "error.notFound.title")
    }
}

// MARK: - Content — per-branch copy + CTA

final class QueryErrorContentTests: XCTestCase {
    func testWaitingHasNoAction() {
        let content = QueryErrorContent.make(mode: .waiting, resourceName: nil, listHref: nil, canRetry: true)
        XCTAssertNil(content.action)
        XCTAssertEqual(content.title.resolve(keyResolver), "error.waiting.title")
        XCTAssertEqual(content.message.resolve(keyResolver), "error.waiting.message")
        XCTAssertEqual(content.symbolName, "clock")
    }

    func testNotFoundUsesResourceNameAndListHref() throws {
        let content = QueryErrorContent.make(
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
        let content = QueryErrorContent.make(mode: .notFound, resourceName: nil, listHref: "/x", canRetry: true)
        XCTAssertEqual(content.title.resolve(identityResolver), "Resource not found")
    }

    func testNotFoundHasNoActionWithoutListHref() {
        let content = QueryErrorContent.make(mode: .notFound, resourceName: "Drive", listHref: nil, canRetry: true)
        XCTAssertNil(content.action)
    }

    func testUnauthorizedSignInTargetsLogin() throws {
        let content = QueryErrorContent.make(mode: .unauthorized, resourceName: nil, listHref: nil, canRetry: false)
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .signIn)
        XCTAssertEqual(action.destination, "/login")
        XCTAssertTrue(action.isEnabled)
    }

    func testServerErrorRetryGatedByCapability() throws {
        let withRetry = QueryErrorContent.make(mode: .serverError, resourceName: nil, listHref: nil, canRetry: true)
        let action = try XCTUnwrap(withRetry.action)
        XCTAssertEqual(action.kind, .retry)
        XCTAssertTrue(action.isEnabled)

        let noRetry = QueryErrorContent.make(mode: .serverError, resourceName: nil, listHref: nil, canRetry: false)
        XCTAssertNil(noRetry.action)
    }

    func testUnreachableRetryIsEnabled() throws {
        let content = QueryErrorContent.make(mode: .unreachable, resourceName: nil, listHref: nil, canRetry: true)
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .retry)
        XCTAssertTrue(action.isEnabled)
        XCTAssertEqual(content.title.resolve(keyResolver), "error.network.title")
    }

    func testOfflineRetryWhenOnlineIsDisabled() throws {
        let content = QueryErrorContent.make(mode: .offline, resourceName: nil, listHref: nil, canRetry: true)
        let action = try XCTUnwrap(content.action)
        XCTAssertEqual(action.kind, .retryWhenOnline)
        XCTAssertFalse(action.isEnabled)
        XCTAssertEqual(action.label.resolve(keyResolver), "error.network.retryWhenOnline")
        XCTAssertEqual(content.title.resolve(keyResolver), "error.network.offlineTitle")
    }

    func testOfflineHasNoActionWithoutRetryCapability() {
        let content = QueryErrorContent.make(mode: .offline, resourceName: nil, listHref: nil, canRetry: false)
        XCTAssertNil(content.action)
    }
}

// MARK: - Projection — render branches + P4 leaf contract

final class QueryErrorProjectionTests: XCTestCase {
    func testFailurePhaseRendersClassifiedContent() throws {
        let resolved = QueryErrorProjection.resolve(
            input: QueryErrorInput(failure: .http(404), resourceName: "Drive", listHref: "/drives"),
            canRetry: true
        )
        XCTAssertEqual(resolved.phase, .failure)
        let content = try XCTUnwrap(resolved.content)
        XCTAssertEqual(content.mode, .notFound)
        XCTAssertEqual(content.action?.destination, "/drives")
    }

    func testLoadingWhenNoFailureAndFlagged() {
        let resolved = QueryErrorProjection.resolve(input: QueryErrorInput(isLoading: true), canRetry: true)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.content)
    }

    func testEmptyWhenNoFailureAndNotLoading() {
        let resolved = QueryErrorProjection.resolve(input: QueryErrorInput(), canRetry: true)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.content)
    }

    func testFailureTakesPrecedenceOverLoading() {
        let resolved = QueryErrorProjection.resolve(
            input: QueryErrorInput(failure: .http(500), isLoading: true),
            canRetry: true
        )
        XCTAssertEqual(resolved.phase, .failure)
        XCTAssertEqual(resolved.content?.mode, .serverError)
    }

    func testRetryCapabilityFlowsThroughToContent() {
        let withRetry = QueryErrorProjection.resolve(input: QueryErrorInput(failure: .http(500)), canRetry: true)
        XCTAssertNotNil(withRetry.content?.action)
        let noRetry = QueryErrorProjection.resolve(input: QueryErrorInput(failure: .http(500)), canRetry: false)
        XCTAssertNil(noRetry.content?.action)
    }
}

// MARK: - Connection — derived offline/stale/live axis

final class QueryErrorConnectionTests: XCTestCase {
    func testLiveWhenOnlineAndFresh() {
        XCTAssertEqual(QueryErrorInput(online: true, isStale: false).connection, .live)
    }

    func testStaleWhenOnlineButStale() {
        XCTAssertEqual(QueryErrorInput(online: true, isStale: true).connection, .stale)
    }

    func testOfflineWhenNotOnline() {
        XCTAssertEqual(QueryErrorInput(online: false, isStale: false).connection, .offline)
    }

    func testOfflineWinsOverStale() {
        XCTAssertEqual(QueryErrorInput(online: false, isStale: true).connection, .offline)
    }
}

// MARK: - Accessibility

final class QueryErrorAccessibilityTests: XCTestCase {
    func testLabelReadsTitleThenMessage() {
        let label = QueryErrorAccessibility.label(title: "Sign in required", message: "Your session has expired")
        XCTAssertEqual(label, "Sign in required. Your session has expired")
    }

    func testLabelMessageOnlyWhenNoTitle() {
        XCTAssertEqual(QueryErrorAccessibility.label(title: "", message: "Server error"), "Server error")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = QueryErrorAccessibility.label(title: "You're offline.", message: "Reconnecting soon.")
        XCTAssertEqual(label, "You're offline. Reconnecting soon.")
    }

    func testLabelEmptyWhenBothEmpty() {
        XCTAssertEqual(QueryErrorAccessibility.label(title: "", message: ""), "")
    }
}
