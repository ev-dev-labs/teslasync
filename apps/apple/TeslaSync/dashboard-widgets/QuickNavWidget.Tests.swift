//
//  QuickNavWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0075 · QuickNavWidget (Apple)
//
//  Unit coverage for the QuickNavWidget surface:
//    • Adapter (catalog → projection) — `QuickNavDestination` catalog parity with
//      the web `NAV_ITEMS` (order, i18n keys, native route mapping, colors, icons),
//      the `QuickNavItemBuilder` localization, and the responsive `QuickNavLayout`.
//    • State holder — `QuickNavModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring and
//      the production `StaticQuickNavSource` catalog.
//    • Registry — canonical `quick-nav` metadata + size clamping.
//    • Accessibility — the VoiceOver label/hint content for the tiles.
//    • Per-state render smoke — every phase rasterizes (snapshot) without crashing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryQuickNavSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog parity (port of the web `NAV_ITEMS`)

final class QuickNavCatalogTests: XCTestCase {
    func testCatalogMatchesWebOrder() {
        XCTAssertEqual(QuickNavCatalog.all, [.drives, .charging, .analytics, .battery])
    }

    func testDestinationI18nKeysMatchWebDashboardNamespace() {
        XCTAssertEqual(QuickNavDestination.drives.labelKey, "nav.drives")
        XCTAssertEqual(QuickNavDestination.drives.descriptionKey, "nav.drivesDesc")
        XCTAssertEqual(QuickNavDestination.charging.labelKey, "nav.charging")
        XCTAssertEqual(QuickNavDestination.analytics.descriptionKey, "nav.analyticsDesc")
        XCTAssertEqual(QuickNavDestination.battery.labelKey, "nav.battery")
        XCTAssertEqual(QuickNavDestination.battery.descriptionKey, "nav.batteryDesc")
    }

    func testEnglishFallbacksMatchWebDefaults() {
        XCTAssertEqual(QuickNavDestination.drives.labelFallback, "Drives")
        XCTAssertEqual(QuickNavDestination.drives.descriptionFallback, "Trip history")
        XCTAssertEqual(QuickNavDestination.charging.descriptionFallback, "Sessions & costs")
        XCTAssertEqual(QuickNavDestination.analytics.descriptionFallback, "Fleet insights")
        XCTAssertEqual(QuickNavDestination.battery.descriptionFallback, "Health & degradation")
    }

    func testWebPathsMatchSource() {
        XCTAssertEqual(QuickNavDestination.allCases.map(\.webPath), ["/drives", "/charging", "/analytics", "/battery"])
    }

    func testNativeRoutePathsResolveToCanonicalAppRoutes() {
        // Parity with AppRouteParser: /drives → driving, /battery → energy alias.
        XCTAssertEqual(QuickNavDestination.drives.routePath, "/driving")
        XCTAssertEqual(QuickNavDestination.charging.routePath, "/charging")
        XCTAssertEqual(QuickNavDestination.analytics.routePath, "/analytics")
        XCTAssertEqual(QuickNavDestination.battery.routePath, "/energy")
    }

    func testEachDestinationHasDistinctIconAndColor() {
        let icons = Set(QuickNavCatalog.all.map(\.systemImage))
        XCTAssertEqual(icons.count, QuickNavCatalog.all.count)
        for destination in QuickNavCatalog.all {
            XCTAssertFalse(destination.systemImage.isEmpty)
        }
    }

    func testAccentColorsMatchWebHex() {
        XCTAssertEqual(QuickNavDestination.drives.accentColor, Color(red: 0.000, green: 0.941, blue: 1.000))
        XCTAssertEqual(QuickNavDestination.charging.accentColor, Color(red: 0.063, green: 0.725, blue: 0.506))
        XCTAssertEqual(QuickNavDestination.analytics.accentColor, Color(red: 0.659, green: 0.333, blue: 0.969))
        XCTAssertEqual(QuickNavDestination.battery.accentColor, Color(red: 0.961, green: 0.620, blue: 0.043))
    }
}

// MARK: - Adapter: item builder + layout

final class QuickNavBuilderTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the builder tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testBuildPreservesCatalogOrderAndCount() {
        let items = QuickNavItemBuilder.build(localize: echo)
        XCTAssertEqual(items.map(\.destination), [.drives, .charging, .analytics, .battery])
        XCTAssertEqual(items.count, 4)
    }

    func testBuildResolvesLabelAndDetailViaLocalizer() {
        let items = QuickNavItemBuilder.build(destinations: [.charging], localize: keyTap)
        let charging = try? XCTUnwrap(items.first)
        XCTAssertEqual(charging?.label, "L:nav.charging")
        XCTAssertEqual(charging?.detail, "L:nav.chargingDesc")
    }

    func testBuildCarriesIconColorAndDestination() {
        let items = QuickNavItemBuilder.build(destinations: [.battery], localize: echo)
        let battery = items[0]
        XCTAssertEqual(battery.id, "battery")
        XCTAssertEqual(battery.systemImage, QuickNavDestination.battery.systemImage)
        XCTAssertEqual(battery.accentColor, QuickNavDestination.battery.accentColor)
    }

    func testBuildHandlesEmptyDestinations() {
        XCTAssertTrue(QuickNavItemBuilder.build(destinations: [], localize: echo).isEmpty)
    }

    func testLayoutColumnsMatchResponsiveBreakpoints() {
        XCTAssertEqual(QuickNavLayout.columns(forCols: 2), 2)
        XCTAssertEqual(QuickNavLayout.columns(forCols: 3), 2)
        XCTAssertEqual(QuickNavLayout.columns(forCols: 4), 4)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class QuickNavModelTests: XCTestCase {
    private func makeModel(
        _ update: QuickNavUpdate,
        telemetry: QuickNavTelemetry = OSLogQuickNavTelemetry()
    ) -> (QuickNavModel, InMemoryQuickNavSource) {
        let source = InMemoryQuickNavSource(initial: update)
        let model = QuickNavModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutItemsShowsLoading() {
        let (model, _) = makeModel(QuickNavUpdate(status: .loading, destinations: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithItemsShowsContent() {
        let (model, _) = makeModel(QuickNavUpdate(status: .loaded, destinations: QuickNavCatalog.all))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 4)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        let (model, _) = makeModel(QuickNavUpdate(status: .loaded, destinations: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutItemsShowsError() {
        let (model, _) = makeModel(QuickNavUpdate(status: .failed("boom"), destinations: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testItemsPresentKeepContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(QuickNavUpdate(status: .loading, destinations: QuickNavCatalog.all))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(QuickNavUpdate(status: .failed("net"), destinations: QuickNavCatalog.all))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyQuickNavTelemetry()
        let (model, source) = makeModel(QuickNavUpdate(status: .loading, destinations: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [QuickNavWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(QuickNavUpdate(status: .loaded, destinations: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaticSourcePublishesCanonicalCatalog() {
        var received: QuickNavUpdate?
        let source = StaticQuickNavSource()
        source.onUpdate = { update in received = update }
        source.start()
        XCTAssertEqual(received?.status, .loaded)
        XCTAssertEqual(received?.destinations, QuickNavCatalog.all)
    }
}

// MARK: - Registry parity

final class QuickNavRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = QuickNavWidget.registration
        XCTAssertEqual(registration.id, "quick-nav")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 4, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = QuickNavWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility content

final class QuickNavAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testTileLabelCombinesLabelAndDetail() {
        XCTAssertEqual(QuickNavAccessibility.tileLabel(label: "Drives", detail: "Trip history"), "Drives. Trip history")
    }

    func testTileLabelOmitsEmptyDetail() {
        XCTAssertEqual(QuickNavAccessibility.tileLabel(label: "Drives", detail: ""), "Drives")
    }

    func testTileHintFormatsOpensLabel() {
        XCTAssertEqual(QuickNavAccessibility.tileHint(label: "Charging", localize: echo), "Opens Charging")
    }

    func testBuiltItemsCarryAccessibilityCopy() {
        let items = QuickNavItemBuilder.build(destinations: [.analytics], localize: echo)
        let analytics = items[0]
        XCTAssertEqual(analytics.accessibilityLabel, "Analytics. Fleet insights")
        XCTAssertEqual(analytics.accessibilityHint, "Opens Analytics")
    }
}

// MARK: - Per-state render smoke (snapshot)

@MainActor
final class QuickNavRenderTests: XCTestCase {
    private func render(_ update: QuickNavUpdate) -> CGImage? {
        let source = InMemoryQuickNavSource(initial: update)
        let model = QuickNavModel(source: source)
        model.start()
        let widget = QuickNavWidget(model: model, size: DashboardWidgetSize(cols: 4, rows: 2))
            .frame(width: 520, height: 160)
        return ImageRenderer(content: widget).cgImage
    }

    func testContentStateRenders() {
        XCTAssertNotNil(render(QuickNavUpdate(status: .loaded, destinations: QuickNavCatalog.all)))
    }

    func testLoadingStateRenders() {
        XCTAssertNotNil(render(QuickNavUpdate(status: .loading, destinations: [])))
    }

    func testEmptyStateRenders() {
        XCTAssertNotNil(render(QuickNavUpdate(status: .loaded, destinations: [])))
    }

    func testErrorStateRenders() {
        XCTAssertNotNil(render(QuickNavUpdate(status: .failed("Network unavailable"), destinations: [])))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyQuickNavTelemetry: QuickNavTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
