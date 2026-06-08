//
//  LegacyAlertStudioRedirect.Tests.swift
//  TeslaSync — P4 feature view · 0186 · LegacyAlertStudioRedirect (Apple)
//
//  Unit coverage for the LegacyAlertStudioRedirect surface:
//    • Adapter (location → destination) — `LegacyAlertStudioRedirectResolver` value parity with the web
//      source `` <Navigate to={`/notifications/studio${search}`} replace /> ``: the constant target, the
//      verbatim-search passthrough, the `replace` semantics, the native route decomposition, the empty
//      query case, the parent fallback, and the phase matrix.
//    • Query parsing — `RedirectQuery` / `RedirectLocation` (leading `?`, valueless flags, `=` in value).
//    • State holder — `LegacyAlertStudioRedirectModel` automatic single-fire redirect, the manual
//      Continue + empty-state parent fallback + error retry, phase resolution, the P1/S11 `view.opened`
//      telemetry, and the stale auto-refresh / offline wiring.
//    • Accessibility — the per-phase summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no router and no real store: the model
//  is driven by `InMemoryLegacyAlertStudioRedirectSource` and a recording navigation seam.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: inbound location → navigation target (port parity with the web source)

@MainActor
final class LegacyAlertStudioRedirectResolverTests: XCTestCase {
    func testDestinationTargetsStudioAndPreservesSearchVerbatim() {
        let location = RedirectLocation(path: "/alert-studio", rawQuery: "draft=42&utm_source=email")
        let destination = LegacyAlertStudioRedirectResolver.destination(for: location)

        XCTAssertEqual(destination.path, "/notifications/studio")
        XCTAssertEqual(destination.search, "?draft=42&utm_source=email")
        // Web `` `/notifications/studio${search}` `` — exact string concatenation, no re-encoding.
        XCTAssertEqual(destination.fullPath, "/notifications/studio?draft=42&utm_source=email")
        XCTAssertEqual(destination.routeSlug, "notifications")
        XCTAssertEqual(destination.subPath, "studio")
        XCTAssertTrue(destination.replace)
    }

    func testDestinationWithNoQueryHasNoQuestionMark() {
        let destination = LegacyAlertStudioRedirectResolver.destination(for: RedirectLocation())
        XCTAssertEqual(destination.search, "")
        XCTAssertEqual(destination.fullPath, "/notifications/studio")
        XCTAssertTrue(destination.queryItems.isEmpty)
    }

    func testDestinationForwardsParsedQueryItems() {
        let location = RedirectLocation(path: "/alert-studio", rawQuery: "draft=42&utm_source=email")
        let destination = LegacyAlertStudioRedirectResolver.destination(for: location)
        XCTAssertEqual(destination.queryItems, [
            RedirectQueryItem(name: "draft", value: "42"),
            RedirectQueryItem(name: "utm_source", value: "email")
        ])
    }

    func testParentDestinationIsRouteRootWithoutQuery() {
        let parent = LegacyAlertStudioRedirectResolver.parentDestination()
        XCTAssertEqual(parent.path, "/notifications")
        XCTAssertEqual(parent.search, "")
        XCTAssertEqual(parent.subPath, "")
        XCTAssertEqual(parent.routeSlug, "notifications")
        XCTAssertTrue(parent.queryItems.isEmpty)
        XCTAssertTrue(parent.replace)
    }

    func testDestinationForStatusOnlyWhenResolved() {
        let location = RedirectLocation(rawQuery: "a=1")
        XCTAssertNotNil(LegacyAlertStudioRedirectResolver.destination(for: .resolved(location)))
        XCTAssertNil(LegacyAlertStudioRedirectResolver.destination(for: .idle))
        XCTAssertNil(LegacyAlertStudioRedirectResolver.destination(for: .resolving))
        XCTAssertNil(LegacyAlertStudioRedirectResolver.destination(for: .unavailable))
        XCTAssertNil(LegacyAlertStudioRedirectResolver.destination(for: .failed("boom")))
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(LegacyAlertStudioRedirectResolver.resolvePhase(.idle), .redirecting)
        XCTAssertEqual(LegacyAlertStudioRedirectResolver.resolvePhase(.resolving), .redirecting)
        XCTAssertEqual(LegacyAlertStudioRedirectResolver.resolvePhase(.resolved(RedirectLocation())), .resolved)
        XCTAssertEqual(LegacyAlertStudioRedirectResolver.resolvePhase(.unavailable), .empty)
        XCTAssertEqual(LegacyAlertStudioRedirectResolver.resolvePhase(.failed("x")), .error("x"))
    }
}

// MARK: - Query parsing

@MainActor
final class LegacyAlertStudioRedirectQueryTests: XCTestCase {
    func testParseSplitsPairs() {
        XCTAssertEqual(RedirectQuery.parse("draft=42&utm_source=email"), [
            RedirectQueryItem(name: "draft", value: "42"),
            RedirectQueryItem(name: "utm_source", value: "email")
        ])
    }

    func testParseStripsLeadingQuestionMark() {
        XCTAssertEqual(RedirectQuery.parse("?a=1"), [RedirectQueryItem(name: "a", value: "1")])
    }

    func testParseEmptyYieldsNoItems() {
        XCTAssertTrue(RedirectQuery.parse("").isEmpty)
        XCTAssertTrue(RedirectQuery.parse("?").isEmpty)
    }

    func testParseValuelessFlagHasNilValue() {
        XCTAssertEqual(RedirectQuery.parse("compact"), [RedirectQueryItem(name: "compact", value: nil)])
    }

    func testParseKeepsEqualsInsideValue() {
        XCTAssertEqual(RedirectQuery.parse("token=a=b=c"), [RedirectQueryItem(name: "token", value: "a=b=c")])
    }

    func testLocationSearchReproducesWebLocationSearch() {
        XCTAssertEqual(RedirectLocation(rawQuery: "a=1").search, "?a=1")
        XCTAssertEqual(RedirectLocation(rawQuery: "?a=1").search, "?a=1")
        XCTAssertEqual(RedirectLocation().search, "")
    }
}

// MARK: - State holder: automatic redirect, fallbacks, phase, telemetry

@MainActor
final class LegacyAlertStudioRedirectModelTests: XCTestCase {
    private let deepLink = RedirectLocation(path: "/alert-studio", rawQuery: "draft=42&utm_source=email")

    private func makeModel(
        initial: LegacyAlertStudioRedirectUpdate?,
        telemetry: LegacyAlertStudioRedirectTelemetry = OSLogLegacyAlertStudioRedirectTelemetry(),
        onRedirect: @escaping @MainActor (RedirectDestination) -> Void = { _ in }
    ) -> (LegacyAlertStudioRedirectModel, InMemoryLegacyAlertStudioRedirectSource) {
        let source = InMemoryLegacyAlertStudioRedirectSource(initial: initial)
        let model = LegacyAlertStudioRedirectModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            onRedirect: onRedirect
        )
        return (model, source)
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyLegacyAlertStudioRedirectTelemetry()
        let (model, source) = makeModel(initial: LegacyAlertStudioRedirectUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LegacyAlertStudioRedirect.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testResolvedInitialAutoRedirectsExactlyOnce() {
        var dispatched: [RedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink)),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertEqual(dispatched.count, 1)
        XCTAssertEqual(dispatched.first?.fullPath, "/notifications/studio?draft=42&utm_source=email")
        XCTAssertTrue(dispatched.first?.replace ?? false)
    }

    func testAutoRedirectDoesNotFireBeforeStart() {
        var dispatched: [RedirectDestination] = []
        _ = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink)),
            onRedirect: { dispatched.append($0) }
        )
        XCTAssertTrue(dispatched.isEmpty)
    }

    func testLateResolvedLocationAutoRedirectsOnce() {
        var dispatched: [RedirectDestination] = []
        let (model, source) = makeModel(initial: nil, onRedirect: { dispatched.append($0) })
        model.start()
        XCTAssertEqual(model.phase, .redirecting)
        XCTAssertTrue(dispatched.isEmpty)

        source.push(LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink)))
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertEqual(dispatched.count, 1)

        source.push(LegacyAlertStudioRedirectUpdate(status: .resolved(RedirectLocation(rawQuery: "x=2"))))
        XCTAssertEqual(dispatched.count, 1, "the automatic replace fires once, like web <Navigate replace>")
    }

    func testUnavailableShowsEmptyAndDoesNotRedirect() {
        var dispatched: [RedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .unavailable),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.destination)
        XCTAssertTrue(dispatched.isEmpty)
    }

    func testFailedShowsErrorAndDoesNotRedirect() {
        var dispatched: [RedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .failed("boom")),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
        XCTAssertTrue(dispatched.isEmpty)
    }

    func testConfirmReissuesNavigationToResolvedTarget() {
        var dispatched: [RedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink)),
            onRedirect: { dispatched.append($0) }
        )
        model.start()
        model.confirm()
        XCTAssertEqual(dispatched.count, 2)
        XCTAssertEqual(dispatched.last?.fullPath, "/notifications/studio?draft=42&utm_source=email")
    }

    func testGoToParentDispatchesParentDestination() {
        var dispatched: [RedirectDestination] = []
        let (model, _) = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .unavailable),
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
        let (model, source) = makeModel(initial: LegacyAlertStudioRedirectUpdate(status: .failed("x")))
        model.start()
        model.retry()
        model.retry()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let live = LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink), connection: .live)
        let (model, source) = makeModel(initial: live)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(live)
        source.push(LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsResolvedWithoutRefresh() {
        let (model, source) = makeModel(
            initial: LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink), connection: .live)
        )
        model.start()
        source.push(LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .resolved)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testBreadcrumbReflectsForwardedParameters() {
        let (model, _) = makeModel(initial: LegacyAlertStudioRedirectUpdate(status: .resolved(deepLink)))
        model.start()
        XCTAssertEqual(model.breadcrumb.parentName, "Notifications")
        XCTAssertEqual(model.breadcrumb.destinationName, "Alert Studio")
        XCTAssertEqual(model.breadcrumb.forwardedParameterCount, 2)
    }
}

// MARK: - Accessibility summaries

@MainActor
final class LegacyAlertStudioRedirectAccessibilityTests: XCTestCase {
    private let passthrough: (String, String) -> String = { _, value in value }

    func testSummaryForEachPhase() {
        XCTAssertEqual(summary(.redirecting), "Redirecting to Alert Studio")
        XCTAssertEqual(summary(.resolved), "Opening Alert Studio")
        XCTAssertEqual(summary(.empty), "Alert Studio is unavailable")
        XCTAssertEqual(summary(.error("x")), "Couldn't open Alert Studio")
    }

    @MainActor
    func testModelAccessibilitySummaryResolvesEnglish() {
        let source = InMemoryLegacyAlertStudioRedirectSource(
            initial: LegacyAlertStudioRedirectUpdate(status: .resolved(RedirectLocation()))
        )
        let model = LegacyAlertStudioRedirectModel(source: source, copy: .fallback)
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Opening Alert Studio")
    }

    private func summary(_ phase: RedirectPhase) -> String {
        LegacyAlertStudioRedirectAccessibility.summary(
            for: phase,
            destination: "Alert Studio",
            localize: passthrough
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLegacyAlertStudioRedirectTelemetry: LegacyAlertStudioRedirectTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
