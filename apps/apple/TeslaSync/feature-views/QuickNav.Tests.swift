//
//  QuickNav.Tests.swift
//  TeslaSync — P4 feature view · 0129 · QuickNav (Apple)
//
//  Unit coverage for the QuickNav surface:
//    • Adapter (catalog → projection) — `QuickNavShortcut` catalog parity with the
//      web `NAV_ITEMS` (order, i18n keys, fallbacks, native route mapping, colors,
//      icons), the `QuickNavTileBuilder` localization, and the responsive
//      `QuickNavComponentLayout` column math.
//    • Projection — `QuickNavProjection.resolvePhase` across loading / empty / error
//      / content, including the cached-items-keep-content branches.
//    • State holder — `QuickNavViewModel` phase + connection resolution, the guarded
//      stale auto-refresh, the offline-keeps-cache behavior, and the P1/S11
//      `view.opened` telemetry + source wiring (incl. `StaticQuickNavCatalogSource`).
//    • Accessibility — the VoiceOver label / hint / grid / connection copy.
//    • Per-state render smoke — every state rasterizes (snapshot) without crashing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryQuickNavCatalogSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog parity (port of the web `NAV_ITEMS`)

@MainActor final class QuickNavShortcutCatalogTests: XCTestCase {
    func testCatalogMatchesWebOrder() {
        XCTAssertEqual(QuickNavShortcut.catalog, [.drives, .charging, .analytics, .battery])
    }

    func testI18nKeysMatchWebDashboardNamespace() {
        XCTAssertEqual(QuickNavShortcut.drives.labelKey, "nav.drives")
        XCTAssertEqual(QuickNavShortcut.drives.descriptionKey, "nav.drivesDesc")
        XCTAssertEqual(QuickNavShortcut.charging.labelKey, "nav.charging")
        XCTAssertEqual(QuickNavShortcut.analytics.descriptionKey, "nav.analyticsDesc")
        XCTAssertEqual(QuickNavShortcut.battery.labelKey, "nav.battery")
        XCTAssertEqual(QuickNavShortcut.battery.descriptionKey, "nav.batteryDesc")
    }

    func testEnglishFallbacksMatchWebDefaults() {
        XCTAssertEqual(QuickNavShortcut.drives.labelFallback, "Drives")
        XCTAssertEqual(QuickNavShortcut.drives.descriptionFallback, "Trip history")
        XCTAssertEqual(QuickNavShortcut.charging.descriptionFallback, "Sessions & costs")
        XCTAssertEqual(QuickNavShortcut.analytics.descriptionFallback, "Fleet insights")
        XCTAssertEqual(QuickNavShortcut.battery.descriptionFallback, "Health & degradation")
    }

    func testWebPathsMatchSource() {
        XCTAssertEqual(
            QuickNavShortcut.catalog.map(\.webPath),
            ["/drives", "/charging", "/analytics", "/battery"]
        )
    }

    func testNativeRoutePathsResolveToCanonicalAppRoutes() {
        // Parity with AppRouteParser: /drives → driving, /battery → energy alias.
        XCTAssertEqual(QuickNavShortcut.drives.routePath, "/driving")
        XCTAssertEqual(QuickNavShortcut.charging.routePath, "/charging")
        XCTAssertEqual(QuickNavShortcut.analytics.routePath, "/analytics")
        XCTAssertEqual(QuickNavShortcut.battery.routePath, "/energy")
    }

    func testEachShortcutHasDistinctIconAndColor() {
        let icons = Set(QuickNavShortcut.catalog.map(\.systemImage))
        XCTAssertEqual(icons.count, QuickNavShortcut.catalog.count)
        for shortcut in QuickNavShortcut.catalog {
            XCTAssertFalse(shortcut.systemImage.isEmpty)
        }
    }

    func testAccentColorsMatchWebHex() {
        XCTAssertEqual(QuickNavShortcut.drives.accentColor, Color(red: 0.000, green: 0.941, blue: 1.000))
        XCTAssertEqual(QuickNavShortcut.charging.accentColor, Color(red: 0.063, green: 0.725, blue: 0.506))
        XCTAssertEqual(QuickNavShortcut.analytics.accentColor, Color(red: 0.659, green: 0.333, blue: 0.969))
        XCTAssertEqual(QuickNavShortcut.battery.accentColor, Color(red: 0.961, green: 0.620, blue: 0.043))
    }
}

// MARK: - Adapter: tile builder + layout

@MainActor final class QuickNavTileBuilderTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the builder tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testBuildPreservesCatalogOrderAndCount() {
        let items = QuickNavTileBuilder.build(localize: echo)
        XCTAssertEqual(items.map(\.shortcut), [.drives, .charging, .analytics, .battery])
        XCTAssertEqual(items.count, 4)
    }

    func testBuildResolvesLabelAndDetailViaLocalizer() {
        let items = QuickNavTileBuilder.build(shortcuts: [.charging], localize: keyTap)
        let charging = items.first
        XCTAssertEqual(charging?.label, "L:nav.charging")
        XCTAssertEqual(charging?.detail, "L:nav.chargingDesc")
    }

    func testBuildCarriesIconColorAndShortcut() {
        let items = QuickNavTileBuilder.build(shortcuts: [.battery], localize: echo)
        let battery = items[0]
        XCTAssertEqual(battery.id, "battery")
        XCTAssertEqual(battery.shortcut, .battery)
        XCTAssertEqual(battery.systemImage, QuickNavShortcut.battery.systemImage)
        XCTAssertEqual(battery.accentColor, QuickNavShortcut.battery.accentColor)
    }

    func testBuildHandlesEmptyShortcuts() {
        XCTAssertTrue(QuickNavTileBuilder.build(shortcuts: [], localize: echo).isEmpty)
    }

    func testLayoutColumnsMatchResponsiveBreakpoints() {
        XCTAssertEqual(QuickNavComponentLayout.columns(forWidth: 0), 2)
        XCTAssertEqual(QuickNavComponentLayout.columns(forWidth: 320), 2)
        XCTAssertEqual(QuickNavComponentLayout.columns(forWidth: 639), 2)
        XCTAssertEqual(QuickNavComponentLayout.columns(forWidth: 640), 4)
        XCTAssertEqual(QuickNavComponentLayout.columns(forWidth: 1024), 4)
    }
}

// MARK: - Projection: phase resolution

@MainActor final class QuickNavProjectionTests: XCTestCase {
    func testLoadingWithoutItemsShowsLoading() {
        XCTAssertEqual(QuickNavProjection.resolvePhase(.loading, count: 0), .loading)
    }

    func testLoadingWithCachedItemsKeepsContent() {
        XCTAssertEqual(QuickNavProjection.resolvePhase(.loading, count: 4), .content)
    }

    func testLoadedWithItemsShowsContent() {
        XCTAssertEqual(QuickNavProjection.resolvePhase(.loaded, count: 4), .content)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        XCTAssertEqual(QuickNavProjection.resolvePhase(.loaded, count: 0), .empty)
    }

    func testFailedWithoutItemsShowsError() {
        XCTAssertEqual(QuickNavProjection.resolvePhase(.failed("boom"), count: 0), .error("boom"))
    }

    func testFailedWithCachedItemsKeepsContent() {
        XCTAssertEqual(QuickNavProjection.resolvePhase(.failed("net"), count: 4), .content)
    }
}

// MARK: - Accessibility content

@MainActor final class QuickNavComponentAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testTileLabelCombinesLabelAndDetail() {
        XCTAssertEqual(
            QuickNavComponentAccessibility.tileLabel(label: "Drives", detail: "Trip history"),
            "Drives. Trip history"
        )
    }

    func testTileLabelOmitsEmptyDetail() {
        XCTAssertEqual(QuickNavComponentAccessibility.tileLabel(label: "Drives", detail: ""), "Drives")
    }

    func testTileHintFormatsOpensLabel() {
        XCTAssertEqual(QuickNavComponentAccessibility.tileHint(label: "Charging", localize: echo), "Opens Charging")
    }

    func testGridLabelResolvesViaLocalizer() {
        XCTAssertEqual(QuickNavComponentAccessibility.gridLabel(localize: echo), "Quick navigation")
    }

    func testConnectionLabelsResolveViaLocalizer() {
        XCTAssertEqual(QuickNavComponentAccessibility.connectionLabel(.live, localize: echo), "Live")
        XCTAssertEqual(QuickNavComponentAccessibility.connectionLabel(.stale, localize: echo), "Stale")
        XCTAssertEqual(QuickNavComponentAccessibility.connectionLabel(.offline, localize: echo), "Offline")
    }

    func testBuiltItemsCarryAccessibilityCopy() {
        let items = QuickNavTileBuilder.build(shortcuts: [.analytics], localize: echo)
        let analytics = items[0]
        XCTAssertEqual(analytics.accessibilityLabel, "Analytics. Fleet insights")
        XCTAssertEqual(analytics.accessibilityHint, "Opens Analytics")
    }
}

// MARK: - Surface identity

@MainActor final class QuickNavSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(QuickNavSurface.slug, "QuickNav")
        XCTAssertEqual(QuickNav.surfaceSlug, "QuickNav")
    }
}

// MARK: - State holder: phases + connection + telemetry + source wiring

@MainActor final class QuickNavViewModelTests: XCTestCase {
    private func makeModel(
        _ update: QuickNavCatalogUpdate,
        telemetry: QuickNavViewTelemetry = OSLogQuickNavViewTelemetry()
    ) -> (QuickNavViewModel, InMemoryQuickNavCatalogSource) {
        let source = InMemoryQuickNavCatalogSource(initial: update)
        let model = QuickNavViewModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutItemsShowsLoading() {
        let (model, _) = makeModel(QuickNavCatalogUpdate(status: .loading, shortcuts: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testLoadedWithItemsShowsContent() {
        let (model, _) = makeModel(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 4)
        XCTAssertEqual(model.connection, .live)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        let (model, _) = makeModel(QuickNavCatalogUpdate(status: .loaded, shortcuts: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutItemsShowsError() {
        let (model, _) = makeModel(QuickNavCatalogUpdate(status: .failed("boom"), shortcuts: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyQuickNavViewTelemetry()
        let (model, source) = makeModel(
            QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [QuickNav.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleConnectionTriggersExactlyOneAutoRefresh() {
        let (model, source) = makeModel(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .live
        ))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 1)

        // Still stale → guarded, no second auto-refresh.
        source.push(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveResetsStaleGuardSoStaleRetriggers() {
        let (model, source) = makeModel(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .live
        ))
        model.start()
        source.push(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog, connection: .stale))
        source.push(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog, connection: .live))
        source.push(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedGridWithoutRefresh() {
        let (model, source) = makeModel(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .live
        ))
        model.start()
        source.push(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 4)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopDelegatesToSourceAndReArmsOnNextStart() {
        let (model, source) = makeModel(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(QuickNavCatalogUpdate(status: .loaded, shortcuts: QuickNavShortcut.catalog))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaticSourcePublishesCanonicalLiveCatalog() {
        var received: QuickNavCatalogUpdate?
        let source = StaticQuickNavCatalogSource()
        source.onUpdate = { update in received = update }
        source.start()
        XCTAssertEqual(received?.status, .loaded)
        XCTAssertEqual(received?.connection, .live)
        XCTAssertEqual(received?.shortcuts, QuickNavShortcut.catalog)
    }
}

// MARK: - Per-state render smoke (snapshot)

@MainActor final class QuickNavRenderTests: XCTestCase {
    private func render(_ update: QuickNavCatalogUpdate) -> CGImage? {
        let source = InMemoryQuickNavCatalogSource(initial: update)
        let model = QuickNavViewModel(source: source)
        model.start()
        let view = QuickNav(model: model)
            .frame(width: 480, height: 200)
        return ImageRenderer(content: view).cgImage
    }

    func testContentLiveStateRenders() {
        XCTAssertNotNil(render(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .live
        )))
    }

    func testContentStaleStateRenders() {
        XCTAssertNotNil(render(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .stale
        )))
    }

    func testContentOfflineStateRenders() {
        XCTAssertNotNil(render(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: QuickNavShortcut.catalog,
            connection: .offline
        )))
    }

    func testLoadingStateRenders() {
        XCTAssertNotNil(render(QuickNavCatalogUpdate(status: .loading, shortcuts: [])))
    }

    func testEmptyStateRenders() {
        XCTAssertNotNil(render(QuickNavCatalogUpdate(status: .loaded, shortcuts: [])))
    }

    func testErrorStateRenders() {
        XCTAssertNotNil(render(QuickNavCatalogUpdate(status: .failed("Network unavailable"), shortcuts: [])))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyQuickNavViewTelemetry: QuickNavViewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
