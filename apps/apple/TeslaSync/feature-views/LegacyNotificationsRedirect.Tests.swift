//
//  LegacyNotificationsRedirect.Tests.swift
//  TeslaSync — P4 feature view · 0187 · LegacyNotificationsRedirect (Apple)
//
//  Host-free unit coverage for the legacy notifications redirect:
//    • Adapter (the parity core) — `LegacyNotificationsRedirectResolver` reproduces the
//      web component body exactly: the `tab` map, the missing/unknown `?? inbox`
//      fallbacks, `params.delete('tab')` (every entry), source-order param forwarding,
//      and the `qs ? target?qs : target` assembly.
//    • Tab map — raw values + paths == web TAB_TO_ROUTE; the inbox fallback.
//    • State holder — `LegacyNotificationsRedirectModel` emits `view.opened` once and
//      dispatches the replace exactly once (web `<Navigate replace>`), plus the manual
//      continue affordance.
//    • Accessibility — the per-phase spoken summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no router, no KMP:
//  the model is driven by the in-memory source + router.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: location → resolved redirect (web component body parity)

@MainActor final class LegacyNotificationsRedirectResolverTests: XCTestCase {
    private func resolve(_ search: String) -> ResolvedRedirect {
        LegacyNotificationsRedirectResolver.resolve(LegacyNotificationsLocation(search: search))
    }

    func testEmptySearchDefaultsToInbox() {
        // web `/notifications` → `/notifications/inbox`
        let resolved = resolve("")
        XCTAssertEqual(resolved.tab, .inbox)
        XCTAssertTrue(resolved.usedFallback)
        XCTAssertTrue(resolved.forwardedItems.isEmpty)
        XCTAssertEqual(resolved.target, "/notifications/inbox")
    }

    func testEachKnownTabMapsToItsRoute() {
        XCTAssertEqual(resolve("?tab=inbox").target, "/notifications/inbox")
        XCTAssertEqual(resolve("?tab=archived").target, "/notifications/archived")
        XCTAssertEqual(resolve("?tab=channels").target, "/notifications/channels")
    }

    func testKnownTabIsNotAFallback() {
        XCTAssertFalse(resolve("?tab=archived").usedFallback)
        XCTAssertFalse(resolve("?tab=inbox").usedFallback)
    }

    func testUnknownTabFallsBackToInbox() {
        // web `TAB_TO_ROUTE[tab] ?? '/notifications/inbox'`
        let resolved = resolve("?tab=spam")
        XCTAssertEqual(resolved.tab, .inbox)
        XCTAssertTrue(resolved.usedFallback)
        XCTAssertEqual(resolved.target, "/notifications/inbox")
    }

    func testForwardsRemainingParamsInSourceOrder() {
        let resolved = resolve("?tab=archived&search=battery&unread=1")
        XCTAssertEqual(resolved.tab, .archived)
        XCTAssertEqual(
            resolved.forwardedItems,
            [URLQueryItem(name: "search", value: "battery"), URLQueryItem(name: "unread", value: "1")]
        )
        XCTAssertEqual(resolved.target, "/notifications/archived?search=battery&unread=1")
    }

    func testDeletesEveryTabEntryAndKeepsFirstAsDestination() {
        // web `params.get('tab')` = first; `params.delete('tab')` removes them all.
        let resolved = resolve("?tab=archived&foo=1&tab=channels")
        XCTAssertEqual(resolved.tab, .archived)
        XCTAssertEqual(resolved.forwardedItems, [URLQueryItem(name: "foo", value: "1")])
        XCTAssertEqual(resolved.target, "/notifications/archived?foo=1")
    }

    func testOnlyTabParamProducesBarePath() {
        // web `qs ? target?qs : target` → no trailing `?`
        XCTAssertEqual(resolve("?tab=channels").target, "/notifications/channels")
    }

    func testLeadingQuestionMarkIsOptional() {
        XCTAssertEqual(
            LegacyNotificationsRedirectResolver.parseQuery("?a=1&b=2"),
            LegacyNotificationsRedirectResolver.parseQuery("a=1&b=2")
        )
    }

    func testQueryRoundTripsThroughEncode() {
        let items = [
            URLQueryItem(name: "q", value: "a b&c"),
            URLQueryItem(name: "flag", value: "x=y")
        ]
        let encoded = LegacyNotificationsRedirectResolver.encodeQuery(items)
        // Special chars are percent-encoded so the re-assembled query is unambiguous.
        XCTAssertEqual(encoded, "q=a%20b%26c&flag=x%3Dy")
        XCTAssertEqual(LegacyNotificationsRedirectResolver.parseQuery(encoded), items)
    }

    func testValuelessParamIsForwarded() {
        let resolved = resolve("?tab=inbox&compact")
        XCTAssertEqual(resolved.forwardedItems, [URLQueryItem(name: "compact", value: nil)])
        XCTAssertEqual(resolved.target, "/notifications/inbox?compact")
    }
}

// MARK: - Tab map parity (web TAB_TO_ROUTE)

@MainActor final class NotificationsRedirectTabTests: XCTestCase {
    func testRawValuesMatchWebTabKeys() {
        XCTAssertEqual(NotificationsRedirectTab.allCases.map(\.rawValue), ["inbox", "archived", "channels"])
    }

    func testPathsMatchWebRouteValues() {
        XCTAssertEqual(NotificationsRedirectTab.inbox.path, "/notifications/inbox")
        XCTAssertEqual(NotificationsRedirectTab.archived.path, "/notifications/archived")
        XCTAssertEqual(NotificationsRedirectTab.channels.path, "/notifications/channels")
    }

    func testBasePathAndFallback() {
        XCTAssertEqual(NotificationsRedirectTab.basePath, "/notifications")
        XCTAssertEqual(NotificationsRedirectTab.fallback, .inbox)
    }

    func testTabParameterInitFoldsMissingAndUnknownOntoInbox() {
        XCTAssertEqual(NotificationsRedirectTab(tabParameter: nil), .inbox)
        XCTAssertEqual(NotificationsRedirectTab(tabParameter: "nope"), .inbox)
        XCTAssertEqual(NotificationsRedirectTab(tabParameter: "channels"), .channels)
    }
}

// MARK: - State holder + telemetry (P1/S8 + P1/S11)

@MainActor final class LegacyNotificationsRedirectModelTests: XCTestCase {
    private func makeModel(
        search: String,
        telemetry: any LegacyNotificationsRedirectTelemetry,
        router: InMemoryLegacyNotificationsRedirectRouter
    ) -> LegacyNotificationsRedirectModel {
        LegacyNotificationsRedirectModel(
            source: InMemoryLegacyNotificationsRedirectSource(
                location: LegacyNotificationsLocation(search: search)
            ),
            router: router,
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndDispatchesReplaceOnce() {
        let spy = LegacyNotificationsRedirectSpyTelemetry()
        let router = InMemoryLegacyNotificationsRedirectRouter()
        let model = makeModel(search: "?tab=archived&foo=1", telemetry: spy, router: router)

        model.start()

        XCTAssertEqual(spy.openedSurfaces, ["LegacyNotificationsRedirect"])
        XCTAssertEqual(router.targets, ["/notifications/archived?foo=1"])
        XCTAssertEqual(model.destination?.tab, .archived)
        if case .redirecting = model.phase {} else { XCTFail("expected .redirecting") }
    }

    func testStartIsIdempotent() {
        let spy = LegacyNotificationsRedirectSpyTelemetry()
        let router = InMemoryLegacyNotificationsRedirectRouter()
        let model = makeModel(search: "?tab=channels", telemetry: spy, router: router)

        model.start()
        model.start()

        XCTAssertEqual(spy.openedSurfaces, ["LegacyNotificationsRedirect"])
        XCTAssertEqual(router.replacements.count, 1)
    }

    func testFurtherLocationPushDoesNotRedispatch() {
        let router = InMemoryLegacyNotificationsRedirectRouter()
        let source = InMemoryLegacyNotificationsRedirectSource(
            location: LegacyNotificationsLocation(search: "?tab=inbox")
        )
        let model = LegacyNotificationsRedirectModel(
            source: source,
            router: router,
            telemetry: LegacyNotificationsRedirectSpyTelemetry()
        )

        model.start()
        source.push(LegacyNotificationsLocation(search: "?tab=channels"))

        // web `<Navigate replace>` fires once; the latest destination still updates.
        XCTAssertEqual(router.replacements.count, 1)
        XCTAssertEqual(model.destination?.tab, .channels)
    }

    func testRedirectNowReplaysTheResolvedTarget() {
        let router = InMemoryLegacyNotificationsRedirectRouter()
        let model = makeModel(
            search: "?tab=archived",
            telemetry: LegacyNotificationsRedirectSpyTelemetry(),
            router: router
        )

        model.start()
        model.redirectNow()

        XCTAssertEqual(router.targets, ["/notifications/archived", "/notifications/archived"])
    }

    func testAccessibilitySummaryPerPhase() {
        let router = InMemoryLegacyNotificationsRedirectRouter()
        let model = makeModel(
            search: "?tab=channels",
            telemetry: LegacyNotificationsRedirectSpyTelemetry(),
            router: router
        )

        XCTAssertEqual(model.accessibilitySummary, "Redirecting to Notifications")
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Redirecting to Channels")
    }
}

// MARK: - Telemetry slug (P1/S11 view.opened)

@MainActor final class LegacyNotificationsRedirectSurfaceTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = LegacyNotificationsRedirectSpyTelemetry()
        LegacyNotificationsRedirectSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["LegacyNotificationsRedirect"])
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LegacyNotificationsRedirectSurface.slug, "LegacyNotificationsRedirect")
        XCTAssertEqual(LegacyNotificationsRedirectModel.surfaceSlug, LegacyNotificationsRedirectSurface.slug)
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class LegacyNotificationsRedirectSpyTelemetry: LegacyNotificationsRedirectTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
