//
//  QuickLinksSection.Tests.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  Unit coverage for the QuickLinksSection surface:
//    • Adapter (catalog → projection) — `QuickLinksDestination` catalog parity with the
//      web `quickLinks` array (order, i18n keys, fallbacks, web paths, native route
//      mapping, icons), the `QuickLinksTileBuilder` localization, and the responsive
//      `QuickLinksLayout` column math.
//    • Projection — `QuickLinksProjection.resolvePhase` across loading / empty / error
//      / content, including the cached-items-keep-content branches.
//    • Accessibility — the VoiceOver label / hint / section / connection copy.
//    • Surface identity — the stable `view.opened` slug.
//
//  The state-holder (`QuickLinksViewModel`) and per-state render-smoke coverage live in
//  the sibling `QuickLinksSection.ModelTests.swift`. These run in the TeslaSync(/-macOS)
//  XCTest targets; they have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog parity (port of the web `quickLinks`)

@MainActor final class QuickLinksDestinationCatalogTests: XCTestCase {
    func testCatalogMatchesWebOrder() {
        XCTAssertEqual(
            QuickLinksDestination.catalog,
            [.drives, .charging, .battery, .climate, .efficiency, .settings]
        )
    }

    func testCatalogHasSixLinks() {
        XCTAssertEqual(QuickLinksDestination.catalog.count, 6)
    }

    func testI18nKeysUseNavNamespace() {
        XCTAssertEqual(QuickLinksDestination.drives.labelKey, "nav.drives")
        XCTAssertEqual(QuickLinksDestination.charging.labelKey, "nav.charging")
        XCTAssertEqual(QuickLinksDestination.battery.labelKey, "nav.battery")
        XCTAssertEqual(QuickLinksDestination.climate.labelKey, "nav.climate")
        XCTAssertEqual(QuickLinksDestination.efficiency.labelKey, "nav.efficiency")
        XCTAssertEqual(QuickLinksDestination.settings.labelKey, "nav.settings")
    }

    func testEnglishFallbacksMatchWebDefaults() {
        XCTAssertEqual(QuickLinksDestination.drives.labelFallback, "Drives")
        XCTAssertEqual(QuickLinksDestination.charging.labelFallback, "Charging")
        XCTAssertEqual(QuickLinksDestination.battery.labelFallback, "Battery")
        XCTAssertEqual(QuickLinksDestination.climate.labelFallback, "Climate")
        XCTAssertEqual(QuickLinksDestination.efficiency.labelFallback, "Efficiency")
        XCTAssertEqual(QuickLinksDestination.settings.labelFallback, "Settings")
    }

    func testWebPathsMatchSource() {
        XCTAssertEqual(
            QuickLinksDestination.catalog.map(\.webPath),
            ["/drives", "/charging", "/battery", "/climate", "/efficiency", "/settings"]
        )
    }

    func testNativeRoutePathsMapToCanonicalAppRoutes() {
        // Parity with AppRouteParser aliasing: /drives → driving, /battery → energy,
        // /climate (ClimateControl) → vehicle-systems, /efficiency → analytics.
        XCTAssertEqual(QuickLinksDestination.drives.routePath, "/driving")
        XCTAssertEqual(QuickLinksDestination.charging.routePath, "/charging")
        XCTAssertEqual(QuickLinksDestination.battery.routePath, "/energy")
        XCTAssertEqual(QuickLinksDestination.climate.routePath, "/vehicle-systems")
        XCTAssertEqual(QuickLinksDestination.efficiency.routePath, "/analytics")
        XCTAssertEqual(QuickLinksDestination.settings.routePath, "/settings")
    }

    func testEveryRoutePathResolvesToARealAppRoute() {
        // The host must be able to navigate every tile: each routePath is a canonical
        // native AppRoute path and parses back to a concrete route.
        for destination in QuickLinksDestination.catalog {
            XCTAssertTrue(
                AppRoute.allCases.contains { $0.path == destination.routePath },
                "routePath \(destination.routePath) is not a real AppRoute path"
            )
            XCTAssertNotNil(
                AppRouteParser.parse(path: destination.routePath),
                "routePath \(destination.routePath) does not resolve via AppRouteParser"
            )
        }
    }

    func testEachLinkHasDistinctNonEmptyIcon() {
        let icons = QuickLinksDestination.catalog.map(\.systemImage)
        XCTAssertEqual(Set(icons).count, icons.count, "icons must be distinct")
        for icon in icons {
            XCTAssertFalse(icon.isEmpty)
        }
    }
}

// MARK: - Adapter: tile builder + layout

@MainActor final class QuickLinksTileBuilderTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the builder tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testBuildPreservesCatalogOrderAndCount() {
        let items = QuickLinksTileBuilder.build(localize: echo)
        XCTAssertEqual(items.map(\.destination), [.drives, .charging, .battery, .climate, .efficiency, .settings])
        XCTAssertEqual(items.count, 6)
    }

    func testBuildResolvesLabelViaLocalizer() {
        let items = QuickLinksTileBuilder.build(destinations: [.climate], localize: keyTap)
        XCTAssertEqual(items.first?.label, "L:nav.climate")
    }

    func testBuildCarriesIconAndDestination() {
        let items = QuickLinksTileBuilder.build(destinations: [.settings], localize: echo)
        let settings = items[0]
        XCTAssertEqual(settings.id, "settings")
        XCTAssertEqual(settings.destination, .settings)
        XCTAssertEqual(settings.systemImage, QuickLinksDestination.settings.systemImage)
    }

    func testBuildHandlesEmptyDestinations() {
        XCTAssertTrue(QuickLinksTileBuilder.build(destinations: [], localize: echo).isEmpty)
    }

    func testLayoutColumnsMatchResponsiveBreakpoints() {
        // web grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 (sm=640, lg=1024).
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 0), 2)
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 320), 2)
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 639), 2)
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 640), 3)
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 1023), 3)
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 1024), 6)
        XCTAssertEqual(QuickLinksLayout.columns(forWidth: 1440), 6)
    }
}

// MARK: - Projection: phase resolution

@MainActor final class QuickLinksProjectionTests: XCTestCase {
    func testLoadingWithoutItemsShowsLoading() {
        XCTAssertEqual(QuickLinksProjection.resolvePhase(.loading, count: 0), .loading)
    }

    func testLoadingWithCachedItemsKeepsContent() {
        XCTAssertEqual(QuickLinksProjection.resolvePhase(.loading, count: 6), .content)
    }

    func testLoadedWithItemsShowsContent() {
        XCTAssertEqual(QuickLinksProjection.resolvePhase(.loaded, count: 6), .content)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        XCTAssertEqual(QuickLinksProjection.resolvePhase(.loaded, count: 0), .empty)
    }

    func testFailedWithoutItemsShowsError() {
        XCTAssertEqual(QuickLinksProjection.resolvePhase(.failed("boom"), count: 0), .error("boom"))
    }

    func testFailedWithCachedItemsKeepsContent() {
        XCTAssertEqual(QuickLinksProjection.resolvePhase(.failed("net"), count: 6), .content)
    }
}

// MARK: - Accessibility content

@MainActor final class QuickLinksAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testTileLabelIsTheLabel() {
        XCTAssertEqual(QuickLinksAccessibility.tileLabel(label: "Drives"), "Drives")
    }

    func testTileHintFormatsOpensLabel() {
        XCTAssertEqual(QuickLinksAccessibility.tileHint(label: "Charging", localize: echo), "Opens Charging")
    }

    func testSectionLabelResolvesViaLocalizer() {
        XCTAssertEqual(QuickLinksAccessibility.sectionLabel(localize: echo), "Quick links")
    }

    func testConnectionLabelsResolveViaLocalizer() {
        XCTAssertEqual(QuickLinksAccessibility.connectionLabel(.live, localize: echo), "Live")
        XCTAssertEqual(QuickLinksAccessibility.connectionLabel(.stale, localize: echo), "Stale")
        XCTAssertEqual(QuickLinksAccessibility.connectionLabel(.offline, localize: echo), "Offline")
    }

    func testBuiltItemsCarryAccessibilityCopy() {
        let items = QuickLinksTileBuilder.build(destinations: [.efficiency], localize: echo)
        let efficiency = items[0]
        XCTAssertEqual(efficiency.accessibilityLabel, "Efficiency")
        XCTAssertEqual(efficiency.accessibilityHint, "Opens Efficiency")
    }
}

// MARK: - Surface identity

@MainActor final class QuickLinksSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(QuickLinksSurface.slug, "QuickLinksSection")
        XCTAssertEqual(QuickLinksSection.surfaceSlug, "QuickLinksSection")
    }
}
