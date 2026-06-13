//
//  LayoutBreadcrumbs.Tests.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  The state-holder + view-composition half of the coverage (the pure catalog + projection + source live
//  in LayoutBreadcrumbs.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • LayoutBreadcrumbsModel — binds the route source, tracks the live pathname, re-projects on a route
//      change, resolves the trail with merged overrides, emits `view.opened` once (idempotent across
//      stop/start), and keeps the last path on stop.
//    • Views — the composition view (every init), the empty slot, the inspector rows + live sample compose;
//      the row accessibility label + the route localizer resolve through P1/S10; the resolved trail items
//      all carry labels (VoiceOver content presence).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the route source is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - LayoutBreadcrumbsModel (web LayoutBreadcrumbs route input)

@MainActor
final class LayoutBreadcrumbsModelTests: XCTestCase {
    private let fallbackOnly: BreadcrumbOverridesLocalize = { _, fallback in fallback }

    private func makeModel(
        source: any LayoutBreadcrumbsSource,
        spy: SpyLayoutBreadcrumbsTelemetry
    ) -> LayoutBreadcrumbsModel {
        LayoutBreadcrumbsModel(source: source, localize: fallbackOnly, telemetry: spy)
    }

    func testStartAdoptsCurrentPath() {
        let model = makeModel(source: LiveLayoutBreadcrumbsSource(pathname: "/drives/4421"), spy: .init())
        model.start()
        XCTAssertEqual(model.pathname, "/drives/4421")
    }

    func testResolvesTrailForCurrentPath() {
        let model = makeModel(source: LiveLayoutBreadcrumbsSource(pathname: "/drives/4421"), spy: .init())
        model.start()
        let resolved = model.resolvedTrail(overrides: [:])
        XCTAssertTrue(resolved.isRendered)
        XCTAssertEqual(resolved.current?.label, "Drive Detail")
        XCTAssertEqual(resolved.ancestors.map(\.label), ["Drives"])
    }

    func testResolvesTrailAppliesOverrides() {
        let model = makeModel(source: LiveLayoutBreadcrumbsSource(pathname: "/drives/4421"), spy: .init())
        model.start()
        let resolved = model.resolvedTrail(overrides: ["/drives/:id": "Trip to office"])
        XCTAssertEqual(resolved.current?.label, "Trip to office")
    }

    func testReprojectsOnRouteChange() {
        let source = LiveLayoutBreadcrumbsSource(pathname: "/")
        let model = makeModel(source: source, spy: .init())
        model.start()
        XCTAssertEqual(model.pathname, "/")
        source.update(pathname: "/vehicles/7")
        XCTAssertEqual(model.pathname, "/vehicles/7")
        XCTAssertEqual(model.resolvedTrail(overrides: [:]).current?.pattern, "/vehicles/:id")
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyLayoutBreadcrumbsTelemetry()
        let model = makeModel(source: LiveLayoutBreadcrumbsSource(), spy: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LayoutBreadcrumbsSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyLayoutBreadcrumbsTelemetry()
        let model = makeModel(source: LiveLayoutBreadcrumbsSource(), spy: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [LayoutBreadcrumbsSurface.slug], "view.opened fires once per instance")
    }

    func testStopKeepsLastPath() {
        let model = makeModel(source: LiveLayoutBreadcrumbsSource(pathname: "/drives/4421"), spy: .init())
        model.start()
        model.stop()
        XCTAssertEqual(model.pathname, "/drives/4421", "a transient disappear keeps the breadcrumb stable")
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class LayoutBreadcrumbsViewTests: XCTestCase {
    func testViewComposesForEveryInit() {
        _ = LayoutBreadcrumbs(model: LayoutBreadcrumbsModel(source: LiveLayoutBreadcrumbsSource()))
        _ = LayoutBreadcrumbs(source: LiveLayoutBreadcrumbsSource(pathname: "/drives/4421"), onSelect: { _ in })
        _ = LayoutBreadcrumbs(pathname: "/vehicles", onHome: {})
    }

    func testEmptySlotComposes() {
        _ = LayoutBreadcrumbsEmptySlot()
    }

    func testSurfaceSlugExposedOnView() {
        XCTAssertEqual(LayoutBreadcrumbs.surfaceSlug, "LayoutBreadcrumbs")
    }

    func testInspectorAndLiveSampleCompose() {
        _ = LayoutBreadcrumbsLiveSample()
        for scenario in LayoutBreadcrumbsScenario.allCases {
            _ = LayoutBreadcrumbsScenarioRow(scenario: scenario)
        }
    }

    func testRowAccessibilityLabelResolves() {
        XCTAssertEqual(LayoutBreadcrumbsStrings.rowA11y, "Breadcrumb")
    }

    func testRouteLocalizerResolvesThroughFacade() {
        XCTAssertEqual(LayoutBreadcrumbsStrings.routeLabel("routes.unmapped.key", "Fallback Label"), "Fallback Label")
    }

    func testResolvedTrailItemsAllCarryLabels() {
        let resolved = LayoutBreadcrumbsProjection.resolve(
            path: "/drives/4421/replay",
            overrides: [:],
            localize: { _, fallback in fallback }
        )
        XCTAssertTrue(resolved.isRendered)
        XCTAssertFalse(resolved.items.contains { $0.label.isEmpty }, "every crumb has VoiceOver content")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyLayoutBreadcrumbsTelemetry: LayoutBreadcrumbsTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
