//
//  LayoutBreadcrumbs.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  Pure-core coverage for the global Layout breadcrumb row (the model + view-composition half lives in
//  LayoutBreadcrumbs.Tests.swift; split to keep each file within the SwiftLint file-length budget). This
//  is the "adapter (cached → projection)" unit test the acceptance calls for: it drives the route catalog
//  (the ROUTE_META port), the projection over the real catalog, and the route source, asserting the
//  verbatim port of the web `ROUTE_META` + `useBreadcrumbs` behavior:
//    • slug      — the diagnostics surface slug.
//    • catalog   — every registered route present, declaration order preserved, the 12 parent chains
//                  ported, every parent target resolvable, top-level routes parent-less, a `:param`
//                  route matched by a concrete path.
//    • projection — unknown route → empty/suppressed; top-level → suppressed; nested → rendered with
//                  current + ancestors + hrefs; an override wins over the default label.
//    • source    — the live route source emits the current path on start + on update.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no SwiftUI.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class LayoutBreadcrumbsSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(LayoutBreadcrumbsSurface.slug, "LayoutBreadcrumbs")
    }
}

// MARK: - LayoutBreadcrumbsRouteCatalog (web ROUTE_META = ROUTE_REGISTRY + PARENT_OVERRIDES)

final class LayoutBreadcrumbsRouteCatalogTests: XCTestCase {
    private var table: BreadcrumbOverridesRouteTable {
        LayoutBreadcrumbsRouteCatalog.table
    }

    func testEntryCountMatchesRegistry() {
        XCTAssertEqual(LayoutBreadcrumbsRouteCatalog.entries.count, 113, "every registered web route is ported")
    }

    func testDeclarationOrderPreserved() {
        XCTAssertEqual(LayoutBreadcrumbsRouteCatalog.entries.first?.pattern, "/")
        XCTAssertEqual(LayoutBreadcrumbsRouteCatalog.entries.last?.pattern, "/year-review/:year")
    }

    func testBaselineLabelForKnownRoute() {
        XCTAssertEqual(table.meta(for: "/")?.defaultLabel, "Dashboard")
        XCTAssertEqual(table.meta(for: "/")?.i18nKey, "routes.dashboard")
    }

    func testParentChainsPortedVerbatim() {
        XCTAssertEqual(table.meta(for: "/drives/:id")?.parent, "/drives")
        XCTAssertEqual(table.meta(for: "/drives/:id/replay")?.parent, "/drives/:id")
        XCTAssertEqual(table.meta(for: "/charging/:id")?.parent, "/charging")
        XCTAssertEqual(table.meta(for: "/vehicles/:id")?.parent, "/vehicles")
        XCTAssertEqual(table.meta(for: "/vehicles/:id/access")?.parent, "/vehicles/:id")
        XCTAssertEqual(table.meta(for: "/trips/:id")?.parent, "/trips")
        XCTAssertEqual(table.meta(for: "/automations/new")?.parent, "/automations")
        XCTAssertEqual(table.meta(for: "/automations/:id/edit")?.parent, "/automations")
        XCTAssertEqual(table.meta(for: "/notifications/studio")?.parent, "/notifications/inbox")
        XCTAssertEqual(table.meta(for: "/notifications/archived")?.parent, "/notifications/inbox")
        XCTAssertEqual(table.meta(for: "/year-review/:year")?.parent, "/analytics")
        XCTAssertEqual(table.meta(for: "/me/activity")?.parent, "/")
    }

    func testExactlyTwelveParentChains() {
        let withParent = LayoutBreadcrumbsRouteCatalog.entries.filter { $0.parent != nil }
        XCTAssertEqual(withParent.count, 12, "the 12 web PARENT_OVERRIDES are ported, no more, no less")
    }

    func testEveryParentTargetResolves() {
        for entry in LayoutBreadcrumbsRouteCatalog.entries {
            guard let parent = entry.parent else { continue }
            XCTAssertNotNil(table.meta(for: parent), "parent target \(parent) of \(entry.pattern) must exist")
        }
    }

    func testTopLevelRoutesHaveNoParent() {
        XCTAssertNil(table.meta(for: "/vehicles")?.parent)
        XCTAssertNil(table.meta(for: "/drives")?.parent)
        XCTAssertNil(table.meta(for: "/analytics")?.parent)
    }

    func testParamRouteMatchedByConcretePath() {
        XCTAssertEqual(table.firstMatch(path: "/drives/4421")?.pattern, "/drives/:id")
        XCTAssertEqual(table.firstMatch(path: "/vehicles/7/access")?.pattern, "/vehicles/:id/access")
    }
}

// MARK: - LayoutBreadcrumbsProjection (web useBreadcrumbs + Breadcrumbs suppression)

final class LayoutBreadcrumbsProjectionTests: XCTestCase {
    private let fallbackOnly: BreadcrumbOverridesLocalize = { _, fallback in fallback }

    private func resolve(_ path: String, _ overrides: BreadcrumbOverrideMap = [:]) -> BreadcrumbOverridesTrailResolved {
        LayoutBreadcrumbsProjection.resolve(path: path, overrides: overrides, localize: fallbackOnly)
    }

    func testUnknownRouteIsEmptyAndSuppressed() {
        let resolved = resolve("/does-not-exist")
        XCTAssertTrue(resolved.isEmpty)
        XCTAssertTrue(resolved.isSuppressed)
        XCTAssertFalse(resolved.isRendered)
        XCTAssertNil(resolved.current)
        XCTAssertEqual(resolved.count, 0)
    }

    func testTopLevelIsSuppressed() {
        let resolved = resolve("/vehicles")
        XCTAssertFalse(resolved.isEmpty)
        XCTAssertTrue(resolved.isSuppressed, "a single-item trail self-suppresses (web items.length <= 1)")
    }

    func testNestedTrailRendersCurrentAndAncestors() {
        // The real registry label for `/drives/:id` is the static "Drive Detail" (no `{{param}}` marker);
        // the `:id` is filled into the HREF, not the label (see testDeepTrailIsLeafLastWithHrefs).
        let resolved = resolve("/drives/4421")
        XCTAssertTrue(resolved.isRendered)
        XCTAssertEqual(resolved.count, 2)
        XCTAssertEqual(resolved.current?.label, "Drive Detail")
        XCTAssertEqual(resolved.ancestors.map(\.label), ["Drives"])
    }

    func testDeepTrailIsLeafLastWithHrefs() {
        let resolved = resolve("/drives/4421/replay")
        XCTAssertEqual(resolved.items.map(\.pattern), ["/drives", "/drives/:id", "/drives/:id/replay"])
        XCTAssertEqual(resolved.items.map(\.label), ["Drives", "Drive Detail", "Trip Replay"])
        XCTAssertEqual(resolved.items[0].href, "/drives")
        XCTAssertEqual(resolved.items[1].href, "/drives/4421", "the :id marker is filled in the ancestor href")
        XCTAssertNil(resolved.items[2].href, "the current leaf has no href")
        XCTAssertTrue(resolved.items.last?.isCurrent == true)
    }

    func testOverrideWinsOverDefaultLabel() {
        let resolved = resolve("/drives/4421", ["/drives/:id": "Trip to office", "/unrelated": "Nope"])
        XCTAssertEqual(resolved.current?.label, "Trip to office")
        XCTAssertEqual(resolved.appliedOverrideCount, 1, "only overrides landing on a trail route count")
    }
}

// MARK: - LiveLayoutBreadcrumbsSource (web useLocation subscription)

@MainActor
final class LiveLayoutBreadcrumbsSourceTests: XCTestCase {
    func testEmitsCurrentPathOnStart() {
        let source = LiveLayoutBreadcrumbsSource(pathname: "/drives/4421")
        var captured: [String] = []
        source.onUpdate = { captured.append($0) }
        source.start()
        XCTAssertEqual(captured, ["/drives/4421"])
    }

    func testReEmitsOnUpdate() {
        let source = LiveLayoutBreadcrumbsSource(pathname: "/")
        var captured: [String] = []
        source.onUpdate = { captured.append($0) }
        source.start()
        source.update(pathname: "/vehicles/7")
        XCTAssertEqual(captured, ["/", "/vehicles/7"])
    }

    func testDefaultPathIsRoot() {
        let source = LiveLayoutBreadcrumbsSource()
        var captured: [String] = []
        source.onUpdate = { captured.append($0) }
        source.start()
        XCTAssertEqual(captured, ["/"])
    }
}
