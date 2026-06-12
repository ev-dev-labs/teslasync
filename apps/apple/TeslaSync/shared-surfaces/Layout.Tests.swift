//
//  Layout.Tests.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + catalog live in
//  Layout.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • LayoutModel — the once-only `view.opened`, snapshot ingestion → phase (loading / content / empty /
//      error), active-section auto-expand, the badge derivation, the pin/unpin + toggle-active-pin routing,
//      the section toggle (active never collapses) + expand/collapse-all, the `select` recent-visit + route
//      (web `<NavLink to>`), and the freshness axis (stale auto-refreshes ONCE, resets after live; offline +
//      live do NOT refetch).
//    • Views — the public surface composes in every phase, with the injected-model + source initializers and
//      the default content slot, and every subview builds.
//    • Strings — the 20 web keys, the interpolated `nav.unpinPage`, and the native a11y labels all resolve
//      through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - LayoutModel (state + routing)

@MainActor
final class LayoutModelTests: XCTestCase {
    private func model(
        source: LayoutSource,
        catalog: [LayoutNavSection] = LayoutNavCatalog.sections,
        onSelect: @escaping @MainActor (String) -> Void = { _ in },
        telemetry: LayoutTelemetry = OSLogLayoutTelemetry()
    ) -> LayoutModel {
        LayoutModel(source: source, catalog: catalog, onSelect: onSelect, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingLayoutSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [LayoutSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingLayoutSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [LayoutSurface.slug], "view.opened fires once per instance")
    }

    func testIngestLoadingYieldsLoadingPhase() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(isLoading: true))
        XCTAssertEqual(holder.phase, .loading)
    }

    func testIngestPopulatedCatalogYieldsContentPhase() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(pathname: "/charging", vehicleCount: 2))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertEqual(holder.projection.activeEntry?.sectionTitle, "Charging")
    }

    func testIngestEmptyCatalogYieldsEmptyPhase() {
        let source = RecordingLayoutSource()
        let holder = model(source: source, catalog: [])
        holder.start()
        source.emit(LayoutSnapshot())
        XCTAssertEqual(holder.phase, .empty, "a fully-filtered nav renders the empty state, not a blank box")
    }

    func testIngestErrorYieldsErrorPhase() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(errorMessage: "boom"))
        XCTAssertEqual(holder.phase, .error("boom"))
    }

    func testActiveSectionAutoExpands() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(pathname: "/battery", expandedSections: []))
        XCTAssertTrue(holder.isExpanded("Battery"), "the active section is always expanded (web effect)")
    }

    func testBadgeDerivation() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(vehicleCount: 3, unreadAlerts: 5, staleCount: 12))
        XCTAssertEqual(holder.badge(for: "/notifications/alerts")?.text, "5")
        XCTAssertEqual(holder.badge(for: "/vehicles")?.text, "3")
        XCTAssertEqual(holder.badge(for: "/data-repair")?.text, "9+")
        XCTAssertNil(holder.badge(for: "/charging"))
    }

    func testPinUnpinAndToggleActivePin() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(pathname: "/drives", pinnedPaths: ["/"]))
        XCTAssertFalse(holder.projection.activeIsPinned)
        holder.toggleActivePin()
        XCTAssertTrue(holder.pinnedPaths.contains("/drives"))
        holder.unpin("/drives")
        XCTAssertFalse(holder.pinnedPaths.contains("/drives"))
    }

    func testToggleSectionActiveNeverCollapses() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(pathname: "/charging", expandedSections: ["Home", "Charging"]))
        holder.toggleSection("Home")
        XCTAssertFalse(holder.isExpanded("Home"), "a non-active section collapses")
        holder.toggleSection("Charging")
        XCTAssertTrue(holder.isExpanded("Charging"), "the active section cannot collapse")
    }

    func testExpandAllAndCollapseAll() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(pathname: "/", vehicleCount: 3, isForwardAuth: true))
        holder.expandAll()
        XCTAssertEqual(holder.projection.expandedSectionCount, holder.projection.sections.count)
        holder.collapseAll()
        XCTAssertEqual(holder.projection.expandedSectionCount, 0)
    }

    func testSelectRecordsVisitAndRoutes() {
        let source = RecordingLayoutSource()
        let recorder = SelectRecorder()
        let holder = model(source: source, onSelect: { recorder.record($0) })
        holder.start()
        source.emit(LayoutSnapshot(pathname: "/", pinnedPaths: ["/"], recentPaths: []))
        holder.select("/drives")
        XCTAssertEqual(recorder.routes, ["/drives"])
        XCTAssertEqual(holder.recentPaths.first, "/drives", "a visit is recorded into the recent list")
    }

    func testStaleAutoRefreshesOnceThenResetsAfterLive() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(connection: .stale))
        source.emit(LayoutSnapshot(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale auto-refreshes exactly once")
        source.emit(LayoutSnapshot(connection: .live))
        source.emit(LayoutSnapshot(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a stale episode after live re-triggers one refresh")
    }

    func testOfflineDoesNotRefetchAndDelegatesRefreshStop() {
        let source = RecordingLayoutSource()
        let holder = model(source: source)
        holder.start()
        source.emit(LayoutSnapshot(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0, "offline keeps the cached chrome without refetching")
        holder.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        holder.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testRecentlyUsedFeatureFlagMatchesWeb() {
        let holder = model(source: RecordingLayoutSource())
        XCTAssertFalse(holder.showRecentlyUsed, "web `SHOW_RECENTLY_USED_NAV` is off")
    }
}

// MARK: - Views (composition)

@MainActor
final class LayoutViewTests: XCTestCase {
    private func model(
        _ snapshot: LayoutSnapshot,
        catalog: [LayoutNavSection] = LayoutNavCatalog.sections
    ) -> LayoutModel {
        let holder = LayoutModel(source: InMemoryLayoutSource(snapshot: snapshot), catalog: catalog)
        holder.start()
        return holder
    }

    func testSurfaceComposesForEveryPhase() {
        _ = LayoutShell(model: model(LayoutSnapshot(pathname: "/charging", vehicleCount: 3))) { LayoutContentSlot() }
        _ = LayoutShell(model: model(LayoutSnapshot(isLoading: true))) { Text(verbatim: "x") }
        _ = LayoutShell(model: model(LayoutSnapshot(), catalog: [])) { LayoutContentSlot() }
        _ = LayoutShell(model: model(LayoutSnapshot(errorMessage: "x"))) { LayoutContentSlot() }
        _ = LayoutShell(model: model(LayoutSnapshot(connection: .stale))) { LayoutContentSlot() }
        _ = LayoutShell(model: model(LayoutSnapshot(connection: .offline))) { LayoutContentSlot() }
        XCTAssertEqual(LayoutShell<LayoutContentSlot>.surfaceSlug, "Layout")
    }

    func testSurfaceComposesFromConvenienceInitializers() {
        _ = LayoutShell(model: model(LayoutSnapshot(vehicleCount: 1)))
        let source = InMemoryLayoutSource(snapshot: LayoutSnapshot(vehicleCount: 1))
        _ = LayoutShell(source: source, onSelect: { _ in }, telemetry: SpyTelemetry())
    }

    func testSidebarSubviewsBuild() {
        let holder = model(LayoutSnapshot(pathname: "/charging", vehicleCount: 3, unreadAlerts: 4, staleCount: 2))
        _ = LayoutSidebarBody(model: holder)
        _ = LayoutSidebarHeader(unread: 4, onCustomizeTheme: {}, onOpenNotifications: {})
        let entry = LayoutActiveEntry(sectionTitle: "Charging", item: LayoutNavCatalog.sections[3].items[0])
        _ = LayoutActiveCard(entry: entry, isPinned: true, onTogglePin: {})
        _ = LayoutPinnedGroup(
            items: holder.projection.pinnedItems,
            activePathname: "/charging",
            onSelect: { _ in },
            onUnpin: { _ in },
            badgeProvider: { holder.badge(for: $0) }
        )
        _ = LayoutSectionsGroup(
            sections: holder.projection.sections,
            expandedCount: 1,
            activePathname: "/charging",
            isExpanded: { _ in true },
            onToggleSection: { _ in },
            onExpandAll: {},
            onCollapseAll: {},
            onSelect: { _ in },
            badgeProvider: { holder.badge(for: $0) }
        )
    }

    func testLeafAndChromeSubviewsBuild() {
        _ = LayoutNavItemRow(
            item: LayoutNavCatalog.sections[0].items[0],
            isActive: true,
            badge: LayoutNavBadge(text: "3", tone: .info),
            onSelect: { _ in }
        )
        _ = LayoutSectionRow(
            section: LayoutNavCatalog.sections[0],
            isExpanded: true,
            activePathname: "/",
            onToggle: { _ in },
            onSelect: { _ in },
            badgeProvider: { _ in nil }
        )
        _ = LayoutHeaderBar(unread: 2, onOpenSidebar: {}, onCustomizeTheme: {}, onOpenNotifications: {})
        _ = LayoutContentRegion(showHint: true) { LayoutContentSlot() }
        _ = LayoutLoadingView()
        _ = LayoutEmptyView()
        _ = LayoutErrorView(message: "boom") {}
        _ = LayoutThemeSwitcher {}
        _ = LayoutBellTrigger(unread: 5) {}
        for connection in LayoutConnection.allCases {
            _ = LayoutShellFreshnessChip(connection: connection, onRefresh: {})
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class LayoutStringsTests: XCTestCase {
    func testWebKeysResolve() {
        XCTAssertEqual(LayoutStrings.table, "Layout")
        XCTAssertEqual(LayoutStrings.themeOpenPicker, "Open theme picker")
        XCTAssertEqual(LayoutStrings.themeCustomize, "Customize…")
        XCTAssertEqual(LayoutStrings.alertsToastTitle, "Alert")
        XCTAssertEqual(LayoutStrings.alertsToastView, "View")
        XCTAssertEqual(LayoutStrings.a11yPrimaryNav, "Primary")
        XCTAssertEqual(LayoutStrings.a11yPrimaryHeader, "Site header")
        XCTAssertEqual(LayoutStrings.navSections, "Sections")
        XCTAssertEqual(LayoutStrings.navQuickSearchHint, "Ctrl+K to jump")
    }

    func testNavKeysResolve() {
        XCTAssertEqual(LayoutStrings.navCloseSidebar, "Close sidebar")
        XCTAssertEqual(LayoutStrings.navOpenSidebar, "Open sidebar")
        XCTAssertEqual(LayoutStrings.navCurrentSection, "Current")
        XCTAssertEqual(LayoutStrings.navPinCurrent, "Pin current page")
        XCTAssertEqual(LayoutStrings.navUnpinCurrent, "Remove current page from pinned")
        XCTAssertEqual(LayoutStrings.navPinAction, "Pin")
        XCTAssertEqual(LayoutStrings.navPinnedAction, "Pinned")
        XCTAssertEqual(LayoutStrings.navPinned, "Pinned")
        XCTAssertEqual(LayoutStrings.navRecentlyUsed, "Recently Used")
        XCTAssertEqual(LayoutStrings.navExpandAll, "Expand all sections")
        XCTAssertEqual(LayoutStrings.navCollapseAll, "Collapse all sections")
    }

    func testInterpolatedUnpinPage() {
        XCTAssertEqual(LayoutStrings.navUnpinPage("Drives"), "Unpin Drives", "interpolates the page into {{page}}")
    }

    func testNativeAccessibilityLabelsPresent() {
        XCTAssertEqual(LayoutStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(LayoutStrings.offlineA11y, "Offline — showing the cached menu")
        XCTAssertFalse(LayoutStrings.loadingA11y.isEmpty)
        XCTAssertFalse(LayoutStrings.emptyTitle.isEmpty)
        XCTAssertFalse(LayoutStrings.errorTitle.isEmpty)
        XCTAssertFalse(LayoutStrings.mainContent.isEmpty)
        XCTAssertFalse(LayoutStrings.notifications.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: LayoutTelemetry, @unchecked Sendable {
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

/// Records the routes the model commits through the host `onSelect` (the `@MainActor` navigation seam).
@MainActor
private final class SelectRecorder {
    private(set) var routes: [String] = []

    func record(_ to: String) {
        routes.append(to)
    }
}

/// A controllable source: counts start / stop / refresh and emits snapshots only when the test asks, so the
/// stale-auto-refresh-once contract is asserted deterministically (it never re-emits on `refresh()`).
@MainActor
private final class RecordingLayoutSource: LayoutSource {
    var onUpdate: (@MainActor (LayoutSnapshot) -> Void)?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var refreshCount = 0

    func start() {
        startCount += 1
    }

    func stop() {
        stopCount += 1
    }

    func refresh() {
        refreshCount += 1
    }

    func emit(_ snapshot: LayoutSnapshot) {
        onUpdate?(snapshot)
    }
}
