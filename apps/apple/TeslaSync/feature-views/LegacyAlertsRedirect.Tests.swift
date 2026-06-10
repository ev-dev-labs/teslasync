//
//  LegacyAlertsRedirect.Tests.swift
//  TeslaSync — P4 feature view · 0185 · LegacyAlertsRedirect (Apple)
//
//  Host-free unit coverage for the legacy alerts redirect:
//    • Adapter (the parity core) — `LegacyAlertsRedirectResolver` reproduces the web
//      component body exactly: the `tab` map, the missing/unknown `?? alerts`
//      fallbacks, `params.delete('tab')` (every entry), source-order param forwarding,
//      and the `qs ? target?qs : target` assembly.
//    • Tab map — raw values + paths == web TAB_TO_ROUTE; the alerts fallback.
//    • State holder — `LegacyAlertsRedirectModel` emits `view.opened` once and
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

@MainActor final class LegacyAlertsRedirectResolverTests: XCTestCase {
    private func resolve(_ search: String) -> ResolvedAlertsRedirect {
        LegacyAlertsRedirectResolver.resolve(LegacyAlertsLocation(search: search))
    }

    func testEmptySearchDefaultsToAlerts() {
        // web `/alerts` → `/notifications/alerts`
        let resolved = resolve("")
        XCTAssertEqual(resolved.tab, .alerts)
        XCTAssertTrue(resolved.usedFallback)
        XCTAssertTrue(resolved.forwardedItems.isEmpty)
        XCTAssertEqual(resolved.target, "/notifications/alerts")
    }

    func testEachKnownTabMapsToItsRoute() {
        // web TAB_TO_ROUTE — note keys deliberately differ from their path segment.
        XCTAssertEqual(resolve("?tab=alerts").target, "/notifications/alerts")
        XCTAssertEqual(resolve("?tab=history").target, "/notifications/inbox")
        XCTAssertEqual(resolve("?tab=preferences").target, "/notifications/quiet-hours")
    }

    func testDocumentedRedirectExamples() {
        // The four examples spelled out in the web source header comment.
        XCTAssertEqual(resolve("").target, "/notifications/alerts")
        XCTAssertEqual(resolve("?tab=alerts&filter=open").target, "/notifications/alerts?filter=open")
        XCTAssertEqual(resolve("?tab=history").target, "/notifications/inbox")
        XCTAssertEqual(resolve("?tab=preferences").target, "/notifications/quiet-hours")
    }

    func testKnownTabIsNotAFallback() {
        XCTAssertFalse(resolve("?tab=history").usedFallback)
        XCTAssertFalse(resolve("?tab=alerts").usedFallback)
        XCTAssertFalse(resolve("?tab=preferences").usedFallback)
    }

    func testUnknownTabFallsBackToAlerts() {
        // web `TAB_TO_ROUTE[tab] ?? '/notifications/alerts'`
        let resolved = resolve("?tab=archived")
        XCTAssertEqual(resolved.tab, .alerts)
        XCTAssertTrue(resolved.usedFallback)
        XCTAssertEqual(resolved.target, "/notifications/alerts")
    }

    func testForwardsRemainingParamsInSourceOrder() {
        let resolved = resolve("?tab=history&filter=open&severity=high")
        XCTAssertEqual(resolved.tab, .history)
        XCTAssertEqual(
            resolved.forwardedItems,
            [URLQueryItem(name: "filter", value: "open"), URLQueryItem(name: "severity", value: "high")]
        )
        XCTAssertEqual(resolved.target, "/notifications/inbox?filter=open&severity=high")
    }

    func testDeletesEveryTabEntryAndKeepsFirstAsDestination() {
        // web `params.get('tab')` = first; `params.delete('tab')` removes them all.
        let resolved = resolve("?tab=history&foo=1&tab=preferences")
        XCTAssertEqual(resolved.tab, .history)
        XCTAssertEqual(resolved.forwardedItems, [URLQueryItem(name: "foo", value: "1")])
        XCTAssertEqual(resolved.target, "/notifications/inbox?foo=1")
    }

    func testOnlyTabParamProducesBarePath() {
        // web `qs ? target?qs : target` → no trailing `?`
        XCTAssertEqual(resolve("?tab=preferences").target, "/notifications/quiet-hours")
    }

    func testLeadingQuestionMarkIsOptional() {
        XCTAssertEqual(
            LegacyAlertsRedirectResolver.parseQuery("?a=1&b=2"),
            LegacyAlertsRedirectResolver.parseQuery("a=1&b=2")
        )
    }

    func testQueryRoundTripsThroughEncode() {
        let items = [
            URLQueryItem(name: "q", value: "a b&c"),
            URLQueryItem(name: "flag", value: "x=y")
        ]
        let encoded = LegacyAlertsRedirectResolver.encodeQuery(items)
        // Special chars are percent-encoded so the re-assembled query is unambiguous.
        XCTAssertEqual(encoded, "q=a%20b%26c&flag=x%3Dy")
        XCTAssertEqual(LegacyAlertsRedirectResolver.parseQuery(encoded), items)
    }

    func testValuelessParamIsForwarded() {
        let resolved = resolve("?tab=alerts&compact")
        XCTAssertEqual(resolved.forwardedItems, [URLQueryItem(name: "compact", value: nil)])
        XCTAssertEqual(resolved.target, "/notifications/alerts?compact")
    }
}

// MARK: - Tab map parity (web TAB_TO_ROUTE)

@MainActor final class AlertsRedirectTabTests: XCTestCase {
    func testRawValuesMatchWebTabKeys() {
        XCTAssertEqual(AlertsRedirectTab.allCases.map(\.rawValue), ["alerts", "history", "preferences"])
    }

    func testPathsMatchWebRouteValues() {
        XCTAssertEqual(AlertsRedirectTab.alerts.path, "/notifications/alerts")
        XCTAssertEqual(AlertsRedirectTab.history.path, "/notifications/inbox")
        XCTAssertEqual(AlertsRedirectTab.preferences.path, "/notifications/quiet-hours")
    }

    func testBasePathAndFallback() {
        XCTAssertEqual(AlertsRedirectTab.basePath, "/notifications")
        XCTAssertEqual(AlertsRedirectTab.fallback, .alerts)
    }

    func testTabParameterInitFoldsMissingAndUnknownOntoAlerts() {
        XCTAssertEqual(AlertsRedirectTab(tabParameter: nil), .alerts)
        XCTAssertEqual(AlertsRedirectTab(tabParameter: "nope"), .alerts)
        XCTAssertEqual(AlertsRedirectTab(tabParameter: "preferences"), .preferences)
    }
}

// MARK: - State holder + telemetry (P1/S8 + P1/S11)

@MainActor final class LegacyAlertsRedirectModelTests: XCTestCase {
    private func makeModel(
        search: String,
        telemetry: any LegacyAlertsRedirectTelemetry,
        router: InMemoryLegacyAlertsRedirectRouter
    ) -> LegacyAlertsRedirectModel {
        LegacyAlertsRedirectModel(
            source: InMemoryLegacyAlertsRedirectSource(
                location: LegacyAlertsLocation(search: search)
            ),
            router: router,
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndDispatchesReplaceOnce() {
        let spy = LegacyAlertsRedirectSpyTelemetry()
        let router = InMemoryLegacyAlertsRedirectRouter()
        let model = makeModel(search: "?tab=history&foo=1", telemetry: spy, router: router)

        model.start()

        XCTAssertEqual(spy.openedSurfaces, ["LegacyAlertsRedirect"])
        XCTAssertEqual(router.targets, ["/notifications/inbox?foo=1"])
        XCTAssertEqual(model.destination?.tab, .history)
        if case .redirecting = model.phase {} else { XCTFail("expected .redirecting") }
    }

    func testStartIsIdempotent() {
        let spy = LegacyAlertsRedirectSpyTelemetry()
        let router = InMemoryLegacyAlertsRedirectRouter()
        let model = makeModel(search: "?tab=preferences", telemetry: spy, router: router)

        model.start()
        model.start()

        XCTAssertEqual(spy.openedSurfaces, ["LegacyAlertsRedirect"])
        XCTAssertEqual(router.replacements.count, 1)
    }

    func testFurtherLocationPushDoesNotRedispatch() {
        let router = InMemoryLegacyAlertsRedirectRouter()
        let source = InMemoryLegacyAlertsRedirectSource(
            location: LegacyAlertsLocation(search: "?tab=alerts")
        )
        let model = LegacyAlertsRedirectModel(
            source: source,
            router: router,
            telemetry: LegacyAlertsRedirectSpyTelemetry()
        )

        model.start()
        source.push(LegacyAlertsLocation(search: "?tab=preferences"))

        // web `<Navigate replace>` fires once; the latest destination still updates.
        XCTAssertEqual(router.replacements.count, 1)
        XCTAssertEqual(model.destination?.tab, .preferences)
    }

    func testRedirectNowReplaysTheResolvedTarget() {
        let router = InMemoryLegacyAlertsRedirectRouter()
        let model = makeModel(search: "?tab=history", telemetry: LegacyAlertsRedirectSpyTelemetry(), router: router)

        model.start()
        model.redirectNow()

        XCTAssertEqual(router.targets, ["/notifications/inbox", "/notifications/inbox"])
    }

    func testAccessibilitySummaryPerPhase() {
        let router = InMemoryLegacyAlertsRedirectRouter()
        let model = makeModel(search: "?tab=preferences", telemetry: LegacyAlertsRedirectSpyTelemetry(), router: router)

        XCTAssertEqual(model.accessibilitySummary, "Redirecting to Notifications")
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Redirecting to Quiet Hours")
    }

    func testSourceStartStopIsForwarded() {
        let router = InMemoryLegacyAlertsRedirectRouter()
        let source = InMemoryLegacyAlertsRedirectSource(
            location: LegacyAlertsLocation(search: "?tab=alerts")
        )
        let model = LegacyAlertsRedirectModel(
            source: source,
            router: router,
            telemetry: LegacyAlertsRedirectSpyTelemetry()
        )

        model.start()
        model.stop()

        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Telemetry slug (P1/S11 view.opened)

@MainActor final class LegacyAlertsRedirectSurfaceTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = LegacyAlertsRedirectSpyTelemetry()
        LegacyAlertsRedirectSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["LegacyAlertsRedirect"])
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LegacyAlertsRedirectSurface.slug, "LegacyAlertsRedirect")
        XCTAssertEqual(LegacyAlertsRedirectModel.surfaceSlug, LegacyAlertsRedirectSurface.slug)
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class LegacyAlertsRedirectSpyTelemetry: LegacyAlertsRedirectTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
