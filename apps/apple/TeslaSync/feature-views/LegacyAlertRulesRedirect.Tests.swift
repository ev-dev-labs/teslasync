//
//  LegacyAlertRulesRedirect.Tests.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  Unit coverage for the LegacyAlertRulesRedirect surface:
//    • Adapter (location → destination) — `LegacyAlertRulesRedirectResolver` value parity with the web
//      source `` <Navigate to={`/notifications/rules${search}`} replace /> ``: the constant target, the
//      verbatim-search passthrough, the `replace` semantics, the native route decomposition, the empty
//      query case, the parent fallback, and the phase matrix.
//    • Query parsing — `AlertRulesRedirectQuery` / `AlertRulesRedirectLocation` (leading `?`, valueless
//      flags, `=` in value).
//    • State holder — `LegacyAlertRulesRedirectModel` automatic single-fire redirect, the manual
//      Continue + empty-state parent fallback + error retry, phase resolution, the P1/S11 `view.opened`
//      telemetry, and the stale auto-refresh / offline wiring.
//    • Accessibility — the per-phase summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no router and no real store: the model
//  is driven by `InMemoryLegacyAlertRulesRedirectSource` and a recording navigation seam.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: inbound location → navigation target (port parity with the web source)

@MainActor final class LegacyAlertRulesRedirectResolverTests: XCTestCase {
    func testDestinationTargetsRulesAndPreservesSearchVerbatim() {
        let location = AlertRulesRedirectLocation(path: "/alert-rules", rawQuery: "rule_id=42&utm_source=email")
        let destination = LegacyAlertRulesRedirectResolver.destination(for: location)

        XCTAssertEqual(destination.path, "/notifications/rules")
        XCTAssertEqual(destination.search, "?rule_id=42&utm_source=email")
        // Web `` `/notifications/rules${search}` `` — exact string concatenation, no re-encoding.
        XCTAssertEqual(destination.fullPath, "/notifications/rules?rule_id=42&utm_source=email")
        XCTAssertEqual(destination.routeSlug, "notifications")
        XCTAssertEqual(destination.subPath, "rules")
        XCTAssertTrue(destination.replace)
    }

    func testDestinationWithNoQueryHasNoQuestionMark() {
        let destination = LegacyAlertRulesRedirectResolver.destination(for: AlertRulesRedirectLocation())
        XCTAssertEqual(destination.search, "")
        XCTAssertEqual(destination.fullPath, "/notifications/rules")
        XCTAssertTrue(destination.queryItems.isEmpty)
    }

    func testDestinationForwardsParsedQueryItems() {
        let location = AlertRulesRedirectLocation(path: "/alert-rules", rawQuery: "rule_id=42&utm_source=email")
        let destination = LegacyAlertRulesRedirectResolver.destination(for: location)
        XCTAssertEqual(destination.queryItems, [
            AlertRulesRedirectQueryItem(name: "rule_id", value: "42"),
            AlertRulesRedirectQueryItem(name: "utm_source", value: "email")
        ])
    }

    func testParentDestinationIsRouteRootWithoutQuery() {
        let parent = LegacyAlertRulesRedirectResolver.parentDestination()
        XCTAssertEqual(parent.path, "/notifications")
        XCTAssertEqual(parent.search, "")
        XCTAssertEqual(parent.subPath, "")
        XCTAssertEqual(parent.routeSlug, "notifications")
        XCTAssertTrue(parent.queryItems.isEmpty)
        XCTAssertTrue(parent.replace)
    }

    func testDestinationForStatusOnlyWhenResolved() {
        let location = AlertRulesRedirectLocation(rawQuery: "a=1")
        XCTAssertNotNil(LegacyAlertRulesRedirectResolver.destination(for: .resolved(location)))
        XCTAssertNil(LegacyAlertRulesRedirectResolver.destination(for: .idle))
        XCTAssertNil(LegacyAlertRulesRedirectResolver.destination(for: .resolving))
        XCTAssertNil(LegacyAlertRulesRedirectResolver.destination(for: .unavailable))
        XCTAssertNil(LegacyAlertRulesRedirectResolver.destination(for: .failed("boom")))
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(LegacyAlertRulesRedirectResolver.resolvePhase(.idle), .redirecting)
        XCTAssertEqual(LegacyAlertRulesRedirectResolver.resolvePhase(.resolving), .redirecting)
        XCTAssertEqual(
            LegacyAlertRulesRedirectResolver.resolvePhase(.resolved(AlertRulesRedirectLocation())),
            .resolved
        )
        XCTAssertEqual(LegacyAlertRulesRedirectResolver.resolvePhase(.unavailable), .empty)
        XCTAssertEqual(LegacyAlertRulesRedirectResolver.resolvePhase(.failed("x")), .error("x"))
    }
}

// MARK: - Query parsing

@MainActor final class LegacyAlertRulesRedirectQueryTests: XCTestCase {
    func testParseSplitsPairs() {
        XCTAssertEqual(AlertRulesRedirectQuery.parse("rule_id=42&utm_source=email"), [
            AlertRulesRedirectQueryItem(name: "rule_id", value: "42"),
            AlertRulesRedirectQueryItem(name: "utm_source", value: "email")
        ])
    }

    func testParseStripsLeadingQuestionMark() {
        XCTAssertEqual(AlertRulesRedirectQuery.parse("?a=1"), [AlertRulesRedirectQueryItem(name: "a", value: "1")])
    }

    func testParseEmptyYieldsNoItems() {
        XCTAssertTrue(AlertRulesRedirectQuery.parse("").isEmpty)
        XCTAssertTrue(AlertRulesRedirectQuery.parse("?").isEmpty)
    }

    func testParseValuelessFlagHasNilValue() {
        XCTAssertEqual(
            AlertRulesRedirectQuery.parse("compact"),
            [AlertRulesRedirectQueryItem(name: "compact", value: nil)]
        )
    }

    func testParseKeepsEqualsInsideValue() {
        XCTAssertEqual(
            AlertRulesRedirectQuery.parse("token=a=b=c"),
            [AlertRulesRedirectQueryItem(name: "token", value: "a=b=c")]
        )
    }

    func testLocationSearchReproducesWebLocationSearch() {
        XCTAssertEqual(AlertRulesRedirectLocation(rawQuery: "a=1").search, "?a=1")
        XCTAssertEqual(AlertRulesRedirectLocation(rawQuery: "?a=1").search, "?a=1")
        XCTAssertEqual(AlertRulesRedirectLocation().search, "")
    }
}

// MARK: - State holder: automatic redirect, fallbacks, phase, telemetry

@MainActor final class LegacyAlertRulesRedirectModelTests: XCTestCase {
    private let deepLink = AlertRulesRedirectLocation(path: "/alert-rules", rawQuery: "rule_id=42&utm_source=email")

    private func makeModel(
        initial: LegacyAlertRulesRedirectUpdate?,
        telemetry: LegacyAlertRulesRedirectTelemetry = OSLogLegacyAlertRulesRedirectTelemetry(),
        onRedirect: @escaping @MainActor (AlertRulesRedirectDestination) -> Void = { _ in }
    ) -> (LegacyAlertRulesRedirectModel, InMemoryLegacyAlertRulesRedirectSource) {
        let source = InMemoryLegacyAlertRulesRedirectSource(initial: initial)
        let model = LegacyAlertRulesRedirectModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            onRedirect: onRedirect
        )
        return (model, source)
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyLegacyAlertRulesRedirectTelemetry()
        let (model, source) = makeModel(initial: LegacyAlertRulesRedirectUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LegacyAlertRulesRedirect.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testResolvedInitialAutoRedirectsExactlyOnce() {
        var dispatched: [AlertRulesRedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink)),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertEqual(dispatched.count, 1)
        XCTAssertEqual(dispatched.first?.fullPath, "/notifications/rules?rule_id=42&utm_source=email")
        XCTAssertTrue(dispatched.first?.replace ?? false)
    }

    func testAutoRedirectDoesNotFireBeforeStart() {
        var dispatched: [AlertRulesRedirectDestination] = []
        _ = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink)),
            onRedirect: { dispatched.append($0) }
        )
        XCTAssertTrue(dispatched.isEmpty)
    }

    func testLateResolvedLocationAutoRedirectsOnce() {
        var dispatched: [AlertRulesRedirectDestination] = []
        let (model, source) = makeModel(initial: nil, onRedirect: { dispatched.append($0) })
        model.start()
        XCTAssertEqual(model.phase, .redirecting)
        XCTAssertTrue(dispatched.isEmpty)

        source.push(LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink)))
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertEqual(dispatched.count, 1)

        source.push(LegacyAlertRulesRedirectUpdate(status: .resolved(AlertRulesRedirectLocation(rawQuery: "x=2"))))
        XCTAssertEqual(dispatched.count, 1, "the automatic replace fires once, like web <Navigate replace>")
    }

    func testUnavailableShowsEmptyAndDoesNotRedirect() {
        var dispatched: [AlertRulesRedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .unavailable),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.destination)
        XCTAssertTrue(dispatched.isEmpty)
    }

    func testFailedShowsErrorAndDoesNotRedirect() {
        var dispatched: [AlertRulesRedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .failed("boom")),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
        XCTAssertTrue(dispatched.isEmpty)
    }

    func testConfirmReissuesNavigationToResolvedTarget() {
        var dispatched: [AlertRulesRedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink)),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        model.confirm()
        XCTAssertEqual(dispatched.count, 2)
        XCTAssertEqual(dispatched.last?.fullPath, "/notifications/rules?rule_id=42&utm_source=email")
    }

    func testGoToParentDispatchesParentDestination() {
        var dispatched: [AlertRulesRedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .unavailable),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        model.goToParent()
        XCTAssertEqual(dispatched.count, 1)
        XCTAssertEqual(dispatched.first?.path, "/notifications")
        XCTAssertEqual(dispatched.first?.subPath, "")
        XCTAssertEqual(dispatched.first?.search, "")
    }

    func testRetryDelegatesToSource() {
        let (model, source) = makeModel(initial: LegacyAlertRulesRedirectUpdate(status: .failed("x")))
        model.start()
        model.retry()
        model.retry()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let live = LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink), connection: .live)
        let (model, source) = makeModel(initial: live)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(live)
        source.push(LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsResolvedWithoutRefresh() {
        let (model, source) = makeModel(
            initial: LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink), connection: .live)
        )
        model.start()
        source.push(LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testBreadcrumbReflectsForwardedParameters() {
        let (model, _) = makeModel(initial: LegacyAlertRulesRedirectUpdate(status: .resolved(deepLink)))
        model.start()
        XCTAssertEqual(model.breadcrumb.parentName, "Notifications")
        XCTAssertEqual(model.breadcrumb.destinationName, "Alert Rules")
        XCTAssertEqual(model.breadcrumb.forwardedParameterCount, 2)
    }
}

// MARK: - Accessibility summaries

@MainActor final class LegacyAlertRulesRedirectAccessibilityTests: XCTestCase {
    private let passthrough: (String, String) -> String = { _, value in value }

    func testSummaryForEachPhase() {
        XCTAssertEqual(summary(.redirecting), "Redirecting to Alert Rules")
        XCTAssertEqual(summary(.resolved), "Opening Alert Rules")
        XCTAssertEqual(summary(.empty), "Alert Rules is unavailable")
        XCTAssertEqual(summary(.error("x")), "Couldn't open Alert Rules")
    }

    @MainActor
    func testModelAccessibilitySummaryResolvesEnglish() {
        let source = InMemoryLegacyAlertRulesRedirectSource(
            initial: LegacyAlertRulesRedirectUpdate(status: .resolved(AlertRulesRedirectLocation()))
        )
        let model = LegacyAlertRulesRedirectModel(source: source, copy: .fallback)
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Opening Alert Rules")
    }

    private func summary(_ phase: AlertRulesRedirectPhase) -> String {
        LegacyAlertRulesRedirectAccessibility.summary(
            for: phase,
            destination: "Alert Rules",
            localize: passthrough
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLegacyAlertRulesRedirectTelemetry: LegacyAlertRulesRedirectTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
