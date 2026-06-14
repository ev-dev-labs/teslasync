//
//  Breadcrumbs.Tests.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  The state-holder + view-composition half of the coverage (the pure projection lives in
//  Breadcrumbs.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • BreadcrumbsModel — holds the host-supplied items, re-projects on an update, resolves the trail for a
//      size class, exposes the Home a11y override, and emits `view.opened` once (idempotent across
//      stop/start).
//    • Strings — the i18n facade resolves the two shipped accessibility labels (web `a11y.breadcrumb` /
//      `a11y.breadcrumbHome`) and an arbitrary key's fallback through P1/S10.
//    • Views — the composition view (every init), the empty slot, the trail renderer, and the inspector +
//      sample compose; the resolved crumbs all carry labels (VoiceOver content presence).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the items are in-process props.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - BreadcrumbsModel (web Breadcrumbs `items` prop)

@MainActor
final class BreadcrumbsModelTests: XCTestCase {
    private let trail: [BreadcrumbsItem] = [
        BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
        BreadcrumbsItem(label: "Model 3", href: "/vehicles/7"),
        BreadcrumbsItem(label: "Battery Health")
    ]

    func testResolvesRenderedTrailForMultiItem() {
        let model = BreadcrumbsModel(items: trail, telemetry: SpyBreadcrumbsTelemetry())
        let resolved = model.resolved(isCompact: false)
        XCTAssertTrue(resolved.isRendered)
        XCTAssertEqual(resolved.current?.label, "Battery Health")
    }

    func testResolvesSuppressedForSingleItem() {
        let model = BreadcrumbsModel(items: [BreadcrumbsItem(label: "Dashboard")], telemetry: SpyBreadcrumbsTelemetry())
        XCTAssertTrue(model.resolved(isCompact: false).isSuppressed)
    }

    func testUpdateItemsReprojects() {
        let model = BreadcrumbsModel(items: [], telemetry: SpyBreadcrumbsTelemetry())
        XCTAssertTrue(model.resolved(isCompact: false).isSuppressed)
        model.update(items: trail)
        XCTAssertEqual(model.items.count, 3)
        XCTAssertTrue(model.resolved(isCompact: false).isRendered)
    }

    func testHomeAccessibilityLabelStored() {
        let model = BreadcrumbsModel(items: trail, homeAccessibilityLabel: "Home base")
        XCTAssertEqual(model.homeAccessibilityLabel, "Home base")
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyBreadcrumbsTelemetry()
        let model = BreadcrumbsModel(items: trail, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BreadcrumbsSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyBreadcrumbsTelemetry()
        let model = BreadcrumbsModel(items: trail, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [BreadcrumbsSurface.slug], "view.opened fires once per instance")
    }
}

// MARK: - Strings facade (P1/S10)

final class BreadcrumbsStringsTests: XCTestCase {
    func testNavLabelResolvesToBreadcrumb() {
        XCTAssertEqual(BreadcrumbsStrings.navLabel, "Breadcrumb")
    }

    func testHomeLabelResolvesToDashboard() {
        XCTAssertEqual(BreadcrumbsStrings.homeLabel, "Dashboard")
    }

    func testArbitraryKeyResolvesFallback() {
        XCTAssertEqual(BreadcrumbsStrings.string("breadcrumbs.unmapped.key", "Fallback"), "Fallback")
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class BreadcrumbsViewTests: XCTestCase {
    private let trail: [BreadcrumbsItem] = [
        BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
        BreadcrumbsItem(label: "Model 3", href: "/vehicles/7"),
        BreadcrumbsItem(label: "Battery Health")
    ]

    func testViewComposesForEveryInit() {
        _ = Breadcrumbs(model: BreadcrumbsModel(items: trail))
        _ = Breadcrumbs(items: trail, onSelect: { _ in })
        _ = Breadcrumbs(items: [BreadcrumbsItem(label: "Dashboard")], homeAccessibilityLabel: "Home", onHome: {})
    }

    func testSurfaceSlugExposedOnView() {
        XCTAssertEqual(Breadcrumbs.surfaceSlug, "Breadcrumbs")
    }

    func testEmptySlotComposes() {
        _ = BreadcrumbsEmptySlot()
    }

    func testTrailViewComposes() {
        let resolved = BreadcrumbsProjection.resolve(items: trail, isCompact: false)
        _ = BreadcrumbsTrailView(resolved: resolved, homeAccessibilityLabel: nil, onSelect: { _ in }, onHome: {})
    }

    func testInspectorAndSampleCompose() {
        _ = BreadcrumbsSample()
        for scenario in BreadcrumbsScenario.allCases {
            _ = BreadcrumbsScenarioRow(scenario: scenario)
        }
    }

    func testResolvedCrumbsAllCarryLabels() {
        let resolved = BreadcrumbsProjection.resolve(items: trail, isCompact: false)
        XCTAssertTrue(resolved.isRendered)
        let labelled = resolved.crumbs.filter { !$0.isEllipsis }
        XCTAssertFalse(labelled.contains { $0.label?.isEmpty ?? true }, "every crumb has VoiceOver content")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyBreadcrumbsTelemetry: BreadcrumbsTelemetry, @unchecked Sendable {
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
